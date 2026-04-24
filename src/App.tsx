import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ProjectList } from "./components/ProjectList";
import { ProjectView } from "./components/ProjectView";
import {
  adoptRunningScripts,
  checkOutdatedPackages,
  discoverProjectCandidates,
  getProcessResources,
  loadProjects,
  openFolderPicker,
  readPackageJson,
  runScript,
  saveProjects,
  stopProcess,
  updateDependencies,
  type SavedProjectsFile,
} from "./lib/tauri";
import type {
  AdoptedScript,
  ProcessResourceSnapshot,
  ProjectCandidate,
} from "./lib/tauri";
import type {
  AppState,
  LogEventPayload,
  ProcessExitPayload,
  ProcessStartPayload,
  OutdatedPackagesData,
  Project,
  Script,
} from "./types";

function isTauriRuntime(): boolean {
  return (
    (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__ !== undefined
  );
}

function createProjectName(path: string): string {
  const parts = path.split("/");
  const lastPart = parts[parts.length - 1];
  return lastPart.length > 0 ? lastPart : path;
}

function createScript(name: string, command: string): Script {
  return {
    name,
    command,
    status: "idle",
    logs: [],
    isLogsOpen: false,
    externalRunning: false,
  };
}

function isAlreadyRunningMessage(stream: string, line: string): boolean {
  if (stream !== "stderr") {
    return false;
  }
  const normalized = line.toLowerCase();
  return (
    normalized.includes("already running") ||
    normalized.includes("address already in use") ||
    normalized.includes("port is already in use")
  );
}

function hasProcessFailed(payload: ProcessExitPayload): boolean {
  if (payload.signal !== null) {
    return true;
  }
  return payload.code !== null && payload.code !== 0;
}

function updateScriptInProjects(
  projects: Project[],
  projectId: string,
  scriptName: string,
  updater: (script: Script) => Script,
): Project[] {
  return projects.map((project) => {
    if (project.id !== projectId) {
      return project;
    }

    return {
      ...project,
      scripts: project.scripts.map((script) =>
        script.name === scriptName ? updater(script) : script,
      ),
    };
  });
}

function buildPersistPayload(
  projects: Project[],
  activeProjectId: string | undefined,
): SavedProjectsFile {
  return {
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      path: project.path,
    })),
    activeProjectId: activeProjectId ?? null,
  };
}

function applyAdoptedScripts(
  projects: Project[],
  adoptedScripts: AdoptedScript[],
): Project[] {
  if (adoptedScripts.length === 0) {
    return projects;
  }

  return projects.map((project) => ({
    ...project,
    scripts: project.scripts.map((script) => {
      const adopted = adoptedScripts.find(
        (item) => item.path === project.path && item.script === script.name,
      );
      if (adopted === undefined) {
        return script;
      }

      return {
        ...script,
        status: "running",
        pid: adopted.pid,
        externalRunning: true,
        logs: [
          ...script.logs,
          `[system] adopted already running process (pid ${adopted.pid})`,
        ],
      };
    }),
  }));
}

function App() {
  const [state, setState] = useState<AppState>({ projects: [] });
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);
  const [pendingRemovalProjectId, setPendingRemovalProjectId] = useState<
    string | null
  >(null);
  const [outdatedByProjectId, setOutdatedByProjectId] = useState<
    Record<string, OutdatedPackagesData>
  >({});
  const [isLoadingOutdated, setIsLoadingOutdated] = useState(false);
  const [isUpdatingDependencies, setIsUpdatingDependencies] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [selectedOutdatedByProjectId, setSelectedOutdatedByProjectId] =
    useState<Record<string, string[]>>({});
  const [importCandidates, setImportCandidates] = useState<ProjectCandidate[]>(
    [],
  );
  const [selectedImportPaths, setSelectedImportPaths] = useState<string[]>([]);
  const [isImportWizardOpen, setIsImportWizardOpen] = useState(false);
  const [isHydrated, setIsHydrated] = useState(!isTauriRuntime());
  const persistSignatureRef = useRef<string>("");
  const hasInitializedOutdatedRef = useRef(false);

  const activeProject = useMemo(() => {
    if (state.activeProjectId === undefined) {
      return undefined;
    }

    return state.projects.find(
      (project) => project.id === state.activeProjectId,
    );
  }, [state.activeProjectId, state.projects]);
  const runningPids = useMemo(
    () =>
      state.projects
        .flatMap((project) => project.scripts.map((script) => script.pid))
        .filter((pid): pid is number => pid !== undefined),
    [state.projects],
  );
  const runningPidSignature = useMemo(
    () =>
      runningPids
        .slice()
        .sort((a, b) => a - b)
        .join(","),
    [runningPids],
  );

  useEffect(() => {
    if (!isTauriRuntime()) {
      persistSignatureRef.current = JSON.stringify(
        buildPersistPayload([], undefined),
      );
      setIsHydrated(true);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const file = await loadProjects();
        if (cancelled) {
          return;
        }

        const rebuilt: Project[] = [];
        for (const saved of file.projects) {
          try {
            const packageJson = await readPackageJson(saved.path);
            const scripts = Object.entries(packageJson.scripts).map(
              ([name, command]) => createScript(name, command),
            );
            rebuilt.push({
              id: saved.id,
              name: saved.name,
              path: saved.path,
              scripts,
            });
          } catch (error) {
            rebuilt.push({
              id: saved.id,
              name: saved.name,
              path: saved.path,
              scripts: [],
              importError:
                error instanceof Error ? error.message : String(error),
            });
          }
        }

        let activeProjectId = file.activeProjectId ?? undefined;
        if (
          activeProjectId !== undefined &&
          !rebuilt.some((project) => project.id === activeProjectId)
        ) {
          activeProjectId = rebuilt[0]?.id;
        }

        let rebuiltWithAdopted = rebuilt;
        try {
          const adopted = await adoptRunningScripts(file.projects);
          rebuiltWithAdopted = applyAdoptedScripts(rebuilt, adopted);
        } catch {
          // Non-fatal: startup should continue even if adoption probing fails.
        }

        if (cancelled) {
          return;
        }

        persistSignatureRef.current = JSON.stringify(
          buildPersistPayload(rebuiltWithAdopted, activeProjectId),
        );

        setState({
          activeProjectId,
          projects: rebuiltWithAdopted,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setAppError(error instanceof Error ? error.message : String(error));
        persistSignatureRef.current = JSON.stringify(
          buildPersistPayload([], undefined),
        );
        setState({ projects: [], activeProjectId: undefined });
      } finally {
        if (!cancelled) {
          setIsHydrated(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    // React 18 StrictMode runs effects twice in dev. `listen()` is async, so cleanup
    // can run before `unlisten` exists unless we cancel / unsubscribe explicitly.
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];

    void (async () => {
      const unlistenLog = await listen<LogEventPayload>(
        "script-log",
        (event) => {
          const payload = event.payload;
          setState((currentState) => ({
            ...currentState,
            projects: currentState.projects.map((project) => ({
              ...project,
              scripts: project.scripts.map((script) => {
                const isMatchingScript =
                  script.pid === payload.pid ||
                  (project.path === payload.path &&
                    script.name === payload.script);
                if (!isMatchingScript) {
                  return script;
                }

                const detectedExternalRunning = isAlreadyRunningMessage(
                  payload.stream,
                  payload.line,
                );
                return {
                  ...script,
                  pid: detectedExternalRunning
                    ? undefined
                    : (script.pid ?? payload.pid),
                  status: "running",
                  externalRunning: detectedExternalRunning
                    ? true
                    : (script.externalRunning ?? false),
                  logs: [...script.logs, `[${payload.stream}] ${payload.line}`],
                };
              }),
            })),
          }));
        },
      );
      if (cancelled) {
        unlistenLog();
        return;
      }
      unsubscribers.push(unlistenLog);

      const unlistenStart = await listen<ProcessStartPayload>(
        "script-start",
        (event) => {
          const payload = event.payload;
          setState((currentState) => ({
            ...currentState,
            projects: currentState.projects.map((project) => {
              if (project.path !== payload.path) {
                return project;
              }

              return {
                ...project,
                scripts: project.scripts.map((script) => {
                  if (script.name !== payload.script) {
                    return script;
                  }

                  return {
                    ...script,
                    status: "running",
                    pid: payload.pid,
                    externalRunning: payload.package_manager === "external",
                    cpuPercent: undefined,
                    memoryMb: undefined,
                    logs: [
                      ...script.logs,
                      `[system] started with ${payload.package_manager} (pid ${payload.pid})`,
                    ],
                  };
                }),
              };
            }),
          }));
        },
      );
      if (cancelled) {
        unlistenStart();
        return;
      }
      unsubscribers.push(unlistenStart);

      const unlistenExit = await listen<ProcessExitPayload>(
        "script-exit",
        (event) => {
          const payload = event.payload;
          setState((currentState) => ({
            ...currentState,
            projects: currentState.projects.map((project) => ({
              ...project,
              scripts: project.scripts.map((script) => {
                const isMatchingScript =
                  script.pid === payload.pid ||
                  (project.path === payload.path &&
                    script.name === payload.script);
                if (!isMatchingScript) {
                  return script;
                }

                if (
                  script.externalRunning === true &&
                  project.path === payload.path &&
                  script.name === payload.script
                ) {
                  return {
                    ...script,
                    status: "running",
                    pid: undefined,
                    externalRunning: true,
                    logs: [
                      ...script.logs,
                      `[system] confirmed as externally running`,
                    ],
                  };
                }

                return {
                  ...script,
                  status: "stopped",
                  pid: undefined,
                  externalRunning: false,
                  cpuPercent: undefined,
                  memoryMb: undefined,
                  isLogsOpen:
                    script.isLogsOpen || hasProcessFailed(payload)
                      ? true
                      : false,
                  logs: [
                    ...script.logs,
                    `[system] process exited (code=${payload.code ?? "none"}, signal=${
                      payload.signal ?? "none"
                    })`,
                  ],
                };
              }),
            })),
          }));
        },
      );
      if (cancelled) {
        unlistenExit();
        return;
      }
      unsubscribers.push(unlistenExit);
    })();

    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime() || !isHydrated) {
      return;
    }

    const payload = buildPersistPayload(state.projects, state.activeProjectId);
    const signature = JSON.stringify(payload);
    if (signature === persistSignatureRef.current) {
      return;
    }

    void saveProjects(payload)
      .then(() => {
        persistSignatureRef.current = signature;
      })
      .catch((error) => {
        setAppError(error instanceof Error ? error.message : String(error));
      });
  }, [isHydrated, state.activeProjectId, state.projects]);

  const activeProjectId = activeProject?.id;
  const activeProjectPath = activeProject?.path;
  const selectedOutdatedPackages =
    activeProjectId === undefined
      ? []
      : (selectedOutdatedByProjectId[activeProjectId] ?? []);

  async function createProjectsFromPaths(
    projectPaths: string[],
    existingPaths: Set<string>,
  ): Promise<{ projects: Project[]; skippedDuplicates: number }> {
    const projects: Project[] = [];
    let skippedDuplicates = 0;

    for (const projectPath of projectPaths) {
      if (existingPaths.has(projectPath)) {
        skippedDuplicates += 1;
        continue;
      }
      const packageJson = await readPackageJson(projectPath);
      const scripts = Object.entries(packageJson.scripts).map(
        ([name, command]) => createScript(name, command),
      );
      projects.push({
        id: crypto.randomUUID(),
        name: createProjectName(projectPath),
        path: projectPath,
        scripts,
      });
    }

    return { projects, skippedDuplicates };
  }

  async function refreshOutdatedForProject(projectId: string, path: string) {
    setIsLoadingOutdated(true);
    try {
      const result = await checkOutdatedPackages(path);
      setOutdatedByProjectId((current) => ({
        ...current,
        [projectId]: {
          packageManager: result.package_manager,
          packages: result.packages,
          lastCheckedAt: new Date().toISOString(),
        },
      }));
      setSelectedOutdatedByProjectId((current) => {
        const selected = current[projectId] ?? [];
        const available = new Set(result.packages.map((item) => item.name));
        return {
          ...current,
          [projectId]: selected.filter((name) => available.has(name)),
        };
      });
    } catch (error) {
      setOutdatedByProjectId((current) => ({
        ...current,
        [projectId]: {
          packageManager: "unknown",
          packages: [],
          error: error instanceof Error ? error.message : String(error),
          lastCheckedAt: new Date().toISOString(),
        },
      }));
    } finally {
      setIsLoadingOutdated(false);
    }
  }

  useEffect(() => {
    if (!isTauriRuntime() || !isHydrated || hasInitializedOutdatedRef.current) {
      return;
    }
    hasInitializedOutdatedRef.current = true;

    if (state.projects.length === 0) {
      return;
    }

    let cancelled = false;
    setIsLoadingOutdated(true);

    void Promise.all(
      state.projects.map(async (project) => {
        try {
          const result = await checkOutdatedPackages(project.path);
          return {
            projectId: project.id,
            data: {
              packageManager: result.package_manager,
              packages: result.packages,
              lastCheckedAt: new Date().toISOString(),
            } satisfies OutdatedPackagesData,
          };
        } catch (error) {
          return {
            projectId: project.id,
            data: {
              packageManager: "unknown",
              packages: [],
              error: error instanceof Error ? error.message : String(error),
              lastCheckedAt: new Date().toISOString(),
            } satisfies OutdatedPackagesData,
          };
        }
      }),
    )
      .then((entries) => {
        if (cancelled) {
          return;
        }
        setOutdatedByProjectId((current) => {
          const next = { ...current };
          for (const entry of entries) {
            next[entry.projectId] = entry.data;
          }
          return next;
        });
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingOutdated(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isHydrated, state.projects]);

  function handleRefreshOutdated() {
    if (activeProjectId === undefined || activeProjectPath === undefined) {
      return;
    }
    void refreshOutdatedForProject(activeProjectId, activeProjectPath);
  }

  function handleToggleOutdatedPackage(packageName: string) {
    if (activeProjectId === undefined) {
      return;
    }
    setSelectedOutdatedByProjectId((current) => {
      const selected = current[activeProjectId] ?? [];
      const isSelected = selected.includes(packageName);
      return {
        ...current,
        [activeProjectId]: isSelected
          ? selected.filter((item) => item !== packageName)
          : [...selected, packageName],
      };
    });
  }

  async function handleUpdateDependencies(
    includeMajor: boolean,
    packageNames?: string[],
  ) {
    if (activeProject === undefined) {
      return;
    }

    setAppError(null);
    setIsUpdatingDependencies(true);
    setUpdateProgress(5);
    // Let React fully paint the loader before backend work kicks off.
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
    await new Promise<void>((resolve) => {
      window.setTimeout(() => resolve(), 16);
    });
    const progressTimer = window.setInterval(() => {
      setUpdateProgress((current) => {
        if (current >= 90) {
          return current;
        }
        const delta = current < 40 ? 7 : current < 70 ? 4 : 2;
        return Math.min(90, current + delta);
      });
    }, 220);
    try {
      const result = await updateDependencies(
        activeProject.path,
        includeMajor,
        packageNames,
      );
      window.clearInterval(progressTimer);
      setUpdateProgress(100);
      await refreshOutdatedForProject(activeProject.id, activeProject.path);
      if (!result.updated) {
        setAppError("No dependency updates were applied.");
      }
    } catch (error) {
      window.clearInterval(progressTimer);
      setAppError(error instanceof Error ? error.message : String(error));
    } finally {
      window.clearInterval(progressTimer);
      setIsUpdatingDependencies(false);
      window.setTimeout(() => {
        setUpdateProgress(0);
      }, 350);
    }
  }

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    if (runningPids.length === 0) {
      return;
    }

    const poll = () => {
      void getProcessResources(runningPids)
        .then((snapshots: ProcessResourceSnapshot[]) => {
          const byPid = new Map(
            snapshots.map((snapshot) => [snapshot.pid, snapshot]),
          );
          setState((currentState) => {
            let didChange = false;
            const nextProjects = currentState.projects.map((project) => {
              let projectChanged = false;
              const nextScripts = project.scripts.map((script) => {
                const nextCpu =
                  script.pid === undefined
                    ? undefined
                    : byPid.get(script.pid)?.cpu_percent;
                const nextMem =
                  script.pid === undefined
                    ? undefined
                    : byPid.get(script.pid)?.memory_mb;
                if (
                  script.cpuPercent === nextCpu &&
                  script.memoryMb === nextMem
                ) {
                  return script;
                }
                projectChanged = true;
                return {
                  ...script,
                  cpuPercent: nextCpu,
                  memoryMb: nextMem,
                };
              });
              if (!projectChanged) {
                return project;
              }
              didChange = true;
              return {
                ...project,
                scripts: nextScripts,
              };
            });
            if (!didChange) {
              return currentState;
            }
            return {
              ...currentState,
              projects: nextProjects,
            };
          });
        })
        .catch(() => {
          // Ignore sampling failures; this is best effort.
        });
    };

    poll();
    const timer = window.setInterval(poll, 2500);
    return () => {
      window.clearInterval(timer);
    };
  }, [runningPids, runningPidSignature]);

  async function handleAddProject() {
    setAppError(null);
    setIsAddingProject(true);

    try {
      if (!isTauriRuntime()) {
        throw new Error(
          "Folder picker requires Tauri runtime. Start the app with `bun run tauri dev` (or `npm run tauri dev`) instead of `npm run dev`.",
        );
      }

      const selectedPath = await openFolderPicker();
      if (selectedPath === null) {
        return;
      }
      const candidates = await discoverProjectCandidates(selectedPath);
      if (candidates.length === 0) {
        throw new Error(
          "No projects found. Select a folder with package.json or a parent folder containing child projects.",
        );
      }

      const selectedIsDirectProject =
        candidates.length === 1 && candidates[0]?.path === selectedPath;
      if (!selectedIsDirectProject) {
        setImportCandidates(candidates);
        setSelectedImportPaths(candidates.map((candidate) => candidate.path));
        setIsImportWizardOpen(true);
        return;
      }

      const existingPaths = new Set(
        state.projects.map((project) => project.path),
      );
      const { projects: projectsToAdd, skippedDuplicates } =
        await createProjectsFromPaths(
          candidates.map((candidate) => candidate.path),
          existingPaths,
        );

      if (projectsToAdd.length === 0) {
        throw new Error(
          skippedDuplicates > 0
            ? "All discovered projects are already added."
            : "No new projects found to add.",
        );
      }

      setState((currentState) => ({
        activeProjectId: projectsToAdd[0]?.id ?? currentState.activeProjectId,
        projects: [...currentState.projects, ...projectsToAdd],
      }));
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsAddingProject(false);
    }
  }

  function handleToggleImportCandidate(path: string) {
    setSelectedImportPaths((current) =>
      current.includes(path)
        ? current.filter((item) => item !== path)
        : [...current, path],
    );
  }

  function handleCancelImportWizard() {
    setIsImportWizardOpen(false);
    setImportCandidates([]);
    setSelectedImportPaths([]);
  }

  async function handleConfirmImportWizard() {
    if (selectedImportPaths.length === 0) {
      setAppError("Pick at least one project to import.");
      return;
    }
    setAppError(null);
    setIsAddingProject(true);
    try {
      const existingPaths = new Set(
        state.projects.map((project) => project.path),
      );
      const { projects: projectsToAdd, skippedDuplicates } =
        await createProjectsFromPaths(selectedImportPaths, existingPaths);
      if (projectsToAdd.length === 0) {
        throw new Error(
          skippedDuplicates > 0
            ? "All selected projects are already added."
            : "No selected projects were imported.",
        );
      }
      setState((currentState) => ({
        activeProjectId: projectsToAdd[0]?.id ?? currentState.activeProjectId,
        projects: [...currentState.projects, ...projectsToAdd],
      }));
      handleCancelImportWizard();
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsAddingProject(false);
    }
  }

  function handleSelectProject(projectId: string) {
    setAppError(null);
    setState((currentState) => ({
      ...currentState,
      activeProjectId: projectId,
    }));
  }

  async function handleRunScript(scriptName: string) {
    if (activeProject === undefined) {
      return;
    }

    setAppError(null);
    try {
      await runScript(activeProject.path, scriptName);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleStopScript(scriptName: string) {
    if (activeProject === undefined) {
      return;
    }

    const script = activeProject.scripts.find(
      (item) => item.name === scriptName,
    );
    if (script?.pid === undefined) {
      return;
    }

    setAppError(null);
    try {
      await stopProcess(script.pid);
      setState((currentState) => ({
        ...currentState,
        projects: updateScriptInProjects(
          currentState.projects,
          activeProject.id,
          scriptName,
          (currentScript) => ({
            ...currentScript,
            status: "stopped",
            pid: undefined,
            cpuPercent: undefined,
            memoryMb: undefined,
            logs: [...currentScript.logs, "[system] stop requested"],
          }),
        ),
      }));
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    }
  }

  function handleRequestRemoveProject(projectId: string) {
    setPendingRemovalProjectId(projectId);
  }

  function handleCancelRemoveProject() {
    setPendingRemovalProjectId(null);
  }

  async function handleConfirmRemoveProject() {
    const projectId = pendingRemovalProjectId;
    if (projectId === null) {
      return;
    }

    const project = state.projects.find((item) => item.id === projectId);
    if (project === undefined) {
      setPendingRemovalProjectId(null);
      return;
    }

    const runningScripts = project.scripts.filter(
      (script) => script.pid !== undefined,
    );

    setAppError(null);
    const stopErrors: string[] = [];

    for (const script of runningScripts) {
      if (script.pid === undefined) {
        continue;
      }
      try {
        await stopProcess(script.pid);
      } catch (error) {
        stopErrors.push(error instanceof Error ? error.message : String(error));
      }
    }

    setState((currentState) => {
      const nextProjects = currentState.projects.filter(
        (item) => item.id !== projectId,
      );
      const nextActiveProjectId =
        currentState.activeProjectId === projectId
          ? nextProjects[0]?.id
          : currentState.activeProjectId;
      return {
        projects: nextProjects,
        activeProjectId: nextActiveProjectId,
      };
    });
    setPendingRemovalProjectId(null);

    if (stopErrors.length > 0) {
      setAppError(
        `Project removed, but some scripts could not be stopped: ${stopErrors[0]}`,
      );
    }
  }

  function handleToggleLogs(scriptName: string) {
    if (activeProject === undefined) {
      return;
    }

    setState((currentState) => ({
      ...currentState,
      projects: updateScriptInProjects(
        currentState.projects,
        activeProject.id,
        scriptName,
        (script) => ({
          ...script,
          isLogsOpen: !script.isLogsOpen,
        }),
      ),
    }));
  }

  return (
    <main className="relative h-full overflow-hidden rounded-2xl border border-white/15 shadow-2xl shadow-black/30">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(1200px_700px_at_12%_15%,rgba(40,146,255,0.22),transparent_60%),radial-gradient(1000px_600px_at_88%_86%,rgba(38,211,157,0.18),transparent_60%),linear-gradient(145deg,rgba(8,22,30,0.44),rgba(10,33,44,0.54))]" />
      </div>

      {appError ? (
        <p className="fixed left-1/2 top-4 z-50 w-[min(90vw,840px)] -translate-x-1/2 rounded-xl border border-rose-300/55 bg-rose-500/30 px-4 py-2 text-sm text-rose-50 shadow-lg backdrop-blur">
          {appError}
        </p>
      ) : null}

      {isHydrated ? (
        <div className="relative flex h-full">
          <ProjectList
            activeProjectId={state.activeProjectId}
            isAddingProject={isAddingProject}
            isHydrated={isHydrated}
            onAddProject={handleAddProject}
            onRemoveProject={handleRequestRemoveProject}
            onSelectProject={handleSelectProject}
            projects={state.projects}
          />
          <ProjectView
            appError={appError}
            isLoadingOutdated={isLoadingOutdated}
            updateProgress={updateProgress}
            isUpdatingDependencies={isUpdatingDependencies}
            onAddProject={handleAddProject}
            onRefreshOutdated={handleRefreshOutdated}
            onToggleOutdatedPackage={handleToggleOutdatedPackage}
            onUpdateDependencies={(includeMajor) => {
              void handleUpdateDependencies(includeMajor);
            }}
            onUpdateSelectedDependencies={() => {
              void handleUpdateDependencies(true, selectedOutdatedPackages);
            }}
            outdatedData={
              activeProject === undefined
                ? undefined
                : outdatedByProjectId[activeProject.id]
            }
            onRunScript={handleRunScript}
            onStopScript={handleStopScript}
            onToggleLogs={handleToggleLogs}
            project={activeProject}
            selectedOutdatedPackages={selectedOutdatedPackages}
          />
        </div>
      ) : (
        <div className="relative flex h-full items-center justify-center">
          <div className="flex items-center gap-3 rounded-xl border border-white/20 bg-[#123748]/80 px-4 py-3 text-sm text-slate-100">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-cyan/70 border-t-transparent" />
            <span>Loading projects and restoring session...</span>
          </div>
        </div>
      )}

      {pendingRemovalProjectId !== null ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/20 bg-[#102630]/78 p-5 shadow-2xl shadow-black/45">
            <h3 className="text-lg font-semibold text-white">
              Remove project?
            </h3>
            <p className="mt-2 text-sm text-slate-300">
              This will remove the project from Inicio. Any running scripts for
              that project will be stopped first.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/20"
                onClick={handleCancelRemoveProject}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-lg bg-rose-500/80 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-500"
                onClick={() => {
                  void handleConfirmRemoveProject();
                }}
                type="button"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isImportWizardOpen ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-white/20 bg-[#102630]/90 p-5 shadow-2xl shadow-black/45">
            <h3 className="text-lg font-semibold text-white">
              Import child projects
            </h3>
            <p className="mt-1 text-sm text-slate-300">
              Select which discovered projects you want to add.
            </p>
            <div className="mt-4 max-h-80 space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-white/5 p-3">
              {importCandidates.map((candidate) => (
                <label
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100"
                  key={candidate.path}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">
                      {candidate.name}
                    </p>
                    <p className="truncate text-xs text-slate-300">
                      {candidate.path}
                    </p>
                  </div>
                  <div className="ml-3 flex shrink-0 items-center gap-3">
                    <span className="text-xs text-slate-300">
                      {candidate.scripts_count} scripts
                    </span>
                    <input
                      checked={selectedImportPaths.includes(candidate.path)}
                      className="h-4 w-4 accent-brand-cyan"
                      onChange={() =>
                        handleToggleImportCandidate(candidate.path)
                      }
                      type="checkbox"
                    />
                  </div>
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/20"
                onClick={handleCancelImportWizard}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-lg bg-brand-cyan/80 px-3 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brand-cyan"
                onClick={() => {
                  void handleConfirmImportWizard();
                }}
                type="button"
              >
                Import selected
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default App;
