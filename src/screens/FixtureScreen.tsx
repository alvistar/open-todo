import { useState } from "react";
import { fixtureProjects, fixtureTasks } from "../fixtures/tasks";
import { readThemePreference, resolveTheme, setTheme } from "../theme/theme";
import { ListView } from "../ui/ListView";
import { Shell } from "../ui/Shell";
import { Sidebar } from "../ui/Sidebar";
import { ViewTitle, ViewToolbar } from "../ui/ViewHeader";

/**
 * Static render of the shell at the measured layout. It exists so step 1's
 * geometry can be checked against docs/layout-specs.md before any network code
 * exists; step 4 replaces it with the real Inbox.
 */
export function FixtureScreen() {
  const [route, setRoute] = useState("today");
  const [theme, setThemeState] = useState(readThemePreference);
  const resolved = resolveTheme(theme);

  const overdue = fixtureTasks.filter((t) => t.due?.kind === "overdue");
  const today = fixtureTasks.filter((t) => t.due?.kind !== "overdue");

  return (
    <Shell
      sidebar={
        <Sidebar
          userName="Alessandro"
          selected={route}
          inboxCount={3}
          todayCount={14}
          projects={fixtureProjects}
          onSelect={setRoute}
        />
      }
    >
      <ViewToolbar
        themeIcon={resolved === "dark" ? "sun" : "moon"}
        onToggleTheme={() => {
          const next = resolved === "dark" ? "light" : "dark";
          setTheme(next);
          setThemeState(next);
        }}
      />
      <ListView
        header={<ViewTitle title="Today" subtitle={`${fixtureTasks.length} tasks`} />}
        sections={[
          { key: "overdue", title: "Overdue", tasks: overdue },
          { key: "today", title: "9 Sep · Today · Wednesday", tasks: today },
        ]}
      />
    </Shell>
  );
}
