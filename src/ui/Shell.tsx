import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Icon } from "./icons/Icon";
import { OverlayStackProvider, useOverlayLayer, useOverlayStack } from "./overlayStack";
import styles from "./Shell.module.css";

export const SIDEBAR_BREAKPOINT = 1050;

export interface ShellProps {
  sidebar: ReactNode;
  children: ReactNode;
}

const CloseSidebarContext = createContext<() => void>(() => undefined);

export function useCloseSidebar(): () => void {
  return useContext(CloseSidebarContext);
}

export function Shell(props: ShellProps) {
  const stack = useOverlayStack();
  if (stack) return <ShellContents {...props} />;
  return (
    <OverlayStackProvider>
      <ShellContents {...props} />
    </OverlayStackProvider>
  );
}

function ShellContents({ sidebar, children }: ShellProps) {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= SIDEBAR_BREAKPOINT : false,
  );
  const [sidebarOpen, setSidebarOpen] = useState(() => !narrow);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia(`(max-width: ${SIDEBAR_BREAKPOINT}px)`);
    const sync = () => {
      setNarrow(media.matches);
      setSidebarOpen(!media.matches);
    };
    sync();
    media.addEventListener?.("change", sync);
    return () => media.removeEventListener?.("change", sync);
  }, []);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
    if (narrow) toggleRef.current?.focus();
  }, [narrow]);

  useOverlayLayer("sidebar", closeSidebar, sidebarOpen && narrow);
  const sidebarClosed = narrow && !sidebarOpen;

  return (
    <CloseSidebarContext.Provider value={closeSidebar}>
      <div className={styles.root}>
        <div
          className={`${styles.sidebarLayer} ${sidebarOpen ? styles.sidebarOpen : ""}`}
          data-open={sidebarOpen}
          {...(sidebarClosed ? { inert: true, "aria-hidden": true } : {})}
        >
          {sidebar}
        </div>
        {sidebarOpen && narrow ? (
          <button
            type="button"
            className={styles.backdrop}
            aria-label="Close navigation"
            tabIndex={-1}
            onClick={closeSidebar}
          />
        ) : null}
        <main className={styles.main}>
          <button
            ref={toggleRef}
            type="button"
            className={styles.mobileToggle}
            aria-label="Toggle navigation"
            aria-controls="open-todo-sidebar"
            aria-expanded={sidebarOpen}
            onClick={() => {
              if (sidebarOpen) closeSidebar();
              else setSidebarOpen(true);
            }}
          >
            <Icon name="sidebar" size={24} />
          </button>
          {children}
        </main>
      </div>
    </CloseSidebarContext.Provider>
  );
}
