import {
  composeTitle,
  type QuickAddResult,
  type QuickAddSpan,
  type SpanKind,
} from "./parse";

/*
 * What the user decided about the things the parser recognised.
 *
 * The parser reports; the user disposes. A recognised value can be switched OFF
 * - its words go back into the title and the field is cleared - and a value the
 * parser deliberately withheld can be switched ON. A suggestion is a value that
 * starts off; a removal is a value the user turned off. One mechanism, a
 * different default per span.
 *
 * The key is the span's KIND and its normalised TEXT, never its offsets: the
 * composer re-parses on every keystroke, and offsets move as the line is typed.
 */

export interface Decision {
  kind: SpanKind;
  /** The span's text, lowercased and whitespace-collapsed. */
  text: string;
  on: boolean;
}

/** The form a decision key takes. The composer cannot be trusted to do this. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export const on = (kind: SpanKind, text: string): Decision => ({
  kind,
  text: normalise(text),
  on: true,
});

export const off = (kind: SpanKind, text: string): Decision => ({
  kind,
  text: normalise(text),
  on: false,
});

/**
 * Kinds a line can only have one of. They get the sticky fallback below;
 * `label` does not, because a line can carry several and a kind-only match
 * could not say which.
 */
const SINGLETON: readonly SpanKind[] = [
  "date",
  "time",
  "priority",
  "project",
  "recurrence",
];

/** Whether this span's value is applied, given what the user has said. */
function isApplied(span: QuickAddSpan, decisions: Decision[]): boolean {
  const text = normalise(span.text);
  const exact = decisions.find((d) => d.kind === span.kind && d.text === text);
  if (exact) return exact.on;

  /*
   * The asymmetry, and it is deliberate. A REMOVAL is sticky: once the user
   * has said "not a date", editing the words must not silently bring a date
   * back, so any decision of that kind answers for a span with no exact match.
   * A SUGGESTION is not: it needs an exact yes, so editing the adverb asks
   * again rather than repeating on the user's behalf. An inert removal restores
   * a value nobody wanted; an inert suggestion merely stays off.
   */
  if (span.suggested) return false;
  if (SINGLETON.includes(span.kind)) {
    const any = decisions.find((d) => d.kind === span.kind);
    if (any) return any.on;
  }
  return true;
}

/**
 * Applies the user's decisions to a parse result.
 *
 * Pure, and applied to BOTH the composer's preview and the re-parse at submit
 * time. It has to be both: `submitQuickAdd` re-parses the raw text with a fresh
 * clock, so a decision held only in composer state would be dropped at exactly
 * the moment it was meant to take effect.
 */
export function withDecisions(
  result: QuickAddResult,
  input: string,
  decisions: Decision[],
  defaultProjectId: number | null = null,
): QuickAddResult {
  if (decisions.length === 0) return result;

  const next: QuickAddResult = { ...result, spans: [] };
  let changed = false;

  next.spans = result.spans.map((span) => {
    const applied = isApplied(span, decisions);
    if (applied === !span.off) return span;
    changed = true;

    if (!applied) {
      clear(next, span.kind, defaultProjectId);
      return { ...span, off: true as const };
    }

    if (span.suggestedRepeat) {
      next.repeatAfter = span.suggestedRepeat.repeatAfter;
      if (span.suggestedRepeat.repeatMode !== undefined) {
        next.repeatMode = span.suggestedRepeat.repeatMode;
      }
    }
    const { off: _dropped, ...rest } = span;
    return rest;
  });

  if (!changed) return result;
  next.title = composeTitle(input, next.spans);
  return next;
}

/** Clears the field a span of this kind produced. */
function clear(
  result: QuickAddResult,
  kind: SpanKind,
  defaultProjectId: number | null,
): void {
  switch (kind) {
    case "date":
    case "time":
      result.dueDate = null;
      result.allDay = false;
      break;
    case "priority":
      result.priority = null;
      break;
    case "project":
      result.projectId = null;
      result.effectiveProjectId = defaultProjectId;
      break;
    case "recurrence":
      // Deleted, not set to undefined: parse.ts omits these keys by spread
      // when they are unset, and the absence is the contract.
      delete result.repeatAfter;
      delete result.repeatMode;
      break;
    case "label":
      // A line can carry several; the composer does not show them as chips yet.
      break;
  }
}
