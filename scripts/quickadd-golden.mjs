#!/usr/bin/env node
/*
 * Generates src/model/quickadd/__fixtures__/corpus.golden.jsonl.
 *
 *   node scripts/quickadd-golden.mjs --write
 *   node scripts/quickadd-golden.mjs --check     # exits 1 if the fixture is stale
 *
 * WHY A COMMITTED FIXTURE, when a 4325-record corpus lab already exists.
 * The lab lives outside git (research-external/, tier 1, mixed licences). It
 * cannot run in CI, cannot be bisected, and its headline report embeds the
 * worktree HEAD so it never diffs clean across commits. This file is the slice
 * of it that CAN be committed: every record whose licence permits it, replayed
 * by an ordinary vitest file that needs neither Vite nor the lab.
 *
 * WHAT IS IN IT. Licence MIT, BSD-3-Clause or ours; never anything flagged
 * `oracle-derived:dateist`; never an AGPL record. `open-todo` records are
 * excluded too - not for licence reasons but because vitest already pins them
 * by hand, and a second copy is the kind of duplication that rots.
 * See THIRD_PARTY_NOTICES.md for the upstream attributions.
 *
 * WHAT THE ANSWERS MEAN. They are what OUR parser returns today, not what any
 * upstream corpus says is right. This is a characterisation fixture: it exists
 * to make a refactor prove it changed nothing. A row changing is not
 * automatically a bug, but it is always something to look at and explain.
 *
 * Regenerating needs the tier-1 lab present. The fixture is committed, so
 * running the tests does not.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LAB = fileURLToPath(new URL("../../research-external/corpus", import.meta.url));
const UNIFIED = `${LAB}/unified.jsonl`;
const OUT = `${ROOT}src/model/quickadd/__fixtures__/corpus.golden.jsonl`;

const write = process.argv.includes("--write");
const check = process.argv.includes("--check");
if (!write && !check) {
  console.error("usage: quickadd-golden.mjs --write | --check");
  process.exit(2);
}

if (!existsSync(UNIFIED)) {
  console.error(
    `No corpus at ${UNIFIED}.\n` +
      "The fixture is committed, so the tests run without it; only regenerating needs\n" +
      "the tier-1 lab. Build it with `node build-unified.mjs` in research-external/corpus.",
  );
  process.exit(2);
}

/** Licences that may be redistributed inside this MIT repo. */
const ALLOWED = new Set(["MIT", "BSD-3-Clause", "ours"]);

/*
 * The language-dependent surface: every phrase containing a word a language pack
 * owns. This is deliberately the selection rule rather than a random sample,
 * because the pack refactor can only change behaviour on phrases built out of
 * pack vocabulary, and a reviewer should be able to state in one sentence what
 * the fixture covers.
 *
 * `at` and `in` are pack vocabulary too, and deliberately NOT here: they occur in
 * most English prose, so including them pulls in 435 further records that the
 * refactor cannot touch and nobody would read in a diff.
 */
const SURFACE =
  /\b(ore|alle|ogni|every|prossim\w*|feriale|weekday|workday|mese|mesi|settiman\w*|giorn\w*|daily|weekly|monthly|yearly|other|altro|domani|oggi|stasera|ieri|tomorrow|today|tonight|next|tra|fra|fine|end)\b/i;

const records = readFileSync(UNIFIED, "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line))
  .filter(
    (r) =>
      ALLOWED.has(r.licence) &&
      !r.flags.includes("oracle-derived:dateist") &&
      r.source !== "open-todo" &&
      SURFACE.test(r.input),
  )
  .sort((a, b) => (a.id < b.id ? -1 : 1));

const require_ = createRequire(pathToFileURL(`${ROOT}package.json`));
const { createServer } = await import(pathToFileURL(require_.resolve("vite")).href);
const server = await createServer({
  root: ROOT,
  configFile: `${ROOT}vite.config.ts`,
  server: { middlewareMode: true },
  logLevel: "silent",
});

let out = "";
try {
  const { parseQuickAdd } = await server.ssrLoadModule("/src/model/quickadd/parse.ts");
  const { goldenContext, shape } = await server.ssrLoadModule(
    "/src/model/quickadd/__fixtures__/shape.ts",
  );

  for (const record of records) {
    const now = new Date(record.now);
    const tz = record.tz;
    const result = parseQuickAdd(record.input, goldenContext(now, tz));
    out += `${JSON.stringify({
      id: record.id,
      input: record.input,
      now: record.now,
      lang: record.lang,
      tz,
      ours: shape(result, record.input, tz),
    })}\n`;
  }
} finally {
  await server.close();
}

if (check) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current === out) {
    console.log(`corpus.golden.jsonl is current (${records.length} records).`);
    process.exit(0);
  }
  console.error(
    "corpus.golden.jsonl is STALE. The parser's answers moved.\n" +
      "Regenerate with `node scripts/quickadd-golden.mjs --write` and review the diff\n" +
      "line by line: every changed row is a behaviour change that needs explaining.",
  );
  process.exit(1);
}

writeFileSync(OUT, out);
console.log(`${records.length} records -> ${OUT}`);
const byLang = {};
const bySource = {};
for (const r of records) {
  byLang[r.lang] = (byLang[r.lang] ?? 0) + 1;
  bySource[r.source] = (bySource[r.source] ?? 0) + 1;
}
console.log("  by lang:  ", JSON.stringify(byLang));
console.log("  by source:", JSON.stringify(bySource));
