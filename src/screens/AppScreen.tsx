import { useCallback, useEffect, useMemo, useState } from "react";
import type { Project, Task } from "../api/types";
import { projectIdFromRoute, useRoute } from "../app/route";
import { logOut } from "../auth/authStore";
import { useLiveSource } from "../live/useLiveSource";
import { dueDateFromPhrase } from "../model/duePhrase";
import { groupTasksForView } from "../model/grouping";
import { isRealProject, resolveInboxProjectId, sidebarProjects } from "../model/inbox";
import { applyPending } from "../model/pending";
import { type Decision, withDecisions } from "../model/quickadd/decisions";
import { parseQuickAdd, type QuickAddContext } from "../model/quickadd/parse";
import { type RowContext, toTaskRow } from "../model/taskRow";
import { titleEdit } from "../model/titleEdit";
import { inboxView, projectView, todayView, type ViewDef } from "../model/views";
import { useCompleteTask } from "../queries/useCompleteTask";
import { useCreateTask } from "../queries/useCreateTask";
import {
  useCreateComment,
  useTaskLabel,
  useUpdateReminders,
  useUpdateTask,
} from "../queries/useUpdateTask";
import {
  useLabels,
  useProjects,
  useTaskComments,
  useUser,
  useViewTasks,
} from "../queries/useVikunja";
import { readThemePreference, resolveTheme, setTheme } from "../theme/theme";
import { TaskDetail } from "../ui/detail/TaskDetail";
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

  const completing = useCompleteTask({ timeZone, defaultDueTime });
  const editing = useUpdateTask();
  const reminding = useUpdateReminders();
  const labelling = useTaskLabel();
  const commenting = useCreateComment();

  // Navigating away drops the pending rows: they are a few seconds of "you
  // just did this", not a place tasks are kept (D-write).
  const viewKey = view?.key;
  const resetPending = completing.reset;
  useEffect(() => {
    // The guard is also what makes viewKey a read rather than a bare trigger:
    // nothing is pending before a view exists, so there is nothing to drop.
    if (viewKey === undefined) return;
    resetPending();
  }, [viewKey, resetPending]);

  /*
   * The pending overlay goes on BEFORE grouping, so a completed row keeps its
   * place in its section instead of jumping to the end, and so a row the poll
   * has already dropped is put back for the rest of its linger.
   */
  const tasks: Task[] = useMemo(
    () => applyPending(tasksQuery.data ?? [], completing.pending),
    [tasksQuery.data, completing.pending],
  );

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
            tasks: group.tasks.map((task) => {
              const row = toTaskRow(task, rowContext);
              const pending = completing.pending.get(task.id);
              if (!pending) return row;
              return {
                ...row,
                ...(pending.message ? { note: pending.message } : {}),
                ...(pending.kind === "completed" ? { undoable: true } : {}),
              };
            }),
          }))
        : [],
    [view, tasks, rowContext, completing.pending],
  );

  const labelsQuery = useLabels();
  const createTask = useCreateTask();
  const [composerOpen, setComposerOpen] = useState(false);
  /** The task whose detail is open, by id; it is read back out of `tasks`. */
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);
  const commentsQuery = useTaskComments(openTaskId);

  /*
   * Where the detail dialog can move a task. The Inbox is named first because
   * it is not in `sidebarProjects` - that list leaves it out precisely so the
   * sidebar does not show it twice - and an archived project is not a place a
   * task can be put.
   */
  const moveTargets = useMemo(
    () => [
      ...(inboxProjectId === null
        ? []
        : [
            {
              id: inboxProjectId,
              title:
                projectsQuery.data?.find((p) => p.id === inboxProjectId)?.title ??
                "Inbox",
            },
          ]),
      ...projects.map((p) => ({ id: p.id, title: p.title })),
    ],
    [inboxProjectId, projectsQuery.data, projects],
  );

  /*
   * `now` here is only for the composer's live preview. The value written to
   * Vikunja is taken at submit time instead: none of this memo's dependencies
   * change with the clock, so a tab left open overnight would keep parsing
   * "tomorrow" against yesterday's date - and the row display, which the poll
   * refreshes, would look right while the stored due_date was a day out.
   */
  const quickAddContext: QuickAddContext = useMemo(
    () => ({
      now: new Date(),
      timeZone,
      defaultDueTime,
      // A task typed inside a project view belongs to that project unless the
      // phrase says otherwise.
      defaultProjectId: projectIdFromRoute(route) ?? inboxProjectId,
      // Saved filters come back from GET /projects too, with negative ids. A
      // task cannot live in a query, so "#Today" must not resolve to one.
      projects: (projectsQuery.data ?? [])
        .filter(isRealProject)
        .map((p) => ({ id: p.id, title: p.title })),
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

  /*
   * Read the clock HERE, not from `quickAddContext` above: that memo's `now` is
   * pinned for the composer's live preview, and the date picker resolves its
   * phrase at the moment of the pick. Sharing the memo would make "tomorrow"
   * mean yesterday-plus-one in a tab left open overnight - the same trap
   * `submitQuickAdd` re-reads the clock to avoid.
   */
  const readDuePhrase = useCallback(
    (phrase: string) =>
      dueDateFromPhrase(phrase, { ...quickAddContext, now: new Date() }),
    [quickAddContext],
  );

  const submitQuickAdd = useCallback(
    async (text: string, decisions: Decision[]): Promise<string[]> => {
      /*
       * Re-read the clock here, not from the memo above - and re-apply the
       * user's decisions to THIS parse. The re-parse starts from the raw text,
       * so a decision left in composer state would be dropped at exactly the
       * moment it was meant to take effect: the date you switched off would be
       * back on the saved task. The keys are text-based, so they survive a
       * parse whose resolved dates differ.
       */
      const parsed = withDecisions(
        parseQuickAdd(text, { ...quickAddContext, now: new Date() }),
        text,
        decisions,
        quickAddContext.defaultProjectId,
      );
      const labelNames = Object.fromEntries(
        quickAddContext.labels.map((l) => [l.id, l.title]),
      );
      const result = await createTask.mutateAsync({ parsed, labelNames });
      return result.failedLabels.map(
        (name) => `Task added, but the label "${name}" could not be attached.`,
      );
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

  /*
   * The open task is READ BACK from the view's list rather than held as its
   * own copy, so the poll keeps an open dialog current and nothing has to
   * reconcile two versions of the same task. A task that leaves the view -
   * completed elsewhere, rescheduled out of Today - takes its dialog with it.
   */
  const openIndex =
    openTaskId === null ? -1 : tasks.findIndex((t) => t.id === openTaskId);
  const openTask = openIndex === -1 ? null : tasks[openIndex];
  const step = (delta: number) => {
    const next = tasks[openIndex + delta];
    if (next) setOpenTaskId(next.id);
  };

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
        onToggleDone={(row) => {
          const index = tasks.findIndex((task) => task.id === row.id);
          const task = tasks[index];
          if (task) completing.toggle(task, index);
        }}
        onUndo={(row) => completing.undo(row.id)}
        onOpenTask={(row) => setOpenTaskId(row.id)}
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
      {openTask ? (
        <TaskDetail
          task={openTask}
          projectName={
            projectsQuery.data?.find((p) => p.id === openTask.project_id)?.title ??
            "Inbox"
          }
          projects={moveTargets}
          readDuePhrase={readDuePhrase}
          now={rowContext.now}
          timeZone={timeZone}
          defaultDueTime={defaultDueTime}
          onClose={() => setOpenTaskId(null)}
          onSave={async (values) => {
            await editing.mutateAsync({ task: openTask, values });
          }}
          onSaveReminders={async (reminders) => {
            await reminding.mutateAsync({ task: openTask, reminders });
          }}
          allLabels={labelsQuery.data ?? []}
          onChangeLabel={async (change) => {
            await labelling.mutateAsync({ task: openTask, change });
          }}
          comments={commentsQuery.data ?? []}
          commentsLoading={commentsQuery.isPending && openTaskId !== null}
          onAddComment={async (html) => {
            await commenting.mutateAsync({ taskId: openTask.id, comment: html });
          }}
          readTitleEdit={(raw) =>
            titleEdit(raw, openTask, { ...quickAddContext, now: new Date() })
          }
          onSaveTitle={async (raw) => {
            /*
             * Re-read, with a fresh clock, rather than trusting the preview:
             * the memo's `now` is pinned, and "tomorrow" typed into a tab left
             * open overnight would otherwise save yesterday-plus-one. Same
             * discipline as `submitQuickAdd`.
             */
            const edit = titleEdit(raw, openTask, {
              ...quickAddContext,
              now: new Date(),
            });
            if (!edit.values) throw new Error(edit.problem ?? "Could not save.");

            /*
             * Columns first, in ONE write, then the labels. A label that fails
             * to attach therefore leaves a task whose name and date are
             * already right, rather than a half-written row.
             */
            const saved = await editing.mutateAsync({
              task: openTask,
              values: edit.values,
            });
            let current = saved;
            for (const labelId of edit.addLabelIds) {
              current = await labelling.mutateAsync({
                task: current,
                change: { labelId, attached: true },
              });
            }
          }}
          {...(openIndex > 0 ? { onPrev: () => step(-1) } : {})}
          {...(openIndex >= 0 && openIndex < tasks.length - 1
            ? { onNext: () => step(1) }
            : {})}
        />
      ) : null}
    </Shell>
  );
}
