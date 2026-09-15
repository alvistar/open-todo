/** Query keys, in one place so PollingSource and the views cannot disagree. */
export const queryKeys = {
  info: ["info"] as const,
  user: ["user"] as const,
  projects: ["projects"] as const,
  labels: ["labels"] as const,
  /** One entry per view; ViewDef.key identifies it. */
  viewTasks: (viewKey: string) => ["tasks", viewKey] as const,
  /*
   * Deliberately NOT under "tasks": the two mutations that invalidate by
   * `queryKey[0] === "tasks"` would otherwise refetch every open task's
   * comments on every completion. The comment mutation invalidates this key
   * itself, and the task list separately for its comment_count.
   */
  taskComments: (taskId: number) => ["task", taskId, "comments"] as const,
};
