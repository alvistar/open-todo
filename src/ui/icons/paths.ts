/*
 * open-todo's own icon set (D3: original icons — no Todoist artwork).
 *
 * Every glyph is drawn on a 24x24 grid out of simple geometric primitives and
 * rendered as strokes, so one path list serves all three sizes used by the
 * layout spec (24 nav/toolbar, 16 chips, 12 row metadata).
 */

/** A circle as path data, so an icon is always a flat list of paths. */
function circle(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;
}

export interface IconGlyph {
  /** Stroked outlines. */
  stroke: string[];
  /** Solid shapes (dots, indicators). */
  fill?: string[];
}

const calendarFrame = "M4 6.5h16v13H4zM4 10.5h16M8 3.5v4M16 3.5v4";

export const icons = {
  inbox: {
    stroke: ["M4 13h4l1.5 3h5L16 13h4M6.5 6h11L20 13v5.5H4V13z"],
  },
  today: {
    stroke: [calendarFrame],
    fill: [circle(12, 15, 2)],
  },
  upcoming: {
    stroke: [calendarFrame, "M9 15h6M12 15v-1.5"],
  },
  search: {
    stroke: [circle(11, 11, 6.5), "M15.8 15.8 20.5 20.5"],
  },
  labels: {
    stroke: ["M4 11.5V5a1 1 0 0 1 1-1h6.5L20 12.5 12.5 20z"],
    fill: [circle(8, 8, 1.4)],
  },
  project: {
    stroke: [circle(12, 12, 6)],
  },
  plus: {
    stroke: ["M12 5.5v13M5.5 12h13"],
  },
  check: {
    stroke: ["M5.5 12.5 10 17l8.5-9.5"],
  },
  flag: {
    stroke: ["M6 20.5V4h11l-2.5 4L17 12H6"],
  },
  comment: {
    stroke: ["M4.5 5.5h15v10h-8.5L6.5 19v-3.5h-2z"],
  },
  subtask: {
    stroke: ["M6 4.5v9.5a3 3 0 0 0 3 3h9", "M14.5 13.5 18 17l-3.5 3.5"],
  },
  bell: {
    stroke: ["M7 17v-6a5 5 0 0 1 10 0v6M4.5 17h15M10 20a2 2 0 0 0 4 0"],
  },
  sun: {
    stroke: [
      circle(12, 12, 4.5),
      "M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3 7 7M17 17l1.7 1.7M18.7 5.3 17 7M7 17l-1.7 1.7",
    ],
  },
  moon: {
    stroke: ["M20 14.3A8.2 8.2 0 0 1 9.7 4 7.8 7.8 0 1 0 20 14.3z"],
  },
  sidebar: {
    stroke: ["M4.5 5h15v14h-15zM10 5v14"],
  },
  more: {
    fill: [circle(6, 12, 1.6), circle(12, 12, 1.6), circle(18, 12, 1.6)],
    stroke: [],
  },
  close: {
    stroke: ["M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"],
  },
  chevronDown: {
    stroke: ["M6.5 9.5 12 15l5.5-5.5"],
  },
  chevronRight: {
    stroke: ["M9.5 6.5 15 12l-5.5 5.5"],
  },
  /** The mirror of chevronRight. The task detail's prev/next pair needs both. */
  chevronLeft: {
    stroke: ["M14.5 6.5 9 12l5.5 5.5"],
  },
} satisfies Record<string, IconGlyph>;

export type IconName = keyof typeof icons;
