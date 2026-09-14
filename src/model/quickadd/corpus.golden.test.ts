import { describe, expect, it } from "vitest";
// `?raw` rather than node:fs: this is browser-app TypeScript, whose tsconfig
// deliberately carries no node types, and Vite inlines the file either way.
import fixture from "./__fixtures__/corpus.golden.jsonl?raw";
import { type GoldenRecord, goldenContext, shape } from "./__fixtures__/shape";
import { parseQuickAdd } from "./parse";

/*
 * A characterisation gate, not a specification.
 *
 * The 301 hand-written tests around this one encode what §5 DECIDED: one case
 * per table row, plus a pin for each regression someone hit. By construction
 * they cover the surface somebody thought about. They are not a safety net for a
 * refactor, and the proof is that six real parser defects lived underneath them
 * for weeks without turning a single one red.
 *
 * This file is the other half: 738 phrases drawn from Microsoft
 * Recognizers-Text, Facebook Duckling and chrono-node's own suites, replayed
 * against whatever the parser does today. Nothing here asserts that an answer is
 * RIGHT. It asserts that the answer has not MOVED. A failure is not
 * automatically a bug - but it is always a behaviour change that has to be
 * looked at and explained before the fixture is regenerated.
 *
 * Selection rule, in one sentence: every corpus record whose licence allows
 * redistribution and whose text contains a word the date grammar owns, minus the
 * ones vitest already pins by hand. Upstream attributions are in
 * THIRD_PARTY_NOTICES.md at the repo root.
 *
 * Regenerate with `node scripts/quickadd-golden.mjs --write`. That needs the
 * tier-1 corpus lab; running this test does not.
 */

const records: GoldenRecord[] = fixture
  .split("\n")
  .filter((line: string) => line.trim() !== "")
  .map((line: string) => JSON.parse(line) as GoldenRecord);

describe("the committed corpus replays unchanged", () => {
  it("has a fixture to replay", () => {
    // A fixture that silently emptied would turn every assertion below into a
    // no-op, and the suite would go green on a parser that did nothing at all.
    expect(records.length).toBeGreaterThan(700);
  });

  it("agrees with every recorded answer", () => {
    const moved: string[] = [];
    for (const record of records) {
      const actual = shape(
        parseQuickAdd(record.input, goldenContext(new Date(record.now), record.tz)),
        record.input,
        record.tz,
      );
      if (JSON.stringify(actual) !== JSON.stringify(record.ours)) {
        moved.push(
          `${record.id} ${JSON.stringify(record.input)}\n` +
            `  was: ${JSON.stringify(record.ours)}\n` +
            `  now: ${JSON.stringify(actual)}`,
        );
      }
    }
    // Reported in one block rather than one failure per record: a composition
    // change moves hundreds at once, and the shape of the list is the diagnosis.
    expect(
      moved.length === 0
        ? ""
        : `${moved.length} of ${records.length} records changed:\n\n${moved.slice(0, 20).join("\n\n")}` +
            (moved.length > 20 ? `\n\n… and ${moved.length - 20} more` : ""),
    ).toBe("");
  });
});
