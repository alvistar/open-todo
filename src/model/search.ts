import type { Task } from "../api/types";

/**
 * The shortest term worth sending to the server.
 *
 * `s=` with an empty term returns everything and a single character returns
 * most of it (mapping §8.1, ported with this module from `read-handover`) — a page of unrelated tasks is a worse answer than
 * an empty search box, and it costs a full walk of the instance to produce.
 *
 * The floor is on the TERM THAT GETS SENT, not on the query's total length.
 * Counting the whole query let "a b" through: two characters typed, but the
 * term that reached the wire was `s=a`, which is the very request this exists
 * to prevent.
 */
export const MIN_QUERY_LENGTH = 2;

/**
 * Splits a raw query into terms, or into nothing when none of them is long
 * enough to ask the server for.
 *
 * A query is searchable when at least ONE term clears the floor: the longest
 * is what goes to the server, and the short ones ride along as client-side
 * narrowing where their length costs nothing. So "ab c" searches and "a b"
 * does not.
 */
export function parseSearchQuery(raw: string): string[] {
  const terms = raw.split(/\s+/).filter((term) => term.length > 0);
  const longest = terms.reduce((max, term) => Math.max(max, term.length), 0);
  return longest < MIN_QUERY_LENGTH ? [] : terms;
}

/**
 * Escapes a term for Vikunja's `s=`.
 *
 * Vikunja interpolates the term into a LIKE pattern without escaping it, so
 * `50%` searches for "50 followed by anything" and quietly answers with the
 * wrong tasks. A backslash escapes both wildcards; verified against a probe
 * task actually titled `zqprobe sconto 50% e snake_case` (mapping §8.1).
 *
 * The backslash goes first. Escaping the wildcards first would then escape the
 * backslashes this function just added, turning `%` back into a wildcard.
 */
export function escapeSearchTerm(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&");
}

/**
 * The single term to ask the server for.
 *
 * Only one, because `s=` matches a literal phrase: `Mac mini` finds nine tasks
 * and `mini Mac` finds none (mapping §8.1). Sending the whole query would make
 * word order matter, which no search box should. The longest term goes instead
 * — it is the most selective, so the client has least left to discard — and
 * the rest are applied by `matchesEveryTerm`.
 */
export function serverSearchTerm(terms: string[]): string | null {
  let longest: string | null = null;
  for (const term of terms) {
    if (longest === null || term.length > longest.length) longest = term;
  }
  return longest === null ? null : escapeSearchTerm(longest);
}

/**
 * True when every term appears in the task's title or description.
 *
 * This only ever narrows the server's answer, which is what makes it sound:
 * the client cannot invent a task the query never returned. It buys an
 * order-independent AND over a backend that has none, and nothing more — in
 * particular NOT accent-insensitivity, since `s=citta` never returns `città`
 * for the client to keep (mapping §8.3).
 *
 * Substring, not word, matching: the server answers `mini` with `minimo`, and
 * refining more strictly than the server would drop rows for no reason the
 * user could see.
 */
export function matchesEveryTerm(task: Task, terms: string[]): boolean {
  const haystack = `${task.title} ${task.description ?? ""}`.toLowerCase();
  return terms.every((term) => haystack.includes(term.toLowerCase()));
}
