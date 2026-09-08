import "server-only";

import type { Course, VideoRecommendation } from "@/lib/types";
import type { InstructorPreference, Language } from "@/lib/accessibility-context";

const YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const YOUTUBE_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";
const MAX_QUERIES = 3;
const MAX_RESULTS_PER_QUERY = 6;
const MAX_RECOMMENDATIONS = 8;

type YouTubeSearchResponse = {
  items?: Array<{
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      description?: string;
      channelTitle?: string;
      publishedAt?: string;
      thumbnails?: { high?: { url?: string }; medium?: { url?: string }; default?: { url?: string } };
    };
  }>;
  error?: { message?: string };
};

type YouTubeVideoResponse = {
  items?: Array<{ id?: string; contentDetails?: { duration?: string }; statistics?: { viewCount?: string } }>;
  error?: { message?: string };
};

function cleanTopic(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 100);
}

function uniqueTopics(course: Course, topics: string[]): string[] {
  const values = [course.name, ...topics, ...course.concepts.map((concept) => concept.name)]
    .map(cleanTopic)
    .filter(Boolean);
  return [...new Map(values.map((value) => [value.toLowerCase(), value])).values()].slice(0, 10);
}

export interface VideoSearchPreferences {
  language: Language;
  instructorPreference: InstructorPreference;
}

const LANGUAGE_TERMS: Record<Language, string> = {
  en: "English",
  ar: "Arabic",
  both: "English Arabic",
};

const INSTRUCTOR_TERMS: Record<InstructorPreference, string> = {
  any: "",
  "arabic-speaking": "Arabic lecturer",
  "english-speaking": "English lecturer",
  "indian-english": "Indian lecturer",
  "american-english": "American lecturer",
  "british-english": "British lecturer",
};

function queryTopics(course: Course, topics: string[], preferences: VideoSearchPreferences): string[] {
  const allTopics = uniqueTopics(course, topics);
  const base = `${course.name} ${course.subject}`;
  const language = LANGUAGE_TERMS[preferences.language];
  const instructor = INSTRUCTOR_TERMS[preferences.instructorPreference];
  return [
    `${base} ${allTopics.slice(0, 2).join(" ")} lecture ${language} ${instructor}`,
    `${allTopics.slice(0, 3).join(" ")} explained tutorial ${language} ${instructor}`,
    `${course.name} ${allTopics.slice(0, 2).join(" ")} university ${language} ${instructor}`,
  ].map((query) => query.replace(/\s+/g, " ").trim().slice(0, 180));
}

function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
}

function parseDuration(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  return (Number(match[1] ?? 0) * 3600) + (Number(match[2] ?? 0) * 60) + Number(match[3] ?? 0);
}

function formatDuration(seconds: number | null): string | null {
  if (seconds === null) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

async function youtubeRequest<T>(url: URL): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!response.ok) {
    const message = payload?.error?.message ?? `YouTube API request failed with status ${response.status}.`;
    throw new Error(message);
  }
  if (!payload) throw new Error("YouTube returned an empty response.");
  return payload;
}

function scoreRecommendation(
  title: string,
  description: string,
  channelTitle: string,
  topics: string[],
  preferences: VideoSearchPreferences,
  durationSeconds: number | null,
): { score: number; matchedTopics: string[]; qualitySignals: string[] } {
  const haystack = `${title} ${description}`.toLowerCase();
  const matchedTopics = topics.filter((topic) => {
    const normalized = topic.toLowerCase();
    const topicTokens = tokenize(topic);
    return haystack.includes(normalized) || (topicTokens.length > 0 && topicTokens.every((token) => haystack.includes(token)));
  });
  const titleTokens = new Set(tokenize(title));
  const topicTokens = new Set(topics.flatMap(tokenize));
  const tokenMatches = [...topicTokens].filter((token) => titleTokens.has(token)).length;
  const qualitySignals: string[] = [];
  const educationalChannel = /(university|college|academy|education|professor|lecture|khan|mit|stanford|oxford)/i.test(channelTitle);
  if (educationalChannel) qualitySignals.push("Educational channel signal");
  if (/(lecture|tutorial|explained|course|lesson|worked example|practice)/i.test(`${title} ${description}`)) {
    qualitySignals.push("Structured learning language");
  }
  const presenterTerms = INSTRUCTOR_TERMS[preferences.instructorPreference];
  const presenterMatch = preferences.instructorPreference === "any" ||
    presenterTerms.split(" ").some((term) => term.length > 3 && haystack.includes(term.toLowerCase()));
  if (presenterMatch && preferences.instructorPreference !== "any") qualitySignals.push("Matches presenter preference");
  const languageMatch = preferences.language === "both"
    ? /arabic|english/i.test(haystack)
    : preferences.language === "ar"
      ? /arabic|عربي|العربية/i.test(haystack)
      : /english/i.test(haystack);
  if (languageMatch) qualitySignals.push("Matches language preference");
  if (durationSeconds !== null && durationSeconds >= 180 && durationSeconds <= 3600) qualitySignals.push("Study-friendly length");
  const clickbait = /(you won't believe|shocking|gone wrong|must watch|insane|guaranteed|secret trick)/i.test(title);
  if (clickbait) qualitySignals.push("Clickbait penalty");
  const score = Math.max(0, Math.min(100,
    30
    + matchedTopics.length * 15
    + tokenMatches * 3
    + (educationalChannel ? 10 : 0)
    + (presenterMatch ? 8 : 0)
    + (languageMatch ? 7 : 0)
    + (durationSeconds !== null && durationSeconds >= 180 && durationSeconds <= 3600 ? 5 : 0)
    - (clickbait ? 18 : 0)
  ));
  return { score, matchedTopics, qualitySignals };
}

export function getVideoTopicKey(course: Course, topics: string[]): string {
  return uniqueTopics(course, topics).map((topic) => topic.toLowerCase()).sort().join("|").slice(0, 500);
}

export function getVideoPreferenceKey(preferences: VideoSearchPreferences): string {
  return `${preferences.language}:${preferences.instructorPreference}`;
}

export async function fetchVideoRecommendations(
  course: Course,
  topics: string[],
  preferences: VideoSearchPreferences,
): Promise<VideoRecommendation[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YouTube recommendations are not configured. Add YOUTUBE_API_KEY to .env.local.");

  const topicList = uniqueTopics(course, topics);
  const candidates = new Map<string, { title: string; description: string; channelTitle: string; publishedAt: string; thumbnailUrl: string }>();

  for (const query of queryTopics(course, topicList, preferences).slice(0, MAX_QUERIES)) {
    const url = new URL(YOUTUBE_SEARCH_URL);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("q", query);
    url.searchParams.set("type", "video");
    url.searchParams.set("maxResults", String(MAX_RESULTS_PER_QUERY));
    url.searchParams.set("order", "relevance");
    url.searchParams.set("safeSearch", "moderate");
    url.searchParams.set("videoEmbeddable", "true");
    url.searchParams.set("key", apiKey);
    const payload = await youtubeRequest<YouTubeSearchResponse>(url);
    for (const item of payload.items ?? []) {
      const videoId = item.id?.videoId;
      const snippet = item.snippet;
      if (!videoId || !snippet?.title) continue;
      candidates.set(videoId, {
        title: snippet.title,
        description: snippet.description ?? "",
        channelTitle: snippet.channelTitle ?? "YouTube",
        publishedAt: snippet.publishedAt ?? "",
        thumbnailUrl: snippet.thumbnails?.high?.url ?? snippet.thumbnails?.medium?.url ?? snippet.thumbnails?.default?.url ?? "",
      });
    }
  }

  const ids = [...candidates.keys()];
  const durations = new Map<string, number | null>();
  if (ids.length > 0) {
    const url = new URL(YOUTUBE_VIDEOS_URL);
    url.searchParams.set("part", "contentDetails");
    url.searchParams.set("id", ids.join(","));
    url.searchParams.set("key", apiKey);
    const payload = await youtubeRequest<YouTubeVideoResponse>(url);
    for (const item of payload.items ?? []) {
      if (item.id) durations.set(item.id, parseDuration(item.contentDetails?.duration));
    }
  }

  return ids
    .map((videoId) => {
      const candidate = candidates.get(videoId);
      if (!candidate) return null;
      const durationSeconds = durations.get(videoId) ?? null;
      const { score, matchedTopics, qualitySignals } = scoreRecommendation(
        candidate.title,
        candidate.description,
        candidate.channelTitle,
        topicList,
        preferences,
        durationSeconds,
      );
      const recommendationConfidence: VideoRecommendation["recommendationConfidence"] =
        score >= 75 && matchedTopics.length >= 2 ? "high" : score >= 52 && matchedTopics.length > 0 ? "medium" : "low";
      return {
        videoId,
        title: candidate.title,
        channelTitle: candidate.channelTitle,
        description: candidate.description.slice(0, 280),
        thumbnailUrl: candidate.thumbnailUrl,
        publishedAt: candidate.publishedAt,
        durationSeconds,
        durationLabel: formatDuration(durationSeconds),
        url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
        matchedTopics: matchedTopics.slice(0, 3),
        relevanceScore: score,
        reason: matchedTopics.length > 0
          ? `Matches ${matchedTopics.length} course topic${matchedTopics.length === 1 ? "" : "s"}: ${matchedTopics.slice(0, 2).join(", ")}.`
          : "Selected as a related video, but review the coverage before relying on it.",
        qualitySignals,
        recommendationConfidence,
      } satisfies VideoRecommendation;
    })
    .filter((recommendation): recommendation is VideoRecommendation => recommendation !== null)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, MAX_RECOMMENDATIONS);
}
