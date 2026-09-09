/** Query keys, in one place so PollingSource and the views cannot disagree. */
export const queryKeys = {
  info: ["info"] as const,
  user: ["user"] as const,
  projects: ["projects"] as const,
  labels: ["labels"] as const,
  /** One entry per view; ViewDef.key identifies it. */
  viewTasks: (viewKey: string) => ["tasks", viewKey] as const,
};
