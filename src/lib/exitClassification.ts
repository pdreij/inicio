import type { ProcessExitPayload } from "../types";

const EXPECTED_STOP_SIGNALS = new Set([
  "2",
  "15",
  "int",
  "sigint",
  "term",
  "sigterm",
]);

/** SIGINT / SIGTERM (or legacy dual-null payload) — not a crash for UI purposes. */
export function isExpectedStopSignal(signal: string | null | undefined): boolean {
  if (signal === null || signal === undefined) {
    return false;
  }
  const s = signal.trim().toLowerCase();
  return s !== "none" && s.length > 0 && EXPECTED_STOP_SIGNALS.has(s);
}

export type ProcessExitClass = "success" | "neutral" | "failure";

export function classifyProcessExit(payload: ProcessExitPayload): ProcessExitClass {
  if (payload.signal === null && payload.code === 0) {
    return "success";
  }
  if (payload.signal === null && payload.code === null) {
    return "neutral";
  }
  if (isExpectedStopSignal(payload.signal)) {
    return "neutral";
  }
  if (payload.code !== null && payload.code !== 0) {
    return "failure";
  }
  if (payload.signal !== null) {
    const s = payload.signal.trim().toLowerCase();
    if (s.length > 0 && s !== "none") {
      return "failure";
    }
  }
  return "neutral";
}
