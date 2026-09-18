---
name: desktop-qa
description: Drive the packaged open-todo.app on macOS through System Events (Accessibility API), so the native shell (close, quit, hide, Dock, recovery dialog) is observed rather than inferred from the Rust and Vitest suites.
---

# QA'ing the open-todo desktop shell at runtime

`cargo test` runs the lifecycle machine, its property suite, the trace comparison and the
Tauri runner against a mock runtime. `pnpm test` runs the React bridge in jsdom. **Not one
of them launches the app.** Everything between "the process starts" and "the user sees a
window" is untested by construction: whether ⌘Q reaches `RunEvent::ExitRequested`, whether a
hidden window is shown again for an ask, whether the Dock reopen recreates the window.

This skill drives the built bundle through System Events and reads the app's own log as the
witness. It descends from the `desktop-qa` skill of the Margins repository
(`/Users/avigano/Developer/ai-review/.claude/skills/desktop-qa/SKILL.md`), which recorded the
traps below over two real runs; the open-todo specifics were verified on 2026-09-18.

## Two layers, two drivers

```
open-todo.app
  ├── native shell    → System Events           (windows, menus, Dock, native dialog, ⌘ keys)
  └── WKWebView       → keystrokes to the focused field only; the DOM is not readable here
```

The webview is covered by Vitest (`src/lifecycle/*.test.tsx`). Here it is only a keyboard
target: a `keystroke` sent while the app is frontmost lands in the focused input, which is
how a dirty draft is made.

## Prerequisites, checked every run

**1. Accessibility.** One check, no install:

```bash
osascript -e 'tell application "System Events" to return (count of processes)'
```

A number is good. Error `-1743` means the terminal running this (Orca, iTerm, Terminal,
Claude Code) needs adding under System Settings → Privacy & Security → Accessibility.

**2. The screen is unlocked and window reads work.** The first check passes with the screen
locked while every window read returns `0` and every keystroke goes nowhere. Stop if either
of these is wrong:

```bash
osascript -e 'tell application "System Events" to return name of first process whose frontmost is true'
# `loginwindow` means the screen is LOCKED — stop
osascript -e 'tell application "System Events" to tell process "Finder" to return count of windows'
# 0 for Finder means window reads are blind, not that Finder has no windows
```

**3. A logger in the binary.** The shell installs `env_logger` in `run()`; it writes to
stderr **only when `RUST_LOG` is set**. An empty log with `RUST_LOG` unset proves nothing.

**4. No other instance.** `tauri-plugin-single-instance` forwards a second launch to the
first and the second process exits with an empty log:

```bash
pgrep -lf 'open-todo.app/Contents/MacOS' && echo "already running: quit it first"
```

## Names

| Thing | Value |
|---|---|
| Bundle | `src-tauri/target/release/bundle/macos/open-todo.app` |
| Executable and System Events process | `open-todo` |
| Dock tile | `open-todo` |
| Window title | `open-todo` |
| Native recovery dialog title | `open-todo needs a decision` |
| Native dialog buttons | `Exit anyway` / `Close anyway`, and `Cancel` |
| Web dialog buttons (bridge) | `Stay`, `Discard and quit` / `Discard and close`, `Exit anyway` |
| Log prefix | `lifecycle:` (every `Effect::Log`), `lifecycle exit allowed` / `prevented` / `bypass armed` |

The Dock's context menu is localized. On an Italian system: `Opzioni`, `Mostra tutte le
finestre`, `Nascondi`, `Esci`. Read the names before clicking, every time.

## Launch, with the log as witness

Build first if the bundle is missing or older than `src-tauri/src`:

```bash
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" pnpm desktop:build
```

Run the executable directly, never via `open`, so stderr is yours:

```bash
APP="$(git rev-parse --show-toplevel)/src-tauri/target/release/bundle/macos/open-todo.app"
LOG="$TMPDIR/open-todo-qa.log"
RUST_LOG=debug "$APP/Contents/MacOS/open-todo" 2>|"$LOG" &
```

`debug` is needed: every `lifecycle:` line is `log::debug!`. Then wait for the window with
a loop that treats an empty value as "not yet" (an `until [ "$(...)" != 0 ]` loop exits at
once while `osascript` still fails):

```bash
i=0; W=""
while [ $i -lt 30 ]; do
  W=$(osascript -e 'tell application "System Events" to tell process "open-todo" to return count of windows' 2>/dev/null)
  case "$W" in ''|0) ;; *) break;; esac
  osascript -e 'delay 0.5' >/dev/null; i=$((i+1))
done
echo "polls=$i windows=$W"
```

Foreground `sleep` is blocked in the Claude Code harness; `osascript -e 'delay N'` is the
pause.

A healthy launch logs a benign `tauri_runtime_wry] web content process terminated`, then
`lifecycle ready token replied …` and `lifecycle: ready`. (`open-todo desktop shell started`
is `debug_assertions`-only and never appears in a release bundle.) Without `lifecycle: ready`
the frontend never called `lifecycle_ready`, and every ask will time out into the native
dialog. Quit the previous instance before every launch: single-instance forwards a second
launch to the first, which leaves a 0-byte log while the old window answers the probes.

## Raise the app before any keystroke or menu click

**A keystroke or menu click only takes effect when the app is frontmost, and reports
success either way.** After ⌘H, `count of windows` stays 1: test hiding with
`visible of process "open-todo"`. `set frontmost to true` returns without error and often leaves the
terminal frontmost, so ⌘Q goes to the terminal. Clicking the Dock tile raises the app every
time. So: raise, read the value back, then act.

```bash
osascript -e 'tell application "System Events" to tell process "Dock" to click UI element "open-todo" of list 1'
osascript -e 'delay 1' >/dev/null
osascript -e 'tell application "System Events" to return name of first process whose frontmost is true'
# must print open-todo
```

Read frontmost back in a retry loop: a single Dock click sometimes leaves the terminal
frontmost and the keystrokes land there.

A Dock click on a windowless or hidden app also fires `RunEvent::Reopen`, which shows or
recreates the window. So **raise only while the window is visible**: in a sequence that
hides the window first (⌘W, ⌘H), raise the app before the hide and send the following ⌘
keys without another raise. The app stays the active application after a hide, and the
native Quit menu item fires from the menu bar even when tao logs
`skip sending CMD keyEvent - app has no keyWindow`.

Keystrokes, once frontmost:

```bash
osascript -e 'tell application "System Events" to keystroke "q" using command down'   # ⌘Q
osascript -e 'tell application "System Events" to keystroke "w" using command down'   # ⌘W (close)
osascript -e 'tell application "System Events" to keystroke "h" using command down'   # ⌘H (hide)
```

## Making a draft dirty

The bridge reports `dirty` when any registered draft source has text. On the setup screen
(no server configured) the `Server URL` field is a source: any text makes the app dirty.
Click into it, then type:

```bash
osascript -e 'tell application "System Events" to tell process "open-todo" to click text field "Server URL" of group 2 of group 1 of UI element 1 of scroll area 1 of group 1 of group 1 of window 1'
osascript -e 'tell application "System Events" to keystroke "http://qa"'
```

The path was read from the tree on 2026-09-18; if it fails with `-1719`, dump
`entire contents of window 1` and find the field by name again. Never press Return in that
field: it submits the setup form. Verify dirtiness by what happens next, not by reading the
DOM: a close request on a dirty app produces the web dialog (`Close open-todo?` with `Stay`
/ `Discard and close`) instead of finalizing.

Logged in, the `Task name` composer field is the equivalent source.

## Reading the web dialog and answering it

The bridge's dialog is HTML but WebKit exposes its buttons to System Events. Do not use
`Return` (on the setup screen it submits the form); click the button, in the **same**
`osascript` invocation as the ⌘ key that opened it, because the ask times out after 5 s:

```bash
osascript <<'SCPT'
tell application "System Events"
  keystroke "w" using command down
  delay 1.5
  tell process "open-todo" to click button "Stay" of group "Close open-todo?" of UI element 1 of scroll area 1 of group 1 of group 1 of window 1
end tell
SCPT
```

Confirm by the log: `Stay` yields `lifecycle: cancelled`; discard yields `lifecycle:
finalized` (close) or `lifecycle exit bypass armed` then `lifecycle exit allowed` (quit).

The **native** dialog (`open-todo needs a decision`, "The editor did not respond") appears
when the bridge has not answered within 5 s. As of 2026-09-18 that includes a human still
reading the web dialog: the bridge sends no acknowledgement, so the timer races the person
(finding S5-2, slice 7). It is a System Events window of process `open-todo`; its buttons
are readable with `name of every button of window 1`, and `Cancel` is the safe answer. A
web-dialog click after it appeared logs `stale`. ⌘Q cannot reach the machine while it is
modal (spike Q1); answer it.

## Diagnostics when nothing moves

```bash
sample $(pgrep -f 'open-todo.app/Contents/MacOS') 3 -f "$TMPDIR/sample.txt" >/dev/null
awk '/com.apple.main-thread/{f=1} f&&/^ *[0-9]+ Thread_/&&!/main-thread/{exit} f' "$TMPDIR/sample.txt"
```

A main thread ending in `NSApplication run` → `mach_msg2_trap` is idle and healthy. A main
thread inside `exit_requested` waiting on a channel while the lifecycle thread waits on a
window getter is the deadlock class the slice-4 review found; record the stack.

Cross-check a suspicious window count against CoreGraphics:

```bash
uvx --with pyobjc-framework-Quartz python3 -c "
import Quartz, subprocess
pid = int(subprocess.run(['pgrep','-f','open-todo.app/Contents/MacOS'],capture_output=True,text=True).stdout.split()[0])
wl = Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionAll, Quartz.kCGNullWindowID)
w = [x for x in wl if x.get('kCGWindowOwnerPID')==pid and x.get('kCGWindowLayer')==0 and x.get('kCGWindowIsOnscreen')]
print(len(w), [x.get('kCGWindowName') for x in w])"
```

## The checklist (slice 5 of the lifecycle redesign)

Each row names the action, what System Events must show and the log lines that prove the
machine took the intended path. Read the log after every step: `tail -n 20 "$LOG"`. A
different value is a finding, not a mistake in the recipe. Relaunch between sequences.

| # | Sequence | Expect on screen | Expect in the log |
|---|---|---|---|
| 1 | ⌘Q before the bridge is ready: send ⌘Q within ~300 ms of launch, before `lifecycle: ready` | window shows, then process gone | `lifecycle exit prevented`, an `EmitRequest` path or `lifecycle: no window`/`finalizing` per the table, ending in `lifecycle exit allowed`; if the bridge is still absent after 5 s the native dialog appears instead |
| 2 | Clean app: ⌘W, then ⌘Q inside the hide | ⌘W hides the window (`count of windows` = 0, process alive); ⌘Q ends the process | `lifecycle: finalizing`, `lifecycle: finalized`, then `lifecycle exit bypass armed`, `lifecycle exit allowed` |
| 3 | Clean app: ⌘W, Dock click, then ⌘Q | window returns after the Dock click; ⌘Q ends the process | after the click: `lifecycle: ready` again is **not** required (same webview); `lifecycle exit prevented` → ask → `lifecycle exit allowed` |
| 4 | Dirty draft: ⌘H, then ⌘Q | ⌘H hides the app; ⌘Q brings the window back **visible** with the web dialog | `lifecycle exit prevented`, `ShowWindow` runs (the window is visible again), dialog `Stay` → `lifecycle: cancelled`, process alive |
| 5 | Dirty draft: ⌘W, `Stay`, then ⌘W again | web dialog twice; process alive, window visible | `lifecycle: cancelled` twice, no `finalizing` |
| 6 | Bridge reload during a request: ⌘W on a dirty draft, then reload the webview (⌘R if the shell forwards it; else skip and record) | dialog gone; the app is not stuck: a later ⌘W asks again | `lifecycle: unready` then `lifecycle: ready`, the attempt ends in `cancelled`/`stale`, the next ⌘W produces a fresh ask |
| 7 | **Dock → Esci** with a dirty draft (AppKit's `applicationShouldTerminate:` path) | RECORD what happens: if the process ends without a dialog, the draft is lost | with `RUST_LOG=debug`, the presence or absence of `lifecycle exit prevented` is the whole finding |

Sequence 7 is outside the machine's current table: Margins found that Dock → Quit, App
Switcher Quit and `osascript … to quit` never raise `RunEvent::ExitRequested`
(`margins-app/src-tauri/src/quit/mod.rs`). Its result decides whether a slice 7 exists.

Driving the Dock menu, both shapes, because which one works is not stable across runs:

```bash
osascript -e 'tell application "System Events" to tell process "Dock" to perform action "AXShowMenu" of UI element "open-todo" of list 1'
osascript -e 'delay 1' >/dev/null
osascript -e 'tell application "System Events" to tell process "Dock" to return name of every menu item of menu 1 of UI element "open-todo" of list 1'
osascript -e 'tell application "System Events" to tell process "Dock" to click menu item "Esci" of menu 1 of UI element "open-todo" of list 1'
```

```bash
osascript <<'SCPT'
tell application "System Events" to tell process "Dock"
  perform action "AXShowMenu" of UI element "open-todo" of list 1
  delay 1.5
  click menu item "Esci" of menu 1 of UI element "open-todo" of list 1
end tell
SCPT
```

A `-1719` (invalid index) is the harmless failure: the menu closed between calls, try the
other shape. A silent success with the process alive and no new log line is the one that
produces a false report.

## Report

One row per sequence: `#`, `result` (pass / FINDING / skipped), the exact log excerpt, and
for a finding the state the machine was in (from the last `lifecycle:` line) and the
expected cell of `docs/designs/lifecycle-state-machine.md` §3. Attach the full log path.
Classify each finding: **machine** (a table cell is wrong), **runner** (the effect did not
do what the row says), **wiring** (`lib.rs` mapped the event wrong), or **out of table**
(sequence 7).

## Restore the machine

Quit the app if it is still running (a ⌘Q, or `kill` the pid as a last resort, and say
which), delete the fixture text, and leave `~/Library/Application Support/com.alvistar.open-todo`
as you found it: the window-state plugin writes geometry there on every close.

## What needs a human

| Flow | Why |
|---|---|
| Granting Accessibility to a new terminal | System Settings, cannot be scripted |
| Anything against a configured Vikunja server | live writes need explicit authorization (CLAUDE.md) |
| First launch of a signed build | Gatekeeper prompt |
