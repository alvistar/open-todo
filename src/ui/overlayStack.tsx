import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";

export type OverlayLayer = "sidebar" | "dialog" | "alertdialog" | "picker";

// A handler may return false to decline Escape; ordinary handlers need no return.
// biome-ignore lint/suspicious/noConfusingVoidType: void represents a handled Escape callback
export type OverlayEscapeHandler = (event: KeyboardEvent) => boolean | void;

interface OverlayEntry {
  id: symbol;
  layer: OverlayLayer;
  order: number;
  onEscape: OverlayEscapeHandler;
}

interface OverlayStackValue {
  register: (layer: OverlayLayer, onEscape: OverlayEscapeHandler) => () => void;
}

const OverlayStackContext = createContext<OverlayStackValue | null>(null);

const LAYER_PRIORITY: Record<OverlayLayer, number> = {
  sidebar: 0,
  dialog: 1,
  picker: 2,
  alertdialog: 3,
};

export function OverlayStackProvider({ children }: { children: ReactNode }) {
  const entries = useRef<OverlayEntry[]>([]);
  const nextOrder = useRef(0);

  const register = useCallback((layer: OverlayLayer, onEscape: OverlayEscapeHandler) => {
    const entry: OverlayEntry = {
      id: Symbol(layer),
      layer,
      order: nextOrder.current++,
      onEscape,
    };
    entries.current.push(entry);
    return () => {
      entries.current = entries.current.filter((current) => current.id !== entry.id);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const top = entries.current.reduce<OverlayEntry | null>((current, entry) => {
        if (
          current === null ||
          LAYER_PRIORITY[entry.layer] > LAYER_PRIORITY[current.layer] ||
          (LAYER_PRIORITY[entry.layer] === LAYER_PRIORITY[current.layer] &&
            entry.order > current.order)
        ) {
          return entry;
        }
        return current;
      }, null);
      if (!top) return;
      if (top.onEscape(event) === false) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <OverlayStackContext.Provider value={{ register }}>
      {children}
    </OverlayStackContext.Provider>
  );
}

export function useOverlayStack(): OverlayStackValue | null {
  return useContext(OverlayStackContext);
}

/** Registers the active surface while keeping a changing callback out of the stack order. */
export function useOverlayLayer(
  layer: OverlayLayer,
  onEscape: OverlayEscapeHandler,
  active = true,
): void {
  const stack = useOverlayStack();
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!stack || !active) return;
    return stack.register(layer, (event) => onEscapeRef.current(event));
  }, [active, layer, stack]);
}
