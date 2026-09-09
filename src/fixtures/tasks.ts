import type { TaskRowModel } from "../model/display";
import type { SidebarProject } from "../ui/Sidebar";

/** Static data for the layout pass; replaced by real queries in step 4. */
// The default project is reached through the Inbox nav row, so it is not
// repeated in the project list.
export const fixtureProjects: SidebarProject[] = [
  { id: 2, title: "Personal", color: "#4073ff", count: 8 },
  { id: 3, title: "Work", color: "#eb8909", count: 37 },
];

export const fixtureTasks: TaskRowModel[] = [
  {
    id: 101,
    title: "Call the accountant about the Q3 filing",
    description: "Ask whether the new invoices change the estimate.",
    priority: 1,
    done: false,
    due: { label: "Yesterday", kind: "overdue" },
    subtasks: { done: 0, total: 3 },
    commentCount: 4,
    projectName: "Work",
  },
  {
    id: 102,
    title: "Book the dentist",
    priority: 2,
    done: false,
    due: { label: "Today 10:00", kind: "today" },
    hasReminder: true,
    projectName: "Personal",
  },
  {
    id: 103,
    title: "Read the Vikunja websocket PR thread",
    priority: 3,
    done: false,
    due: { label: "Tomorrow", kind: "tomorrow" },
    projectName: "Work",
  },
  {
    id: 104,
    title: "Water the plants",
    priority: 4,
    done: false,
    projectName: "Personal",
  },
  {
    id: 105,
    title: "Renew the domain",
    description: "Expires in three weeks; auto-renew is off.",
    priority: 4,
    done: false,
    due: { label: "Mon 15 Sep", kind: "next-week" },
    projectName: "Personal",
  },
];
