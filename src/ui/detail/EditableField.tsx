import { type ReactNode, useRef, useState } from "react";
import styles from "./EditableField.module.css";

/**
 * A value that becomes an editor when you click it, with Cancel and Save.
 *
 * The commit model is Todoist's, measured on 2026-09-15: the main column's
 * title and description open on click and are written only by pressing Save.
 * **Escape does not discard.** It does nothing here, deliberately - the
 * dialog's own Escape closes the dialog, and if Escape also discarded then one
 * key would carry two destructive meanings and the typed text would vanish
 * behind a closing pane. Cancel is the only way to throw work away.
 */

export interface EditableFieldProps {
  value: string;
  /** How the value reads when it is not being edited. */
  children: ReactNode;
  /** Names the display control, e.g. "Edit the task name". */
  label: string;
  editing: boolean;
  onEdit: () => void;
  /** Leave the editor: the caller clears its "which field" state. */
  onClose: () => void;
  onSave: (next: string) => Promise<void>;
  multiline?: boolean;
  /** Said before the user types, not after they lose something. */
  notice?: string;
}

export function EditableField({
  value,
  children,
  label,
  editing,
  onEdit,
  onClose,
  onSave,
  multiline = false,
  notice,
}: EditableFieldProps) {
  if (!editing) {
    return (
      <button
        type="button"
        className={styles.display}
        aria-label={label}
        onClick={onEdit}
      >
        {children}
      </button>
    );
  }

  /*
   * A separate component, mounted only while editing, so the draft is simply
   * its initial state. An effect that seeded it would have to ignore `value`
   * in its dependencies - the 20s poll re-renders this dialog, and re-seeding
   * would overwrite what is being typed. Mounting says the same thing without
   * asking anyone to trust a comment.
   */
  return (
    <Editor
      initial={value}
      label={label}
      multiline={multiline}
      onClose={onClose}
      onSave={onSave}
      {...(notice === undefined ? {} : { notice })}
    />
  );
}

interface EditorProps {
  initial: string;
  label: string;
  multiline: boolean;
  onClose: () => void;
  onSave: (next: string) => Promise<void>;
  notice?: string;
}

function Editor({ initial, label, multiline, onClose, onSave, notice }: EditorProps) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const focused = useRef(false);

  /** Focus once, on the node itself, without an effect that outlives it. */
  const takeFocus = (node: HTMLTextAreaElement | HTMLInputElement | null) => {
    if (!node || focused.current) return;
    focused.current = true;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (e) {
      /*
       * Stay open, keep the draft. The pending text is the only copy there is,
       * and closing on failure would throw away the work AND the message that
       * explains why it failed.
       */
      setError(e instanceof Error ? e.message : "Could not save the change.");
    } finally {
      setSaving(false);
    }
  };

  // Escape belongs to the dialog, and the dialog ignores it while the focus is
  // in a form control. Enter commits a single-line field; a multiline one takes
  // the newline.
  const onKeyDown = (event: { key: string; preventDefault: () => void }) => {
    if (event.key === "Enter" && !multiline) {
      event.preventDefault();
      void save();
    }
  };

  return (
    <div>
      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}
      {multiline ? (
        <textarea
          ref={takeFocus}
          className={styles.editor}
          aria-label={label}
          rows={4}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
      ) : (
        <input
          ref={takeFocus}
          className={styles.editor}
          aria-label={label}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.button} ${styles.cancel}`}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className={`${styles.button} ${styles.save}`}
          disabled={saving}
          onClick={() => void save()}
        >
          Save
        </button>
      </div>
      {error ? (
        <p className={styles.error} role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}
