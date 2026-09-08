import type { Course, StudySession } from "./types";

/**
 * SCHEDULING ENGINE
 * ---------------------------------------------------------------
 * Pure, deterministic functions that turn (courses, exam dates,
 * available hours, performance signals, accessibility study
 * settings) into a study plan. A production version would run this
 * server-side and re-invoke it whenever a new assessment result
 * comes in; here it's synchronous so it can drive the UI directly.
 */

export interface PlanRequest {
  courses: Pick<Course, "id" | "name" | "concepts" | "examDate">[];
  availableHoursPerWeek: number;
  sessionMinutes: number; // from accessibility studySettings()
  breaksEvery: number;
  /** Exam readiness per course (0-100, from exams.readinessScore) — lower readiness pulls a course's weak concepts earlier in the plan. */
  readinessByCourseId?: Record<string, number>;
  /** Course priority (low/medium/high, from courses.priority) — higher priority pulls a course's weak concepts earlier in the plan. */
  priorityByCourseId?: Record<string, "low" | "medium" | "high">;
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const PRIORITY_WEIGHT: Record<"low" | "medium" | "high", number> = { low: 0, medium: 15, high: 30 };

export function generatePlan(req: PlanRequest): StudySession[] {
  const sessions: StudySession[] = [];
  const urgencyFor = (courseId: string) => {
    const readiness = req.readinessByCourseId?.[courseId];
    const priority = req.priorityByCourseId?.[courseId];
    const readinessBoost = readiness === undefined ? 0 : (100 - readiness) * 0.3;
    const priorityBoost = priority ? PRIORITY_WEIGHT[priority] : 0;
    return readinessBoost + priorityBoost;
  };
  const weakConcepts = req.courses
    .flatMap((c) =>
      c.concepts
        .filter((con) => con.mastery < 60)
        .map((con) => ({ course: c, concept: con }))
    )
    .sort((a, b) => (a.concept.mastery - urgencyFor(a.course.id)) - (b.concept.mastery - urgencyFor(b.course.id)));

  const totalMinutesAvailable = req.availableHoursPerWeek * 60;
  let minutesUsed = 0;
  let dayIndex = 0;
  let id = 1;

  for (const { course, concept } of weakConcepts) {
    if (minutesUsed + req.sessionMinutes > totalMinutesAvailable) break;

    sessions.push({
      id: `gen-${id++}`,
      day: DAYS[dayIndex % DAYS.length],
      time: "4:00 PM",
      courseId: course.id,
      conceptName: concept.name,
      minutes: req.sessionMinutes,
      kind: "focus",
    });
    minutesUsed += req.sessionMinutes;

    if (req.sessionMinutes >= req.breaksEvery) {
      sessions.push({
        id: `gen-${id++}`,
        day: DAYS[dayIndex % DAYS.length],
        time: "4:45 PM",
        courseId: course.id,
        conceptName: "Break",
        minutes: 10,
        kind: "break",
      });
    }
    dayIndex++;
  }

  // one light assessment near the end of the plan per course with an exam date
  req.courses
    .filter((c) => c.examDate)
    .forEach((c) => {
      sessions.push({
        id: `gen-${id++}`,
        day: DAYS[dayIndex % DAYS.length],
        time: "5:30 PM",
        courseId: c.id,
        conceptName: "Practice Assessment",
        minutes: 20,
        kind: "assessment",
      });
      dayIndex++;
    });

  return sessions;
}

/**
 * Called after a new (poor) assessment result comes in. Inserts an
 * extra practice session for the weak concept, mirroring the spec's
 * "your plan has been adjusted" behavior.
 */
export function adaptPlanAfterAssessment(
  plan: StudySession[],
  courseId: string,
  weakConceptName: string,
  sessionMinutes: number
): { plan: StudySession[]; message: string } {
  const insertion: StudySession = {
    id: `adapt-${Date.now()}`,
    day: "Tomorrow",
    time: "4:00 PM",
    courseId,
    conceptName: weakConceptName,
    minutes: sessionMinutes,
    kind: "practice",
  };
  return {
    plan: [insertion, ...plan],
    message: `You struggled with ${weakConceptName} in today's assessment. Your plan has been adjusted to include an additional practice session.`,
  };
}

export function daysUntil(iso?: string): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}
