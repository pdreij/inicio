import { ScriptRow } from "./ScriptRow";
import type { OutdatedPackagesData, Project } from "../types";

type ProjectViewProps = {
  project?: Project;
  appError: string | null;
  outdatedData?: OutdatedPackagesData;
  isLoadingOutdated: boolean;
  isUpdatingDependencies: boolean;
  updateProgress: number;
  selectedOutdatedPackages: string[];
  onRefreshOutdated: () => void;
  onToggleOutdatedPackage: (packageName: string) => void;
  onUpdateDependencies: (includeMajor: boolean) => void;
  onUpdateSelectedDependencies: () => void;
  onRunScript: (scriptName: string) => void;
  onStopScript: (scriptName: string) => void;
  onToggleLogs: (scriptName: string) => void;
  onAddProject: () => void;
};

export function ProjectView({
  project,
  appError,
  outdatedData,
  isLoadingOutdated,
  isUpdatingDependencies,
  updateProgress,
  selectedOutdatedPackages,
  onRefreshOutdated,
  onToggleOutdatedPackage,
  onUpdateDependencies,
  onUpdateSelectedDependencies,
  onRunScript,
  onStopScript,
  onToggleLogs,
  onAddProject,
}: ProjectViewProps) {
  const packageManagerLabel = outdatedData?.packageManager ?? "unknown";
  const canUpdateSelected =
    selectedOutdatedPackages.length > 0 &&
    !isLoadingOutdated &&
    !isUpdatingDependencies;
  const lastCheckedLabel =
    outdatedData?.lastCheckedAt === undefined
      ? "Not checked yet"
      : new Date(outdatedData.lastCheckedAt).toLocaleTimeString();

  if (project === undefined) {
    return (
      <section className="flex h-screen flex-1 items-center justify-center overflow-y-auto p-8">
        <div className="max-w-md rounded-2xl border border-white/20 bg-[#123748]/85 p-6 text-center text-sm text-slate-100 backdrop-blur-xl">
          <p className="mb-3 text-base font-semibold text-white">
            Add your first project
          </p>
          <p className="mb-4 text-slate-200/85">
            Select a folder with a package.json, or a parent folder to import
            multiple child projects.
          </p>
          <button
            className="rounded-md border border-brand-cyan/45 bg-brand-cyan/20 px-3 py-2 text-xs font-semibold text-brand-cyan transition hover:bg-brand-cyan/30"
            onClick={onAddProject}
            type="button"
          >
            Add Project
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-screen flex-1 flex-col gap-10 overflow-y-auto p-6 lg:p-8">
      <header className="rounded-2xl border border-[#5ee2d6]/35 bg-[linear-gradient(145deg,rgba(20,90,106,0.78),rgba(16,56,72,0.88))] px-4 py-3 shadow-lg shadow-black/25 backdrop-blur-xl">
        <div className="flex min-h-12 items-center gap-3 text-sm text-slate-100">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/20 bg-white/10">
            <svg
              aria-hidden="true"
              className="h-3.5 w-3.5 text-slate-100/90"
              fill="none"
              viewBox="0 0 24 24"
            >
              <path
                d="M4 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
              />
            </svg>
          </span>
          <span className="max-w-[30%] truncate font-medium">
            {project.name}
          </span>
          <span className="text-slate-200/55">›</span>
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/20 bg-white/10">
            <svg
              aria-hidden="true"
              className="h-3.5 w-3.5 text-slate-100/90"
              fill="none"
              viewBox="0 0 24 24"
            >
              <path
                d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
              />
            </svg>
          </span>
          <span className="max-w-[45%] truncate text-slate-100/85">
            {project.path}
          </span>
          <button
            className="ml-auto rounded-full border border-white/30 bg-white/10 px-2.5 py-1 text-[10px] font-bold tracking-wide text-slate-100"
            type="button"
          >
            PM: {packageManagerLabel.toUpperCase()}
          </button>
          <button
            className="rounded-full border border-brand-cyan/45 bg-brand-cyan/15 px-2.5 py-1 text-[10px] font-bold tracking-wide text-brand-cyan"
            type="button"
          >
            PROJECT
          </button>
        </div>
      </header>

      {project.importError ? (
        <p className="rounded-xl border border-rose-400/40 bg-rose-500/20 p-3 text-sm text-rose-100">
          {project.importError}
        </p>
      ) : null}

      {appError ? (
        <p className="rounded-xl border border-rose-400/40 bg-rose-500/20 p-3 text-sm text-rose-100">
          {appError}
        </p>
      ) : null}

      {project.scripts.length === 0 && project.importError === undefined ? (
        <div className="rounded-xl border border-dashed border-[#63d7c7]/35 bg-[linear-gradient(145deg,rgba(19,77,95,0.72),rgba(14,56,70,0.82))] p-4 text-sm text-slate-100/90">
          <p className="font-semibold text-white">No scripts found</p>
          <p className="mt-1 text-slate-100/80">
            Add scripts in package.json (for example dev/build/start) to run
            them from Inicio.
          </p>
        </div>
      ) : null}

      {project.scripts.length > 0 ? (
        <div className="space-y-3">
          <div className="border-b border-white/40 px-1 pb-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold tracking-wide text-white">
                Scripts
              </h3>
              <span className="text-xs text-slate-100/75">
                {project.scripts.length} total
              </span>
            </div>
          </div>
          {project.scripts.map((script) => (
            <ScriptRow
              key={script.name}
              onRun={() => onRunScript(script.name)}
              onStop={() => onStopScript(script.name)}
              onToggleLogs={() => onToggleLogs(script.name)}
              script={script}
            />
          ))}
        </div>
      ) : null}

      <section className="rounded-2xl border border-[#67dccd]/35 bg-[linear-gradient(145deg,rgba(18,76,92,0.72),rgba(14,53,66,0.86))] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-wide text-white">
            Outdated packages
          </h3>
          <div className="flex items-center gap-2">
            {isLoadingOutdated ? (
              <span className="text-xs text-slate-200/80">Checking...</span>
            ) : null}
            {isUpdatingDependencies ? (
              <span className="text-xs text-slate-200/80">Updating...</span>
            ) : null}
            <span className="text-[11px] text-slate-200/80">
              Last checked: {lastCheckedLabel}
            </span>
            <button
              className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-[11px] font-semibold text-slate-100 transition-colors duration-150 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isLoadingOutdated || isUpdatingDependencies}
              onClick={onRefreshOutdated}
              type="button"
            >
              Refresh
            </button>
            <button
              className="rounded-md border border-brand-green/45 bg-brand-green/20 px-2 py-1 text-[11px] font-semibold text-brand-green transition-colors duration-150 hover:bg-brand-green/30 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isLoadingOutdated || isUpdatingDependencies}
              onClick={() => onUpdateDependencies(false)}
              type="button"
            >
              Update (ranges)
            </button>
            <button
              className="rounded-md border border-brand-cyan/45 bg-brand-cyan/20 px-2 py-1 text-[11px] font-semibold text-brand-cyan transition-colors duration-150 hover:bg-brand-cyan/30 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isLoadingOutdated || isUpdatingDependencies}
              onClick={() => onUpdateDependencies(true)}
              type="button"
            >
              Update (major)
            </button>
            <button
              className="rounded-md border border-emerald-300/45 bg-emerald-300/20 px-2 py-1 text-[11px] font-semibold text-emerald-100 transition-colors duration-150 hover:bg-emerald-300/30 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canUpdateSelected}
              onClick={onUpdateSelectedDependencies}
              type="button"
            >
              Update selected
            </button>
          </div>
        </div>
        {isUpdatingDependencies || updateProgress > 0 ? (
          <div className="mb-3 rounded-lg border border-white/15 bg-white/8 px-3 py-2">
            <div className="mb-1 flex items-center justify-between text-[11px] text-slate-100/85">
              <span>Updating dependencies...</span>
              <span>{Math.round(updateProgress)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/15">
              <div
                className="h-1.5 rounded-full bg-brand-cyan transition-all duration-200 ease-out"
                style={{ width: `${Math.max(2, updateProgress)}%` }}
              />
            </div>
          </div>
        ) : null}
        {outdatedData?.error ? (
          <p className="text-xs text-rose-200">{outdatedData.error}</p>
        ) : null}
        {outdatedData && outdatedData.packages.length === 0 ? (
          <p className="text-xs text-slate-200/80">
            Everything is up to date ({outdatedData.packageManager}).
          </p>
        ) : null}
        {outdatedData && outdatedData.packages.length > 0 ? (
          <div className="space-y-2">
            {outdatedData.packages.map((item) => (
              <div
                className="flex items-center justify-between rounded-lg border border-[#75ddd0]/30 bg-[linear-gradient(145deg,rgba(25,92,109,0.5),rgba(17,66,80,0.64))] px-3 py-2"
                key={`${item.name}-${item.latest}`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <input
                    checked={selectedOutdatedPackages.includes(item.name)}
                    className="h-3.5 w-3.5 accent-brand-cyan"
                    onChange={() => onToggleOutdatedPackage(item.name)}
                    type="checkbox"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-white">
                      {item.name}
                    </p>
                    <p className="truncate text-[11px] text-slate-200/75">
                      {item.dependency_type}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-slate-100/90">
                  {item.current} -&gt; {item.latest}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </section>
  );
}
