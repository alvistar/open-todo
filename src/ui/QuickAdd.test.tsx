import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QuickAddContext } from "../model/quickadd/parse";
import { QuickAdd } from "./QuickAdd";
import styles from "./QuickAdd.module.css";

/*
 * The composer's half of D-vocab. The parser tests pin what parseQuickAdd
 * returns; nothing pinned that the composer PAINTS it. That distinction is the
 * whole feature: a correct parser whose warning never reaches the screen is a
 * capability removed with no explanation, which is worse than the bug D-vocab
 * fixed. Found missing by /qa on 2026-09-10, when driving the real composer
 * turned out to need a login the run could not perform.
 */

const TZ = "Europe/Rome";
// Wednesday 9 September 2026, 10:00 in Rome.
const NOW = new Date("2026-09-09T08:00:00Z");

const ctx = (over: Partial<QuickAddContext> = {}): QuickAddContext => ({
  now: NOW,
  timeZone: TZ,
  defaultDueTime: null,
  defaultProjectId: 1,
  projects: [
    { id: 1, title: "Inbox" },
    { id: 3, title: "Work" },
  ],
  labels: [{ id: 10, title: "phone" }],
  ...over,
});

/** Renders the composer and types `text` into it. */
function compose(text: string) {
  const { container } = render(
    <QuickAdd context={ctx()} onSubmit={vi.fn(async () => [])} onCancel={vi.fn()} />,
  );
  const input = screen.getByRole("textbox") as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: text } });
  return { input, container };
}

/**
 * The recognised runs the overlay paints. They are `span.mark` from the CSS
 * module, NOT `<mark>` elements: querying the tag name matches nothing here on
 * any input, so a test written that way passes without asserting anything.
 */
const marks = (container: HTMLElement) =>
  [...container.querySelectorAll(`.${styles.mark}`)].map((m) => m.textContent);

const OUT_OF_GRAMMAR =
  '"sat" is not a date open-todo recognises and was kept in the task name.';

describe("QuickAdd — a phrase outside §5", () => {
  it("shows the warning on screen", () => {
    compose("I sat down with the team");
    expect(screen.getByText(OUT_OF_GRAMMAR)).toBeInTheDocument();
  });

  it("leaves the typed text whole", () => {
    const { input } = compose("I sat down with the team");
    expect(input.value).toBe("I sat down with the team");
  });

  it("leaves the date chip empty", () => {
    // "Date" is the chip's empty label. Asserting the placeholder alone would
    // also pass on a WRONG date, so the accepted case is pinned beside it.
    compose("I sat down with the team");
    expect(screen.getByText("Date")).toBeInTheDocument();
    cleanup();
    compose("domani");
    expect(screen.queryByText("Date")).not.toBeInTheDocument();
    expect(screen.getByText("Tomorrow")).toBeInTheDocument();
  });

  it("highlights nothing, so no word looks consumed", () => {
    const { container } = compose("I sat down with the team");
    expect(marks(container)).toEqual([]);
  });

  it("does highlight the words it did consume", () => {
    // The negative case above passes just as well on a composer that never
    // highlights anything, so the positive one is pinned beside it. "ore" is the
    // phrasing to use: its offsets used to be translated back from a probe
    // string and now come straight from chrono, so this is where a provenance
    // slip would show up as a highlight sitting on the wrong words.
    const { container } = compose("dentista domenica ore 15 #Work");
    expect(marks(container)).toEqual(["domenica ore 15", "#Work"]);
  });

  it("still lets the task be created, since the title survived", () => {
    compose("I sat down with the team");
    expect(screen.getByLabelText("Add task")).not.toBeDisabled();
  });
});

describe("QuickAdd — a warning and a date in the same line", () => {
  it("shows both", () => {
    compose("I sat with the team domani");
    expect(screen.getByText(OUT_OF_GRAMMAR)).toBeInTheDocument();
    // The chip stops saying "Date" once a real date is found.
    expect(screen.queryByText("Date")).not.toBeInTheDocument();
  });
});

describe("QuickAdd — phrases that must stay quiet", () => {
  it("says nothing about chrono's instant idioms", () => {
    const { container } = compose("buy now pay later");
    expect(container.textContent).not.toContain("is not a date open-todo recognises");
    expect(screen.getByText("Date")).toBeInTheDocument();
  });

  it("says nothing about a bare time", () => {
    const { container } = compose("call at 10");
    expect(container.textContent).not.toContain("is not a date open-todo recognises");
  });

  it("warns once, not once per locale", () => {
    compose("weekend plans");
    expect(
      screen.getAllByText(
        '"weekend" is not a date open-todo recognises and was kept in the task name.',
      ),
    ).toHaveLength(1);
  });
});

describe("QuickAdd — a quoted line", () => {
  it("takes the text literally, with no date and no warning", () => {
    const { input } = compose('"Buy milk tomorrow"');
    expect(input.value).toBe('"Buy milk tomorrow"');
    expect(screen.getByText("Date")).toBeInTheDocument();
    expect(screen.getByLabelText("Add task")).not.toBeDisabled();
  });

  it("leaves the submit button disabled on an empty quoted line", () => {
    compose('""');
    expect(screen.getByLabelText("Add task")).toBeDisabled();
  });
});
