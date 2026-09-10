#!/usr/bin/env node
/*
 * Corpus diff for the quick-add date layer (D-vocab).
 *
 * Runs every phrase below through the CURRENT `matchWhen` and through the one
 * at BASELINE_REF, and prints only what changed. The output is the evidence for
 * the "Deliberate behaviour changes" list - the point is that the list is read
 * off a run rather than written from memory, because the whole failure this
 * change fixes was a vocabulary nobody had enumerated.
 *
 *   node scripts/quickadd-corpus-diff.mjs
 *
 * Modules are loaded through Vite rather than plain node: the sources are TS
 * with extensionless imports, which node's ESM resolver will not take.
 */

import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

/*
 * The D-parser commit, before any of D-vocab. Overridable, because once this
 * branch is squash-merged the default is the only thing here that can rot:
 *
 *   node scripts/quickadd-corpus-diff.mjs <ref>
 */
const BASELINE_REF = process.argv[2] ?? "d3d0a4a";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
/*
 * The baseline has to sit inside the package or its own `./vocabulary` import
 * will not resolve. It is git-ignored, since a crash before the `finally` would
 * otherwise leave a stray .ts that biome, tsc and vitest all pick up.
 */
const BASELINE_FILE = "src/model/quickadd/.datePhrase.baseline.tmp.ts";
const BASELINE_PATH = new URL(BASELINE_FILE, `file://${ROOT}`);

const TZ = "Europe/Rome";
/** Thursday 10 September 2026, 09:00 in Rome. */
const NOW = new Date("2026-09-10T07:00:00Z");

// biome-ignore format: grouped by §5 row so the corpus reads as the table
const CORPUS = [
  // §5 rows that must keep working.
  "today", "oggi", "tomorrow", "domani", "dopodomani", "tonight", "stasera",
  "tomorrow morning", "domani sera", "sabato mattina", "friday afternoon",
  "friday", "venerdì", "lunedi", "mercoledì", "next friday", "next wednesday",
  "venerdì prossimo", "prossimo venerdì",
  "in 3 days", "in 2 weeks", "in 1 month", "tra 3 giorni", "fra 3 giorni",
  "tra 2 settimane", "tra una settimana", "tra un mese",
  "next week", "next month", "la settimana prossima", "prossima settimana",
  "il mese prossimo", "end of month", "fine mese",
  "2026-09-15", "30 apr", "Apr 30", "30 dic", "1 jan", "29 feb", "29 febbraio",
  "15 settembre", "settembre 15", "15 sep 2027", "15 set 2027", "15/9", "13/10",
  "at 10", "alle 10", "10:30", "3pm", "12pm",
  "tomorrow at 10:30", "domani alle 20:30", "call tomorrow at 3pm",
  "call mum domani       alle 10", "standup tomorrow", "gym wednesday",
  // Out of grammar: the reason this change exists.
  "I sat down with the team", "I sat at 10 with the team",
  "I sat with the team tomorrow", "il mar mosso", "il mar alle 10 mosso",
  "call next mon", "March report", "marzo report", "Friday to Monday",
  "call in 2 hours", "chiama tra 2 ore", "this Wednesday", "weekend plans",
  "this weekend", "fine settimana", "feb 29", "Sep 15",
  "lun", "ven", "gio", "sab", "dom", "mon", "sat", "wed",
  "yesterday", "ieri", "last friday", "next year",
  "buy now pay later", "give me a sec", "after a sec", "in a minute", "a second",
  "x 45/13 15/9", "30 feb", "buy 3 apples",
  // Leap-day phrasings, which the retry owns.
  "party 29 feb", "29 feb party", "party 29 feb please",
];

const show = (m) =>
  m === null
    ? "no date"
    : `${new Intl.DateTimeFormat("en-CA", {
        timeZone: TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(m.date)}  span=${JSON.stringify(m.text)}`;

/** Tolerates both the pre- and post-D-vocab return shapes. */
const asMatch = (r) => (r && "when" in r ? r.when : r);

const baselineSource = execFileSync(
  "git",
  ["show", `${BASELINE_REF}:src/model/quickadd/datePhrase.ts`],
  { cwd: ROOT, encoding: "utf8" },
);
writeFileSync(
  new URL(BASELINE_FILE, import.meta.url.replace(/scripts\/.*$/, "")),
  baselineSource,
);

const server = await createServer({ root: ROOT, server: { middlewareMode: true } });
try {
  const before = await server.ssrLoadModule(`/${BASELINE_FILE}`);
  const after = await server.ssrLoadModule("/src/model/quickadd/datePhrase.ts");

  let changed = 0;
  for (const phrase of CORPUS) {
    const a = show(asMatch(before.matchWhen(phrase, NOW, TZ)));
    const b = show(asMatch(after.matchWhen(phrase, NOW, TZ)));
    if (a === b) continue;
    changed += 1;
    console.log(`${JSON.stringify(phrase)}\n    was  ${a}\n    now  ${b}`);
  }
  console.log(
    `\n${changed} of ${CORPUS.length} phrases changed (baseline ${BASELINE_REF}).`,
  );
} finally {
  await server.close();
  rmSync(new URL(BASELINE_FILE, import.meta.url.replace(/scripts\/.*$/, "")), {
    force: true,
  });
}
