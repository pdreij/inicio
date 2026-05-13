/** True when stderr often indicates TCP port collision (subset of bind errors). */
export function isLikelyPortBindError(stream: string, line: string): boolean {
  if (stream !== "stderr") {
    return false;
  }
  const normalized = line.toLowerCase();
  return (
    normalized.includes("eaddrinuse") ||
    normalized.includes("address already in use") ||
    normalized.includes("port is already in use") ||
    (normalized.includes("listen") && normalized.includes("already in use"))
  );
}

function collectPort(candidate: string, ports: Set<number>): void {
  const n = Number.parseInt(candidate, 10);
  if (Number.isFinite(n) && n >= 1 && n <= 65535) {
    ports.add(n);
  }
}

/** Best-effort port numbers extracted from common dev-server error lines. */
export function parsePortsFromStderrLine(line: string): number[] {
  const ports = new Set<number>();

  for (const match of line.matchAll(/\b[Pp]ort\s*[:='"`]\s*(\d{2,5})\b/g)) {
    if (match[1] !== undefined) {
      collectPort(match[1], ports);
    }
  }
  for (const match of line.matchAll(/\b[Pp]ort\s+(\d{2,5})\b/g)) {
    if (match[1] !== undefined) {
      collectPort(match[1], ports);
    }
  }
  for (const match of line.matchAll(/:(\d{2,5})\b/g)) {
    if (match[1] !== undefined) {
      collectPort(match[1], ports);
    }
  }

  return [...ports];
}
