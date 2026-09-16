import { describe, expect, it } from "vitest";
import type { Task } from "../api/types";
import {
  escapeSearchTerm,
  MIN_QUERY_LENGTH,
  matchesEveryTerm,
  parseSearchQuery,
  serverSearchTerm,
} from "./search";

const task = (title: string, description = ""): Task =>
  ({ id: 1, title, description, done: false, project_id: 1 }) as Task;

describe("parseSearchQuery", () => {
  it("splits on whitespace", () => {
    expect(parseSearchQuery("mac mini")).toEqual(["mac", "mini"]);
  });

  it("collapses runs of whitespace and trims", () => {
    expect(parseSearchQuery("  mac \t\n  mini  ")).toEqual(["mac", "mini"]);
  });

  it("is empty for a query too short to send", () => {
    // An empty or one-character term makes `s=` return the whole instance
    // (mapping §8.1), so there is nothing worth asking the server.
    expect(parseSearchQuery("")).toEqual([]);
    expect(parseSearchQuery("   ")).toEqual([]);
    expect(parseSearchQuery("a")).toEqual([]);
  });

  it("measures the term that gets sent, not the length of the query", () => {
    // "a b" is two characters typed but `s=a` on the wire, which walks the
    // whole instance. An earlier version counted the query and let it through.
    expect(MIN_QUERY_LENGTH).toBe(2);
    expect(parseSearchQuery("a b")).toEqual([]);
    expect(parseSearchQuery("a b c d")).toEqual([]);
  });

  it("searches when one term is long enough, keeping the short ones", () => {
    // The long term goes to the server; the short ones only narrow what comes
    // back, where their length costs nothing.
    expect(parseSearchQuery("ab c")).toEqual(["ab", "c"]);
  });
});

describe("escapeSearchTerm", () => {
  /*
   * Vikunja interpolates `s=` into a LIKE pattern without escaping, so a term
   * containing % or _ silently searches for something else (mapping §8.1).
   */
  it("escapes the SQL wildcards", () => {
    expect(escapeSearchTerm("50%")).toBe("50\\%");
    expect(escapeSearchTerm("snake_case")).toBe("snake\\_case");
  });

  it("escapes the escape character first, so it cannot be doubled", () => {
    // "a\\%" must become "a\\\\\\%": the backslash the user typed is literal,
    // and the % is still a wildcard needing its own escape.
    expect(escapeSearchTerm("a\\%")).toBe("a\\\\\\%");
  });

  it("leaves an ordinary term alone", () => {
    expect(escapeSearchTerm("notaio")).toBe("notaio");
  });
});

describe("serverSearchTerm", () => {
  it("sends the longest term, which narrows hardest", () => {
    expect(serverSearchTerm(["mac", "amministratore"])).toBe("amministratore");
  });

  it("keeps the first of equally long terms, so the query is stable", () => {
    expect(serverSearchTerm(["beta", "alfa"])).toBe("beta");
  });

  it("escapes what it sends", () => {
    expect(serverSearchTerm(["50%"])).toBe("50\\%");
  });

  it("is null when there is nothing to search for", () => {
    expect(serverSearchTerm([])).toBeNull();
  });
});

describe("matchesEveryTerm", () => {
  it("requires every term, in any order", () => {
    // The server cannot do this: `s=mini Mac` returns 0 because it matches the
    // literal phrase only (mapping §8.1). Narrowing on the client fixes it.
    const t = task("Vendere Mac mini");
    expect(matchesEveryTerm(t, ["mini", "mac"])).toBe(true);
    expect(matchesEveryTerm(t, ["mac", "portatile"])).toBe(false);
  });

  it("searches the description too, like the server does", () => {
    const t = task("Concordare le date", "Notaio: Valentina Michel");
    expect(matchesEveryTerm(t, ["valentina"])).toBe(true);
  });

  it("ignores case, matching the server's own behaviour", () => {
    expect(matchesEveryTerm(task("MAIUSCOLO"), ["maiuscolo"])).toBe(true);
    expect(matchesEveryTerm(task("maiuscolo"), ["MAIUSCOLO"])).toBe(true);
  });

  it("matches inside a word, because the server does", () => {
    // Refining more strictly than the server would drop rows the user can see
    // a reason for: `s=mini` legitimately returns "minimo".
    expect(matchesEveryTerm(task("Decidere prezzo minimo"), ["mini"])).toBe(true);
  });

  it("treats % and _ as ordinary characters", () => {
    // The escaping is for the wire. On the client they are just text.
    expect(matchesEveryTerm(task("sconto 50% oggi"), ["50%"])).toBe(true);
    expect(matchesEveryTerm(task("sconto 50 oggi"), ["50%"])).toBe(false);
    expect(matchesEveryTerm(task("snake_case"), ["snake_case"])).toBe(true);
    expect(matchesEveryTerm(task("snakeXcase"), ["snake_case"])).toBe(false);
  });

  it("does not fold accents, because the server never returned the row", () => {
    // Promising accent-insensitivity here would be a lie: the client can only
    // narrow what came back, and `s=citta` never returns `città` (§8.3).
    expect(matchesEveryTerm(task("città"), ["citta"])).toBe(false);
  });

  it("survives a task with no description", () => {
    expect(matchesEveryTerm({ id: 1, title: "Solo" } as Task, ["solo"])).toBe(true);
  });
});

describe("the length floor guards the wire, not the box", () => {
  it("never yields a server term below the floor", () => {
    // The property that matters: whatever the user types, the term that
    // reaches `s=` is either absent or at least MIN_QUERY_LENGTH long.
    for (const raw of ["", " ", "a", "a b", "a b c", "  a   b  ", "\ta\n"]) {
      expect(serverSearchTerm(parseSearchQuery(raw))).toBeNull();
    }
    for (const raw of ["ab", "ab c", "a bc", "  notaio "]) {
      const term = serverSearchTerm(parseSearchQuery(raw));
      expect(term).not.toBeNull();
      expect((term as string).length).toBeGreaterThanOrEqual(MIN_QUERY_LENGTH);
    }
  });
});
