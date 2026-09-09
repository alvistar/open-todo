import { useCallback, useEffect, useMemo, useState } from "react";
import type { Project, Task } from "../api/types";
import { projectIdFromRoute, useRoute } from "../app/route";
import { logOut } from "../auth/authStore";
import { useLiveSource } from "../live/useLiveSource";
import { groupTasksForView } from "../model/grouping";
import { resolveInboxProjectId, sidebarProjects } from "../model/inbox";
import { parseQuickAdd, type QuickAddContext } from "../model/quickadd/parse";
import { type RowContext, toTaskRow } from "../model/taskRow";
import { inboxView, projectView, todayView, type ViewDef } from "../model/views";
import { useCreateTask } from "../queries/useCreateTask";
import { useLabels, useProjects, useUser, useViewTasks } from "../queries/useVikunja";
import { readThemePreference, resolveTheme, setTheme } from "../theme/theme";
import { ListView } from "../ui/ListView";
import { AddTaskAffordance, QuickAdd } from "../ui/QuickAdd";
import { Shell } from "../ui/Shell";
import { Sidebar } from "../ui/Sidebar";
import { ViewTitle, ViewToolbar } from "../ui/ViewHeader";
import styles from "./AppScreen.module.css";

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
}

export function AppScreen() {
  const [route, navigate] = useRoute();
  const [theme, setThemeState] = useState(readThemePreference);
  const resolvedTheme = resolveTheme(theme);

  const userQuery = useUser();
  const projectsQuery = useProjects();

  /*
   * The BROWSER's zone, not Vikunja's `settings.timezone`.
   *
   * That setting is frequently left at an install default — on the reference
   * instance it reads "GMT" while the user is in Italy — and honouring it
   * would shift every displayed time by an hour or two. It also has to agree
   * with `filter_timezone`, which decides what the server puts in Today:
   * filtering in one zone and labelling in another can show a task under
   * "Today" that reads as tomorrow. One zone, and it is the one the person is
   * actually in. The server setting is only a fallback for a runtime whose
   * Intl cannot resolve a zone.
   */
  const timeZone = browserTimeZone() || userQuery.data?.settings?.timezone || "UTC";
  const defaultDueTime =
    userQuery.data?.settings?.frontend_settings?.default_due_time ?? null;

  const inboxProjectId = resolveInboxProjectId(userQuery.data, projectsQuery.data);
  const projects = sidebarProjects(projectsQuery.data, inboxProjectId);

  const view: ViewDef | null = useMemo(() => {
    const projectId = projectIdFromRoute(route);
    if (projectId !== null) {
      const project = projectsQuery.data?.find((p) => p.id === projectId);
      return projectView(projectId, project?.title ?? "Project");
    }
    if (route === "inbox") {
      return inboxProjectId === null ? null : inboxView(inboxProjectId);
    }
    return todayView();
  }, [route, inboxProjectId, projectsQuery.data]);

  // The sidebar shows Inbox and Today counts regardless of the open view.
  // Both queries key off ViewDef.key, so when one of them *is* the open view
  // TanStack serves a single request rather than two.
  const inboxCountView = useMemo(
    () => (inboxProjectId === null ? null : inboxView(inboxProjectId)),
    [inboxProjectId],
  );
  const todayCountView = useMemo(() => todayView(), []);
  const inboxTasksQuery = useViewTasks(inboxCountView, timeZone);
  const todayTasksQuery = useViewTasks(todayCountView, timeZone);

  const tasksQuery = useViewTasks(view, timeZone);

  // Live refresh for the open view (D6): polls while visible, wakes on focus.
  useLiveSource({ view, timeZone, enabled: !tasksQuery.isPending });
  const tasks: Task[] = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);

  const rowContext: RowContext = useMemo(() => {
    const projectsById = new Map<number, Project>(
      (projectsQuery.data ?? []).map((p) => [p.id, p]),
    );
    return {
      now: new Date(),
      timeZone,
      defaultDueTime,
      projectsById,
      showProject: view?.showProject ?? false,
      tasksById: new Map(tasks.map((t) => [t.id, t])),
    };
  }, [projectsQuery.data, tasks, timeZone, defaultDueTime, view?.showProject]);

  const sections = useMemo(
    () =>
      view
        ? groupTasksForView(view, tasks, rowContext).map((group) => ({
            key: group.key,
            ...(group.title ? { title: group.title } : {}),
            tasks: group.tasks.map((task) => toTaskRow(task, rowContext)),
          }))
        : [],
    [view, tasks, rowContext],
  );

  const labelsQuery = useLabels();
  const createTask = useCreateTask();
  const [composerOpen, setComposerOpen] = useState(false);

  const quickAddContext: QuickAddContext = useMemo(
    () => ({
      now: new Date(),
      timeZone,
      defaultDueTime,
      // A task typed inside a project view belongs to that project unless the
      // phrase says otherwise.
      defaultProjectId: projectIdFromRoute(route) ?? inboxProjectId,
      projects: (projectsQuery.data ?? []).map((p) => ({ id: p.id, title: p.title })),
      labels: (labelsQuery.data ?? []).map((l) => ({ id: l.id, title: l.title })),
    }),
    [
      timeZone,
      defaultDueTime,
      route,
      inboxProjectId,
      projectsQuery.data,
      labelsQuery.data,
    ],
  );

  const submitQuickAdd = useCallback(
    async (text: string) => {
      await createTask.mutateAsync(parseQuickAdd(text, quickAddContext));
    },
    [createTask, quickAddContext],
  );

  // "a" opens the composer, the way Todoist does; ignored while typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (composerOpen || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (event.key === "a") {
        event.preventDefault();
        setComposerOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [composerOpen]);

  const error = tasksQuery.error ?? projectsQuery.error;

  return (
    <Shell
      sidebar={
        <Sidebar
          userName={userQuery.data?.name || userQuery.data?.username || "open-todo"}
          {...(inboxTasksQuery.data ? { inboxCount: inboxTasksQuery.data.length } : {})}
          {...(todayTasksQuery.data ? { todayCount: todayTasksQuery.data.length } : {})}
          selected={route}
          projects={projects.map((p) => ({
            id: p.id,
            title: p.title,
            ...(p.hex_color ? { color: `#${p.hex_color.replace(/^#/, "")}` } : {}),
          }))}
          onSelect={navigate}
          onLogOut={logOut}
          onAddTask={() => setComposerOpen(true)}
        />
      }
    >
      <ViewToolbar
        themeIcon={resolvedTheme === "dark" ? "sun" : "moon"}
        onToggleTheme={() => {
          const next = resolvedTheme === "dark" ? "light" : "dark";
          setTheme(next);
          setThemeState(next);
        }}
      />
      <ListView
        header={
          <ViewTitle
            title={view?.title ?? "open-todo"}
            {...(view?.subtitleFor && !tasksQuery.isPending
              ? { subtitle: view.subtitleFor(tasks.length) }
              : {})}
          />
        }
        sections={sections}
        footer={
          composerOpen ? (
            <QuickAdd
              context={quickAddContext}
              onSubmit={submitQuickAdd}
              onCancel={() => setComposerOpen(false)}
              busy={createTask.isPending}
            />
          ) : (
            <AddTaskAffordance onOpen={() => setComposerOpen(true)} />
          )
        }
        emptyMessage={
          error
            ? `Could not load tasks: ${error.message}`
            : tasksQuery.isPending
              ? "Loading…"
              : "Nothing due. Enjoy the quiet."
        }
      />
      {error ? <p className={styles.error}>{error.message}</p> : null}
    </Shell>
  );
}
