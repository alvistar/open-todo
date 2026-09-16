import { useCallback, useEffect, useMemo, useState } from "react";
import type { Project, Task } from "../api/types";
import { projectIdFromRoute, routeTitle, useRoute } from "../app/route";
import { logOut } from "../auth/authStore";
import { useLiveSource } from "../live/useLiveSource";
import { formatDueLabel, parseVikunjaDate } from "../model/dates";
import { dueDateFromPhrase } from "../model/duePhrase";
import { groupTasksForView } from "../model/grouping";
import { isRealProject, resolveInboxProjectId, sidebarProjects } from "../model/inbox";
import { applyPending } from "../model/pending";
import { listViewId } from "../model/projectViews";
import { type Decision, withDecisions } from "../model/quickadd/decisions";
import { parseQuickAdd, type QuickAddContext } from "../model/quickadd/parse";
import {
  asksTheSameAs,
  filterIdFromProjectId,
  findSavedFilter,
} from "../model/savedFilters";
import { type RowContext, toTaskRow } from "../model/taskRow";
import { titleEdit } from "../model/titleEdit";
import { undoableChange } from "../model/undoableChange";
import {
  inboxView,
  projectView,
  todayView,
  upcomingView,
  type ViewDef,
} from "../model/views";
import { useCompleteTask } from "../queries/useCompleteTask";
import { useCreateTask } from "../queries/useCreateTask";
import { useReorderTask } from "../queries/useReorderTask";
import {
  useAddSubtask,
  useCreateComment,
  useTaskLabel,
  useUpdateReminders,
  useUpdateTask,
} from "../queries/useUpdateTask";
import {
  useLabels,
  useProjects,
  useSavedFilter,
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
import { ToastRegion } from "../ui/ToastRegion";
import { useToasts } from "../ui/useToasts";
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

  /*
   * The list view whose order a project shows (§3). `GET /projects` carries
   * its views inline (§6 item 25), so this is a lookup, not a request - but it
   * is only available once the projects query has answered, and a view built
   * without it keys and orders differently. That is why the key carries the
   * view id: the two spellings must not share a cache entry, or the flat
   * listing's due-date order would render for as long as the id took to
   * resolve and then rearrange itself under the reader.
   */
  const viewIdOf = useCallback(
    (projectId: number): number | undefined =>
      listViewId(projectsQuery.data?.find((p) => p.id === projectId)) ?? undefined,
    [projectsQuery.data],
  );

  /*
   * Today is a query, and a query has nowhere to keep a manual order (mapping
   * §4). Vikunja's answer is the saved filter: it exists as a project under a
   * negative id and owns real views, which accept position writes (§6 items 15
   * and 24). So Today is ordered only if the instance has a filter called
   * Today ASKING THE SAME QUESTION - checked rather than assumed, because a
   * filter produces the task list, so adopting one written by someone else
   * would quietly change what this screen shows.
   */
  const todayFilterProject = findSavedFilter(projectsQuery.data, "Today");
  const todayFilterQuery = useSavedFilter(
    todayFilterProject ? filterIdFromProjectId(todayFilterProject.id) : null,
  );
  const todaySource = useMemo(() => {
    if (!todayFilterProject) return undefined;
    if (!asksTheSameAs(todayFilterQuery.data, todayView().filter)) return undefined;
    const viewId = listViewId(todayFilterProject);
    return viewId === null ? undefined : { projectId: todayFilterProject.id, viewId };
  }, [todayFilterProject, todayFilterQuery.data]);

  // Upcoming is the same arrangement, against its own filter. Both hooks are
  // unconditional because hooks must be, and both cost nothing when the
  // instance has no such filter.
  const upcomingFilterProject = findSavedFilter(projectsQuery.data, "Upcoming");
  const upcomingFilterQuery = useSavedFilter(
    upcomingFilterProject ? filterIdFromProjectId(upcomingFilterProject.id) : null,
  );
  const upcomingSource = useMemo(() => {
    if (!upcomingFilterProject) return undefined;
    if (!asksTheSameAs(upcomingFilterQuery.data, upcomingView().filter)) return undefined;
    const viewId = listViewId(upcomingFilterProject);
    return viewId === null ? undefined : { projectId: upcomingFilterProject.id, viewId };
  }, [upcomingFilterProject, upcomingFilterQuery.data]);

  const view: ViewDef | null = useMemo(() => {
    const projectId = projectIdFromRoute(route);
    if (projectId !== null) {
      const project = projectsQuery.data?.find((p) => p.id === projectId);
      return projectView(projectId, project?.title ?? "Project", viewIdOf(projectId));
    }
    if (route === "inbox") {
      return inboxProjectId === null
        ? null
        : inboxView(inboxProjectId, viewIdOf(inboxProjectId));
    }
    if (route === "upcoming") return upcomingView(upcomingSource);
    if (route === "today") return todayView(todaySource);
    /*
     * Anything else has no view. It used to fall through to Today, which meant
     * the sidebar's Search and Filters entries silently showed a DIFFERENT
     * screen from the one they highlighted - the defect D-detail named, one
     * step worse than a button that does nothing.
     */
    return null;
  }, [route, inboxProjectId, projectsQuery.data, viewIdOf, todaySource, upcomingSource]);

  /**
   * The route the sidebar offers and nothing has built yet. Null for a route
   * with a view, and null while Inbox waits for its project id - that is a
   * load, not a gap.
   */
  const notBuilt = useMemo(() => {
    if (projectIdFromRoute(route) !== null) return null;
    if (route === "inbox" || route === "today" || route === "upcoming") return null;
    return route;
  }, [route]);

  // The sidebar shows Inbox and Today counts regardless of the open view.
  // Both queries key off ViewDef.key, so when one of them *is* the open view
  // TanStack serves a single request rather than two.
  const inboxCountView = useMemo(
    () =>
      inboxProjectId === null
        ? null
        : inboxView(inboxProjectId, viewIdOf(inboxProjectId)),
    [inboxProjectId, viewIdOf],
  );
  const todayCountView = useMemo(() => todayView(todaySource), [todaySource]);
  const inboxTasksQuery = useViewTasks(inboxCountView, timeZone);
  const todayTasksQuery = useViewTasks(todayCountView, timeZone);

  const tasksQuery = useViewTasks(view, timeZone);

  const toasts = useToasts();
  const reordering = useReorderTask(view, timeZone, {
    // Not under the list: it has just snapped back, and the reader may have
    // scrolled away from the row entirely.
    onFailure: (message) => toasts.show({ message, kind: "error" }),
  });

  // Live refresh for the open view (D6): polls while visible, wakes on focus.
  useLiveSource({
    view,
    timeZone,
    enabled: !tasksQuery.isPending,
    // A poll tick landing mid-move would put the row back where it was
    // dragged from, which reads as the move having been refused.
    apply: () => !reordering.isMoving(),
  });

  const completing = useCompleteTask({ timeZone, defaultDueTime });
  const editing = useUpdateTask();
  const reminding = useUpdateReminders();
  const labelling = useTaskLabel();
  const commenting = useCreateComment();
  const subtasking = useAddSubtask();

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

  /*
   * What the list actually shows. A sub-task is shown under its parent and
   * nowhere else, so it is filtered out here - with the SAME predicate the
   * poll uses in `belongs`, which is why `includes` exists on ViewDef.
   *
   * `tasks` stays unfiltered below on purpose: `rowContext.tasksById` resolves
   * the "1 / 3" badge through it, and filtering before building that map would
   * make every badge under-report its own children.
   */
  const visible: Task[] = useMemo(
    () => (view ? tasks.filter((task) => view.includes(task)) : tasks),
    [tasks, view],
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
        ? groupTasksForView(view, visible, rowContext).map((group) => ({
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
    [view, visible, rowContext, completing.pending],
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
    openTaskId === null ? -1 : visible.findIndex((t) => t.id === openTaskId);
  const openTask = openIndex === -1 ? null : visible[openIndex];
  const step = (delta: number) => {
    const next = visible[openIndex + delta];
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
            title={notBuilt ? routeTitle(notBuilt) : (view?.title ?? "open-todo")}
            {...(view?.subtitleFor && !tasksQuery.isPending
              ? { subtitle: view.subtitleFor(visible.length) }
              : {})}
          />
        }
        sections={sections}
        onToggleDone={(row) => {
          const index = visible.findIndex((task) => task.id === row.id);
          const task = visible[index];
          if (task) completing.toggle(task, index);
        }}
        onUndo={(row) => completing.undo(row.id)}
        onOpenTask={(row) => setOpenTaskId(row.id)}
        reorderable={reordering.reorderable}
        onReorder={reordering.reorder}
        footer={
          // No composer on a screen that is not built: there is no list for a
          // new task to join, and creating one would be the only thing the
          // screen could do.
          notBuilt ? null : composerOpen ? (
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
          notBuilt
            ? "This screen is not built yet."
            : error
              ? `Could not load tasks: ${error.message}`
              : tasksQuery.isPending
                ? "Loading…"
                : "Nothing due. Enjoy the quiet."
        }
      />
      {error ? <p className={styles.error}>{error.message}</p> : null}
      <ToastRegion {...toasts} />
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
            /*
             * Captured BEFORE the write and from the server's own copy: the
             * previous value is never reconstructed, which is the rule D-write
             * and D-vocab both keep.
             */
            const change = undoableChange(openTask, values, {
              projectName: (id) =>
                projectsQuery.data?.find((p) => p.id === id)?.title ?? "another project",
              describeDue: (iso) => {
                const when = parseVikunjaDate(iso);
                return when
                  ? formatDueLabel(when, new Date(), timeZone, defaultDueTime)
                  : "no date";
              },
            });
            const fresh = await editing.mutateAsync({ task: openTask, values });
            if (!change) return;
            toasts.show({
              message: change.message,
              action: {
                label: "Undo",
                /*
                 * The task handed back is the one the SERVER returned from
                 * this write, not the stale copy the closure captured.
                 * `updateTask` echoes reminders and assignees off whatever it
                 * is given (its contract), so an older copy would quietly
                 * restore the reminders as they were then.
                 */
                run: async () => {
                  await editing.mutateAsync({ task: fresh, values: change.previous });
                },
              },
            });
          }}
          onSaveReminders={async (reminders) => {
            await reminding.mutateAsync({ task: openTask, reminders });
          }}
          allLabels={labelsQuery.data ?? []}
          onChangeLabel={async (change) => {
            await labelling.mutateAsync({ task: openTask, change });
          }}
          onAddSubtask={async (title) => {
            await subtasking.mutateAsync({ parent: openTask, title });
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
