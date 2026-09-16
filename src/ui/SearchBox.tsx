import { useEffect, useRef, useState } from "react";
import { MIN_QUERY_LENGTH, parseSearchQuery } from "../model/search";
import { Icon } from "./icons/Icon";
import styles from "./SearchBox.module.css";

export interface SearchBoxProps {
  /** The query in the URL — the committed search, not what is being typed. */
  query: string;
  onSearch: (query: string) => void;
}

/**
 * The search field.
 *
 * It submits rather than searching as you type. Every keystroke would be a
 * walk of the instance's tasks (`s=` has no index behind it that we know of),
 * and the URL is the state — typing "notaio" would push six history entries.
 */
export function SearchBox({ query, onSearch }: SearchBoxProps) {
  const [draft, setDraft] = useState(query);

  // A committed search arriving from elsewhere - the back button, a link -
  // has to win over a stale draft, or the box would disagree with the results.
  useEffect(() => setDraft(query), [query]);

  const inputRef = useRef<HTMLInputElement>(null);

  /*
   * Focus on mount. Deliberately not the autoFocus attribute: that rule exists
   * to stop a page stealing focus on load, and this is a route the user
   * reached by clicking "Search", where typing is the only thing to do.
   */
  useEffect(() => inputRef.current?.focus(), []);

  // The model owns the rule; spelling it again here would let the two drift.
  const tooShort = parseSearchQuery(draft).length === 0;

  return (
    <>
      {/* <search> is the landmark; the <form> inside it carries the submit. */}
      <search>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (!tooShort) onSearch(draft);
          }}
        >
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            className={styles.input}
            type="search"
            value={draft}
            aria-label="Search tasks"
            placeholder="Search tasks"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && draft !== "") {
                // Clear the box before letting Escape reach anything else.
                event.preventDefault();
                event.stopPropagation();
                setDraft("");
              }
            }}
          />
          {draft === "" ? null : (
            <button
              type="button"
              className={styles.clear}
              aria-label="Clear search"
              onClick={() => {
                setDraft("");
                onSearch("");
              }}
            >
              <Icon name="close" size={16} />
            </button>
          )}
          <button type="submit" className={styles.submit}>
            Search
          </button>
        </form>
      </search>
      {draft !== "" && tooShort ? (
        <p className={styles.hint}>
          Type a word of at least {MIN_QUERY_LENGTH} characters.
        </p>
      ) : null}
    </>
  );
}
