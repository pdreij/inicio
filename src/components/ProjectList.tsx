import type { Project } from "../types";
import appLogo from "../../src-tauri/icons/icon.png";

type ProjectListProps = {
  projects: Project[];
  activeProjectId?: string;
  onSelectProject: (projectId: string) => void;
  onRemoveProject: (projectId: string) => void;
  onAddProject: () => void;
  isAddingProject: boolean;
  isHydrated: boolean;
};

export function ProjectList({
  projects,
  activeProjectId,
  onSelectProject,
  onRemoveProject,
  onAddProject,
  isAddingProject,
  isHydrated,
}: ProjectListProps) {
  const addLabel = !isHydrated
    ? "Loading..."
    : isAddingProject
      ? "Adding..."
      : "Add Project";

  return (
    <aside className="sticky top-0 flex h-screen w-80 shrink-0 flex-col border-r border-[#66dacc]/35 bg-[linear-gradient(180deg,rgba(16,74,92,0.9),rgba(11,44,58,0.95))]">
      <div className="flex items-center justify-between gap-3 border-b border-white/15 p-5">
        <div className="flex items-center gap-3">
          <img
            alt="Inicio logo"
            className="h-9 w-9 rounded-xl object-cover shadow-lg shadow-brand-cyan/30"
            src={appLogo}
          />
          <h1 className="text-lg font-semibold tracking-wide text-white">
            Inicio
          </h1>
        </div>
        <button
          className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs font-medium text-white transition hover:border-brand-cyan/50 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onAddProject}
          disabled={isAddingProject || !isHydrated}
          type="button"
        >
          {addLabel}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/20 bg-white/10 p-4 text-sm text-slate-100">
            <p className="font-semibold text-white">No projects yet</p>
            <p className="mt-1 text-slate-200/85">
              Add one project or import a parent folder with multiple apps.
            </p>
            <button
              className="mt-3 rounded-md border border-brand-cyan/45 bg-brand-cyan/20 px-3 py-1.5 text-xs font-semibold text-brand-cyan transition hover:bg-brand-cyan/30"
              disabled={isAddingProject || !isHydrated}
              onClick={onAddProject}
              type="button"
            >
              Add Project
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {projects.map((project) => {
              const isActive = project.id === activeProjectId;
              return (
                <div
                  className={`group rounded-xl border p-3  ${
                    isActive
                      ? "border-brand-cyan/55 bg-[linear-gradient(145deg,rgba(26,100,118,0.74),rgba(15,68,83,0.84))] shadow-lg shadow-brand-cyan/20"
                      : "border-[#72ddd0]/28 bg-[linear-gradient(145deg,rgba(19,79,97,0.62),rgba(12,54,68,0.76))] hover:border-brand-green/45 hover:bg-[linear-gradient(145deg,rgba(28,102,121,0.76),rgba(16,68,84,0.88))]"
                  }`}
                  onClick={() => onSelectProject(project.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectProject(project.id);
                    }
                  }}
                  key={project.id}
                  role="button"
                  tabIndex={0}
                >
                  <div className="block w-full text-left">
                    <span className="block truncate text-sm font-semibold text-white">
                      {project.name}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-200/85">
                      {project.path}
                    </span>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <button
                      aria-label={`Remove ${project.name}`}
                      className="rounded-md px-2 py-1 text-xs text-slate-300 transition hover:bg-rose-500/25 hover:text-rose-100"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onRemoveProject(project.id);
                      }}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
