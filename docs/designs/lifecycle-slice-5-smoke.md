# Lifecycle slice 5 — runtime smoke of the packaged shell

Run 2026-09-18 against `src-tauri/target/release/bundle/macos/open-todo.app` (built 07:16),
driven per `.claude/skills/desktop-qa/SKILL.md`. Logs: `/private/tmp/claude-501/-Users-avigano-orca-workspaces-open-todo-trevally/0e6f5c09-c4c9-4ca7-938e-593ba1cc0484/scratchpad/desktop-qa/`.
No source was changed; nothing was rebuilt.

## Results

| # | Sequence | Result | Observed | Log excerpt | Class |
|---|---|---|---|---|---|
| 1 | ⌘Q before `lifecycle: ready` | **FINDING** (reached on launches 1 and 2; ⌘Q at 1097 ms / 323 ms, `ready` never logged) | window shown, process gone at once, no dialog | `lifecycle: unexpected` only — no `exit prevented`, no `exit allowed` | wiring |
| 2 | Clean: ⌘W, then ⌘Q | **FINDING** (screen OK, log wrong) | ⌘W → `count of windows` = 0, process alive; ⌘Q ends it | `lifecycle: finalized` (no `finalizing`); then `lifecycle: unexpected` instead of `bypass armed` + `exit allowed` | wiring + runner |
| 3 | Clean: ⌘W, Dock click, ⌘Q | **FINDING** | window returns after Dock click (windows 0→1) ✓; ⌘Q ends process | Dock reopen logs **nothing**; ⌘Q → `lifecycle: stale`, `lifecycle: unexpected` | wiring |
| 4 | Dirty draft: ⌘H, then ⌘Q | **FINDING** | ⌘H hides (`visible` = false, windows 1, alive) ✓; ⌘Q kills the process with **no dialog — the draft is lost** | `lifecycle: ready` … `lifecycle: unexpected` | wiring |
| 5 | Dirty draft: ⌘W, Stay, ⌘W | **pass** (when answered inside the 5 s ask timeout) | web dialog `Close open-todo?` / `Stay` / `Discard and close` twice; process alive, window visible | `lifecycle: cancelled` twice, no `finalizing` | — |
| 5b | same, answered after ~20 s | **FINDING** (S5-2) | after 5 s the native dialog `open-todo needs a decision` ("The editor did not respond", default button `Close anyway`) appears over the web dialog; the late web click logs `stale`; further ⌘W log `dialog owns input` until the native dialog is answered (`Cancel` keeps the app) | `lifecycle: stale` → `lifecycle: dialog owns input` | machine + bridge: the ask timeout races the human because the bridge never acknowledges the request |
| 6 | ⌘R during a pending close ask | **skipped: no reload path** | ⌘R changed nothing: dialog still up, no reload | no `unready`/`ready` after ⌘R | — |
| 7 | Dock → Esci with a dirty draft | **FINDING (out of table)** | both osascript shapes worked; process ends immediately, **no dialog, draft lost** | `lifecycle: ready` … `lifecycle: unexpected`; **no `lifecycle exit prevented`** | out of table |

### The one finding behind rows 1–4 and 7

Every quit path tested — ⌘Q pre-ready, ⌘Q clean, ⌘Q windowless, ⌘Q on a dirty draft,
Dock → Esci — produces exactly one line, `lifecycle: unexpected`, and the process dies.
`lifecycle exit prevented` / `bypass armed` / `exit allowed` were **never** logged in any
run, although `src/lib.rs:99` maps `RunEvent::ExitRequested` to `on_exit_requested`.
Close (⌘W) reaches the machine correctly; exit does not. Slice 7 is therefore not only
about the Dock menu: on this build ⌘Q loses a dirty draft too.

`lifecycle: unexpected` is the `Idle × Exited` cell (`machine.rs`, `Event::Exited` in the
`Idle` arm): the machine receives `RunEvent::Exit` with the process already exiting. No
`ExitRequested` was ever delivered.

### Full logs

`/private/tmp/claude-501/-Users-avigano-orca-workspaces-open-todo-trevally/0e6f5c09-c4c9-4ca7-938e-593ba1cc0484/scratchpad/desktop-qa/seq1-launch1.log`, `seq1-launch2.log`, `seq1-launch3.log`, `seq2-launch1.log`,
`seq3-launch1.log`, `seq4-launch1.log`, `seq4-launch2.log`, `seq5-launch1.log`,
`seq5-launch2.log`, `seq5-launch3.log`, `seq6-launch1.log`, `seq7-launch1.log` (empty:
single-instance forwarding), `seq7-launch2.log`, `seq7-launch3.log`, plus `baseline.log`.

## Coordinator's reading (2026-09-18, after re-reading the logs and the code)

- **S5-1 (rows 1, 2, 3, 4, 7): no quit path reaches the machine.** open-todo has no menu
  of its own, so Tauri's default menu is used; its Quit item is the AppKit selector
  `terminate:` (muda 0.17.2, `platform_impl/macos/mod.rs:992`). ⌘Q, File → Quit, Dock →
  Esci, App Switcher and `osascript … to quit` all go through `applicationShouldTerminate:`,
  which tao does not implement, so the process ends and only `RunEvent::Exit` arrives.
  `RunEvent::ExitRequested` is raised only by `AppHandle::exit(n)` or by the last window's
  destruction; the spike measured the former (Q5) and never a keyboard ⌘Q. Fix as in
  margins-app #222: a custom Quit item on `CmdOrCtrl+Q` calling `app.exit(0)`, plus the
  `applicationShouldTerminate:` delegate answering `NSTerminateLater` and mapping to
  `Begin(Quit)`.
- **S5-2 (row 5b): the 5 s ask timeout races the person.** The bridge shows its dialog and
  waits for a click without acknowledging the request, so a person who reads for more than
  5 s gets the native "did not respond" dialog with `Close anyway` as the default button.
  Fix: an `Acknowledged{attempt, frontend}` event sent by the bridge when the dialog mounts;
  `Asking × Acknowledged` (owner match) disarms the timeout. The native dialog then covers
  only a bridge that never acknowledges.
- Row 5 as run by the person (2026-09-18 07:35 local, answered within 5 s) **passes**:
  `cancelled`, `stale` (the late timer of the cancelled attempt), `cancelled`, `stale`.
- Row 6: ⌘R is not forwarded by the shell; no reload path exists in the bundle. Not a
  finding; the "bridge reload" scenario stays covered by the Vitest suite only.
- Rows 2 and 4 were run by the person without a Dock raise after the hide and behaved as
  the agent reported; the recipe correction 5 below is folded into the skill.

Both findings go to slice 7 (`docs/designs/lifecycle-slice-7-plan.md`).

## Recipe corrections for the skill (all folded into SKILL.md on 2026-09-18)

1. **`open-todo desktop shell started` never appears.** It is behind `cfg!(debug_assertions)`
   (`src/lib.rs:77`), so a release bundle logs only the wry line and `lifecycle: ready`.
   A healthy launch starts `tauri_runtime_wry] web content process terminated` (benign),
   then `lifecycle ready token replied …`, then `lifecycle: ready`.
2. **The Server URL field path is wrong.** `text field 1 of group 1 of group 1 of window 1`
   fails with `-1719`. Working path:
   `text field "Server URL" of group 2 of group 1 of UI element 1 of scroll area 1 of group 1 of group 1 of window 1`.
3. **Do not answer the web dialog with `Return`.** On the setup screen Return submits the
   form (`Continue`) instead of pressing `Stay`. Click the button:
   `click button "Stay" of group "Close open-todo?" of UI element 1 of scroll area 1 of group 1 of group 1 of window 1`.
4. **Answer within 5 s or the row is unrunnable.** Beyond the ask timeout the answer logs
   `stale` and the app wedges into `dialog owns input`. Send ⌘W and the click in a single
   `osascript` invocation.
5. **A Dock raise before ⌘Q undoes ⌘W/⌘H.** Rows 2 and 4 cannot be run as written: the
   mandated raise fires `Reopen`/unhide. Rows 2/3 collapse into the same sequence.
6. **Quit the previous instance before every sequence.** A forwarded second launch leaves a
   0-byte log and the old window answers the probes (seen in `seq7-launch1.log`).
7. Verify frontmost with a retry loop: a single Dock click sometimes leaves the terminal
   frontmost (`frontmost=Orca`), and the stray keystrokes then land in the terminal.
8. `count of windows` is not a hide test for ⌘H: it stays 1. Use
   `visible of process "open-todo"`.
9. Italian Dock menu confirmed: `Opzioni`, `Mostra tutte le finestre`, `Nascondi`,
   `Nascondi altre`, `Esci`, `Uscita forzata`. Both osascript shapes worked, no `-1719`.

## Machine restored

No open-todo process is running (`pgrep -lf 'open-todo.app/Contents/MacOS'` empty). The last
instances ended through the sequences themselves (Dock → Esci, and ⌘Q); no `kill` was used.
`~/Library/Application Support/com.alvistar.open-todo` was left untouched apart from the
window-state the plugin writes on each close; no server was ever configured (the fixture text
`http://qa` was never submitted successfully and did not survive any relaunch).
