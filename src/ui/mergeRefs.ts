import type { Ref } from "react";

/**
 * Hands one node to several refs.
 *
 * Needed because two things legitimately own a task row's element: the list,
 * which focuses it (the roving tabindex of D4 step 2), and dnd-kit's
 * `setNodeRef`, which measures it. Widening `TaskRow.rowRef` into a pair would
 * make that coincidence part of the component's API; merging them in the list,
 * where both are already in scope, keeps it where it belongs.
 *
 * The null case is not incidental. React calls a ref with null on unmount, and
 * a ref that never hears it holds a detached node — for the list's `rows` map
 * that is a leak which grows with every task that leaves the view.
 */
export function mergeRefs<T>(...refs: (Ref<T> | undefined)[]): (value: T | null) => void {
  return (value) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") ref(value);
      else ref.current = value;
    }
  };
}
