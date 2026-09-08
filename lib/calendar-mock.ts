"use client";

/**
 * MOCK Google Calendar integration.
 * ---------------------------------------------------------------
 * Deliberately fake and clearly labeled as such (per the product spec:
 * ship a realistic mock rather than a half-working real OAuth flow for a
 * hackathon prototype). A real integration would replace `connect()`
 * with an actual OAuth redirect and `pushEvents()` with calls to the
 * Google Calendar API — every call site here is already shaped to make
 * that swap a body-only change.
 */

const KEY = "studypilot.calendar-mock.v1";

export interface CalendarMockState {
  connected: boolean;
  email: string | null;
  lastSyncedAt: string | null;
}

const DEFAULT_STATE: CalendarMockState = { connected: false, email: null, lastSyncedAt: null };

export function loadCalendarState(): CalendarMockState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_STATE, ...JSON.parse(raw) } : DEFAULT_STATE;
  } catch {
    return DEFAULT_STATE;
  }
}

function save(state: CalendarMockState) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // best effort only
  }
}

function delay<T>(value: T, ms = 1100): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export async function connectMockCalendar(email: string): Promise<CalendarMockState> {
  const state: CalendarMockState = { connected: true, email, lastSyncedAt: new Date().toISOString() };
  save(state);
  return delay(state, 1300);
}

export function disconnectMockCalendar(): CalendarMockState {
  save(DEFAULT_STATE);
  return DEFAULT_STATE;
}

export async function pushEventsMock(count: number): Promise<{ synced: number; at: string }> {
  const at = new Date().toISOString();
  const current = loadCalendarState();
  save({ ...current, lastSyncedAt: at });
  return delay({ synced: count, at }, 900);
}
