import { memo } from "react";
import { LogsPanel } from "./LogsPanel";
import type { Script } from "../types";

type ScriptRowProps = {
  script: Script;
  onRun: () => void;
  onStop: () => void;
  onToggleLogs: () => void;
};

function statusLabel(script: Script): string {
  if (script.status === "running" && script.externalRunning) {
    return "Running (external)";
  }
  const status = script.status;
  switch (status) {
    case "running":
      return "Running";
    case "idle":
      return "Idle";
    case "stopped":
      return "Stopped";
    default: {
      const exhaustiveCheck: never = status;
      return exhaustiveCheck;
    }
  }
}

function ScriptRowComponent({
  script,
  onRun,
  onStop,
  onToggleLogs,
}: ScriptRowProps) {
  const canRun = script.status !== "running";
  const canStop = script.status === "running" && script.pid !== undefined;
  const statusClass =
    script.status === "running"
      ? "border-brand-green/55 bg-brand-green/20 text-brand-green"
      : script.status === "stopped"
        ? "border-rose-400/50 bg-rose-500/20 text-rose-200"
        : "border-white/30 bg-white/10 text-slate-100";

  return (
    <div className="overflow-hidden rounded-2xl border border-[#6edfd0]/35 bg-[linear-gradient(145deg,rgba(20,88,105,0.62),rgba(13,54,67,0.78))] shadow-xl shadow-black/25">
      <div className="flex flex-col gap-2 p-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold tracking-wide ${statusClass}`}
            >
              {statusLabel(script)}
            </span>
            <p className="truncate text-base font-semibold text-white">
              {script.name}
            </p>
            <p className="truncate text-sm text-slate-100/80">
              {script.command}
            </p>
            {script.status === "running" ? (
              <p className="shrink-0 text-[11px] text-slate-200/80">
                CPU {script.cpuPercent?.toFixed(1) ?? "--"}% · RAM{" "}
                {script.memoryMb?.toFixed(0) ?? "--"} MB
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-md border border-brand-green/45 bg-brand-green/20 px-2 py-1 text-[11px] font-semibold text-brand-green transition hover:bg-brand-green/30 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canRun}
            onClick={onRun}
            type="button"
          >
            Run
          </button>
          <button
            className="rounded-md border border-rose-400/45 bg-rose-500/20 px-2 py-1 text-[11px] font-semibold text-rose-100 transition hover:bg-rose-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canStop}
            onClick={onStop}
            type="button"
          >
            Stop
          </button>
          <button
            className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-[11px] font-semibold text-slate-100 transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onToggleLogs}
            type="button"
          >
            {script.isLogsOpen ? "Hide Logs" : "Show Logs"}
          </button>
        </div>
      </div>
      {script.isLogsOpen ? <LogsPanel logs={script.logs} /> : null}
    </div>
  );
}

export const ScriptRow = memo(
  ScriptRowComponent,
  (prev, next) =>
    prev.script.name === next.script.name &&
    prev.script.command === next.script.command &&
    prev.script.status === next.script.status &&
    prev.script.pid === next.script.pid &&
    prev.script.isLogsOpen === next.script.isLogsOpen &&
    prev.script.externalRunning === next.script.externalRunning &&
    prev.script.cpuPercent === next.script.cpuPercent &&
    prev.script.memoryMb === next.script.memoryMb &&
    prev.script.logs.length === next.script.logs.length,
);
