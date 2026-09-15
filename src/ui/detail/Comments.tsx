import { useState } from "react";
import type { TaskComment } from "../../api/types";
import { UI_LOCALE } from "../../model/dates";
import { isRichHtml, stripHtml, toDescriptionHtml } from "../../model/taskRow";
import styles from "./Comments.module.css";

/**
 * A task's comments, and a box to add one.
 *
 * Comments carry HTML, like descriptions (mapping §2), and open-todo shows
 * them as plain text. Reading one that was written with formatting elsewhere
 * says so, for the same reason the description editor does: silently dropping
 * someone's links is worse than admitting we cannot show them.
 *
 * Writing goes through the same escape-and-wrap as a description, so nothing
 * invents markup the user did not type.
 */

export interface CommentsProps {
  comments: readonly TaskComment[];
  loading: boolean;
  onAdd: (html: string) => Promise<void>;
}

export function Comments({ comments, loading, onAdd }: CommentsProps) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    setSaving(true);
    setError(null);
    try {
      await onAdd(toDescriptionHtml(text));
      // Cleared only on success: a failed send must not eat what was typed.
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the comment.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.comments} aria-label="Comments">
      {loading ? <p className={styles.note}>Loading the comments…</p> : null}
      <ul className={styles.list}>
        {comments.map((comment) => (
          <li key={comment.id} className={styles.comment}>
            <div className={styles.meta}>
              <span className={styles.author}>
                {comment.author?.name || comment.author?.username || "Someone"}
              </span>
              <span className={styles.when}>{whenReads(comment.created)}</span>
            </div>
            <p className={styles.body}>{stripHtml(comment.comment)}</p>
            {isRichHtml(comment.comment) ? (
              <p className={styles.note}>
                This comment was written with formatting open-todo cannot show.
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <textarea
        className={styles.editor}
        aria-label="Add a comment"
        placeholder="Add a comment"
        rows={2}
        value={draft}
        disabled={saving}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.send}
          disabled={saving || !draft.trim()}
          onClick={() => void add()}
        >
          Comment
        </button>
      </div>
      {error ? (
        <p className={styles.error} role="status">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** Absolute, not "2 hours ago": a relative label goes stale as you read it. */
function whenReads(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString(UI_LOCALE, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
