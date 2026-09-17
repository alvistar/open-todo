# Tauri desktop shell verification

Verification run: 2026-09-17, worktree alvistar/trevally (branch alvistar/trevally).

This was a verification-only run after fix round 2. The required checks were run in order. The only requested report file replaced was docs/designs/tauri-desktop-shell-verification.md; generated build output was confined to dist/, src-tauri/target/, and src-tauri/gen/. VERSION was temporarily written as 9.9.9 for the negative drift check and restored with the exact command printf '0.0.1\n' >| VERSION. No source, test, knowledge, or tauri-desktop-shell-review*.md files were edited, and no server login or live Vikunja write was performed.

## Summary

| Check | Result |
| --- | --- |
| pnpm check | PASS |
| pnpm test (full suite) | PASS — 39 passed and 2 skipped test files; 680 passed and 19 skipped tests |
| pnpm version:check | PASS |
| pnpm design:check | PASS |
| Rust 1.88 fmt | PASS |
| Rust 1.88 clippy | PASS |
| Rust 1.88 cargo test | PASS — 15 passed, 0 failed; test names recorded below |
| Version drift negative test and VERSION restoration | PASS — expected failure observed naming tauri.conf.json, Cargo.toml, and Cargo.lock; VERSION diff empty after restore |
| pnpm desktop:build | FAIL — frontend, Rust release binary, and .app were built; DMG bundling failed in bundle_dmg.sh |
| Bundle plist | PASS — com.alvistar.open-todo, version 0.0.1 |
| Packaged smoke (single launch/quit) | PASS |
| Packaged smoke (second launch) | PASS — exactly one open-todo process |
| Packaged smoke (hidden-window close then quit) | PASS — close hid the window while process stayed alive; final process count 0 |
| Trevally Vite process filter | PASS — no matching argv |
| Knowledge gate | FAIL — 24 stale links; exact output is recorded below; no re-stamp performed |
| git diff --check | PASS |
| git status --short | PASS — exit status 0; the pre-existing dirty worktree is listed below |

## 1. JavaScript checks

### pnpm check — PASS

Command: pnpm check

```text
> open-todo@0.0.1 check /Users/avigano/orca/workspaces/open-todo/trevally
> biome check . && tsc -b && node scripts/sync-design-tokens.mjs --check

Checked 152 files in 31ms. No fixes applied.
design tokens ok: DESIGN.md matches src/theme/tokens.css
EXIT_STATUS=0
```

### pnpm test — PASS

Command: pnpm test

```text
> open-todo@0.0.1 test /Users/avigano/orca/workspaces/open-todo/trevally
> vitest run


 RUN  v5.0.0 /Users/avigano/orca/workspaces/open-todo/trevally


 Test Files  39 passed | 2 skipped (41)
      Tests  680 passed | 19 skipped (699)
   Start at  13:38:21
   Duration  2.59s (environment 60%, setup 14%, tests 13%, transform 9%, import 2%, worker 1%)

Environment  jsdom was created 41 times · 20.68s total, 60% of tracked time
             create it once per worker with pool: 'vmThreads' (keeps per-file isolation) or isolate: false (shares it across files)
             learn more: https://vitest.dev/guide/improving-performance#improving-performance

EXIT_STATUS=0
```

### pnpm version:check — PASS

```text
> open-todo@0.0.1 version:check /Users/avigano/orca/workspaces/open-todo/trevally
> node scripts/sync-version.mjs --check

version ok: 0.0.1
EXIT_STATUS=0
```

### pnpm design:check — PASS

```text
> open-todo@0.0.1 design:check /Users/avigano/orca/workspaces/open-todo/trevally
> node scripts/sync-design-tokens.mjs --check

design tokens ok: DESIGN.md matches src/theme/tokens.css
EXIT_STATUS=0
```

## 2. Rust checks with the 1.88 toolchain

Before each Rust command, PATH was exported exactly as:

```sh
export PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH"
```

### cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check — PASS

Output was empty; exit status was 0.

```text
EXIT_STATUS=0
```

### cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets 2>&1 | tail -40 — PASS

The requested tail output was:

```text
    Checking open-todo v0.0.1 (/Users/avigano/orca/workspaces/open-todo/trevally/src-tauri)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.18s
EXIT_STATUS=0
```

### cargo test --manifest-path src-tauri/Cargo.toml — PASS

```text
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.17s
     Running unittests src/lib.rs (src-tauri/target/debug/deps/open_todo_lib-233524a072a5fca3)

running 15 tests
test lifecycle::tests::asks_ready_frontend_once ... ok
test lifecycle::tests::bypasses_are_one_use_and_generation_bound ... ok
test lifecycle::tests::clean_allow_authorizes_once ... ok
test lifecycle::tests::dirty_allow_requires_a_current_recheck ... ok
test lifecycle::tests::close_then_quit_supersedes_the_close_attempt ... ok
test lifecycle::tests::finalization_rechecks_an_attempt_after_a_newer_request_starts ... ok
test lifecycle::tests::new_window_invalidates_old_frontend_and_attempt ... ok
test lifecycle::tests::pending_work_cannot_be_discarded_as_clean ... ok
test lifecycle::tests::finalization_reservation_blocks_newer_actions_until_finished ... ok
test lifecycle::tests::quit_without_a_visible_window_can_exit_directly ... ok
test lifecycle::tests::recovery_decision_from_superseded_attempt_is_stale ... ok
test lifecycle::tests::recovery_dialog_is_one_per_active_attempt ... ok
test lifecycle::tests::recreation_is_serialized_and_generation_advances_after_success ... ok
test lifecycle::tests::stale_generation_and_attempt_are_ignored ... ok
test lifecycle::tests::timeout_from_superseded_attempt_is_stale ... ok

test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running unittests src/main.rs (src-tauri/target/debug/deps/open_todo-3962daab5e25834d)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

   Doc-tests open_todo_lib

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

EXIT_STATUS=0
```

## 3. Version drift guard

The negative test wrote 9.9.9 to VERSION, ran pnpm version:check, and restored VERSION with printf '0.0.1\n' >| VERSION. The expected failure named package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, and src-tauri/Cargo.lock; the required tauri.conf.json, Cargo.toml, and Cargo.lock names are present.

Exact negative-test output:

```text
> open-todo@0.0.1 version:check /Users/avigano/orca/workspaces/open-todo/trevally
> node scripts/sync-version.mjs --check

version drift: VERSION is 9.9.9, but package.json version is 0.0.1; src-tauri/tauri.conf.json version is 0.0.1; src-tauri/Cargo.toml is 0.0.1; src-tauri/Cargo.lock is 0.0.1.
Run "pnpm version:sync" (edit VERSION, never generated metadata).
 ELIFECYCLE  Command failed with exit code 1.
EXIT_STATUS=1
```

The restore check ran git diff -- VERSION and produced no diff output:

```text
RESTORE_DIFF_EXIT_STATUS=0
```

VERSION is therefore restored to 0.0.1 with an empty git diff.

## 4. Bundle

Command: pnpm desktop:build, with the same Rust 1.88 PATH export shown above.

### pnpm desktop:build — FAIL

The frontend build and Rust release build completed, and open-todo.app was bundled. The command then failed while creating the DMG; this is the exact failure output:

```text
> open-todo@0.0.1 desktop:build /Users/avigano/orca/workspaces/open-todo/trevally
> tauri build

        Info Looking up installed tauri packages to check mismatched versions...
     Running beforeBuildCommand `pnpm build`

> open-todo@0.0.1 build /Users/avigano/orca/workspaces/open-todo/trevally
> node scripts/sync-version.mjs --check && tsc -b && vite build

version ok: 0.0.1
vite v8.2.2 building client environment for production...
transforming...
✓ 223 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.44 kB │ gzip:   0.28 kB
dist/assets/index-wz4TLyZh.css   30.73 kB │ gzip:   5.97 kB
dist/assets/index-BOb3stTJ.js   384.18 kB │ gzip: 118.82 kB

✓ built in 112ms
   Compiling open-todo v0.0.1 (/Users/avigano/orca/workspaces/open-todo/trevally/src-tauri)
    Finished `release` profile [optimized] target(s) in 11.66s
       Built application at: /Users/avigano/orca/workspaces/open-todo/trevally/src-tauri/target/release/open-todo
    Bundling open-todo.app (/Users/avigano/orca/workspaces/open-todo/trevally/src-tauri/target/release/bundle/macos/open-todo.app)
    Bundling open-todo_0.0.1_aarch64.dmg (/Users/avigano/orca/workspaces/open-todo/trevally/src-tauri/target/release/bundle/dmg/open-todo_0.0.1_aarch64.dmg)
     Running bundle_dmg.sh
failed to bundle project: error running bundle_dmg.sh: `failed to run /Users/avigano/orca/workspaces/open-todo/trevally/src-tauri/target/release/bundle/dmg/bundle_dmg.sh`
       Error failed to bundle project: error running bundle_dmg.sh: `failed to run /Users/avigano/orca/workspaces/open-todo/trevally/src-tauri/target/release/bundle/dmg/bundle_dmg.sh`
 ELIFECYCLE  Command failed with exit code 1.
EXIT_STATUS=1
```

Observed output paths:

```text
/Users/avigano/orca/workspaces/open-todo/trevally/dist/index.html
/Users/avigano/orca/workspaces/open-todo/trevally/dist/assets/index-BOb3stTJ.js
/Users/avigano/orca/workspaces/open-todo/trevally/dist/assets/index-wz4TLyZh.css
/Users/avigano/orca/workspaces/open-todo/trevally/src-tauri/target/release/open-todo
/Users/avigano/orca/workspaces/open-todo/trevally/src-tauri/target/release/bundle/macos/open-todo.app
/Users/avigano/orca/workspaces/open-todo/trevally/src-tauri/target/release/bundle/macos/rw.54239.open-todo_0.0.1_aarch64.dmg
/Users/avigano/orca/workspaces/open-todo/trevally/src-tauri/target/release/bundle/dmg/bundle_dmg.sh
```

### plutil — PASS

Command:
plutil -p /Users/avigano/orca/workspaces/open-todo/trevally/src-tauri/target/release/bundle/macos/open-todo.app/Contents/Info.plist | grep -E 'CFBundleIdentifier|CFBundleShortVersionString'

```text
  "CFBundleIdentifier" => "com.alvistar.open-todo"
  "CFBundleShortVersionString" => "0.0.1"
EXIT_STATUS=0
```

## 5. Packaged smoke with no trevally Vite

The process filter searched argv for /open-todo/trevally/ and a Vite development-server process; it found none before the smoke checks.

```text
FILTER=argv containing /open-todo/trevally/ and development server process
(none)
```

### (a) Single launch and quit — PASS

```text
SMOKE_A=single launch, wait 5s, pgrep, AppleScript quit, wait <=10s
open_rc=0
pgrep_rc=0 pids=59823
quit_rc=0
exit_within_10s=0 elapsed_half_seconds=0
RESULT_EXIT_STATUS=0
```

### (b) Second launch — PASS

```text
SMOKE_B=launch, wait 4s, launch again, wait 3s, exactly one process, quit, wait <=10s
preexisting_pids=<none>
open1_rc=0
after_first_launch_count=1 pids=60597
open2_rc=0
after_second_launch_count=1 pids=60597
quit_rc=0
exit_within_10s=0 elapsed_half_seconds=0
RESULT_EXIT_STATUS=0
```

### (c) Hidden-window close then quit — PASS

The requested close-button AppleScript succeeded, so no fallback keystroke was needed. After clicking the close button and waiting 2 seconds, the process was still alive; after telling open-todo to quit, it exited within 10 seconds and final pgrep count was 0, with no dialog remaining.

```text
SMOKE_C=launch, close window, verify hidden process, app quit, wait <=10s
preexisting_pids=<none>
open_rc=0
before_close_count=1 pids=61564
button 1 of window open-todo of application process open-todo
close_button_rc=0
after_close_sleep_2s_count=1 pids=61564
quit_rc=0
exit_within_10s=0 elapsed_half_seconds=0 final_count=0 final_pids=
RESULT_EXIT_STATUS=0
```

## 6. Knowledge gate

Command:

```sh
sh /Users/avigano/.claude/plugins/cache/alvistar-skills/okf-drift/0.7.0/scripts/okf-shim.sh --repo-root /Users/avigano/orca/workspaces/open-todo/trevally okf-check.sh knowledge
```

Result: FAIL, exit status 1. There were exactly 24 stale links. No re-stamp was performed. The following is the exact output and stale-link list:

```text
FAIL  knowledge/architecture/architecture.md: drifted from src/app/App.tsx (changed_after_baseline)
        blame: cd55ec8e 2026-09-09 Show real projects, Inbox and Today from Vikunja (Alessandro Viganò)
        review the concept against the code, then: drift link knowledge/architecture/architecture.md src/app/App.tsx --doc-is-still-accurate  + a dated line in knowledge/log.md
FAIL  knowledge/decisions/direct-browser-api.md: drifted from src/api/http.ts (changed_after_baseline)
        blame: 805f3620 2026-09-09 Fix the defects found in the API and live-layer review (Alessandro Viganò)
        review the concept against the code, then: drift link knowledge/decisions/direct-browser-api.md src/api/http.ts --doc-is-still-accurate  + a dated line in knowledge/log.md
FAIL  knowledge/decisions/direct-browser-api.md: drifted from src/auth/authStore.ts (changed_after_baseline)
        blame: 6600eb54 2026-09-09 Add the server, login and logout flow (Alessandro Viganò)
        review the concept against the code, then: drift link knowledge/decisions/direct-browser-api.md src/auth/authStore.ts --doc-is-still-accurate  + a dated line in knowledge/log.md
FAIL  knowledge/decisions/direct-browser-api.md: drifted from vite.config.ts (changed_after_baseline)
        blame: d3cbce38 2026-09-09 Scaffold the React + Vite SPA (Alessandro Viganò)
        review the concept against the code, then: drift link knowledge/decisions/direct-browser-api.md vite.config.ts --doc-is-still-accurate  + a dated line in knowledge/log.md
FAIL  knowledge/decisions/distinct-brand.md: drifted from src/ui/icons/paths.ts (changed_after_baseline)
        blame: c8407d36 2026-09-15 Widen the write surface for a detail pane that can change a task (Alessandro Viganò)
        review the concept against the code, then: drift link knowledge/decisions/distinct-brand.md src/ui/icons/paths.ts --doc-is-still-accurate  + a dated line in knowledge/log.md
FAIL  knowledge/decisions/offer-repeat-adverbs.md: drifted from src/ui/QuickAdd.tsx (changed_after_baseline)
        blame: 430baf4d 2026-09-15 Clear the last two lint findings, neither by doing what the fix said (Alessandro Viganò)
        review the concept against the code, then: drift link knowledge/decisions/offer-repeat-adverbs.md src/ui/QuickAdd.tsx --doc-is-still-accurate  + a dated line in knowledge/log.md
FAIL  knowledge/decisions/safe-task-writes.md: drifted from src/queries/useCompleteTask.ts (changed_after_baseline)
        blame: 8fcba0ec 2026-09-15 Unlatch the unmount guard, which had switched the undo window off in dev (Alessandro Viganò)
        review the concept against the code, then: drift link knowledge/decisions/safe-task-writes.md src/queries/useCompleteTask.ts --doc-is-still-accurate  + a dated line in knowledge/log.md
FAIL  knowledge/playbooks/add-task-mutation.md: drifted from src/ui/detail/TaskDetail.test.tsx (changed_after_baseline)
        blame: c75c277f 2026-09-15 Put a sub-task under its parent, and only there (Alessandro Viganò)
        review the concept against the code, then: drift link knowledge/playbooks/add-task-mutation.md src/ui/detail/TaskDetail.test.tsx --doc-is-still-accurate  + a dated line in knowledge/log.md
FAIL  knowledge/playbooks/debug-vikunja-connection.md: drifted from src/api/http.test.ts (changed_after_baseline)
        blame: 805f3620 2026-09-09 Fix the defects found in the API and live-layer review (Alessandro Viganò)
        review the concept against the code, then: drift link knowledge/playbooks/debug-vikunja-connection.md src/api/http.test.ts --doc-is-still-accurate  + a dated line in knowledge/log.md
FAIL  knowledge/playbooks/debug-vikunja-connection.md: drifted from src/api/http.ts (changed_after_baseline)
        blame: 805f3620 2026-09-09 Fix the defects found in the API and live-layer review (Alessandro Viganò)
        review the concept against the code, then: drift link knowledge/playbooks/debug-vikunja-connection.md src/api/http.ts --doc-is-still-accurate  + a dated line in knowledge/log.md
FAIL  knowledge/playbooks/debug-vikunja-connection.md: drifted from src/screens/SetupScreen.tsx (changed_after_baseline)
        blame: 2fd899e4 2026-09-10 fix(qa): ISSUE-002 — do not submit an empty login form (Alessandro Viganò)
        review the concept against the code, then: drift link knowledge/playbooks/debug-vikunja-connection.md src/screens/SetupScreen.tsx --doc-is-still-accurate  + a dated line in knowledge/log.md
FAIL  knowledge/project/setup.md: drifted from scripts/sync-version.mjs (changed_after_baseline)
        blame: d3cbce38 2026-09-09 Scaffold the React + Vite SPA (Alessandro Viganò)
        review the concept against the code, then: drift link knowledge/project/setup.md scripts/sync-version.mjs --doc-is-still-accurate  + a dated line in knowledge/log.md
FAIL  knowledge/project/setup.md: drifted from src/auth/authStore.ts (changed_after_baseline)
        blame: 6600eb54 2026-09-09 Add the server, login and logout flow (Alessandro Viganò)
        review the concept against the code, then: drift link knowledge/project/setup.md src/auth/authStore.ts --doc-is-still-accurate  + a dated line in knowledge/log.md
FAIL  knowledge/project/setup.md: drifted from src/screens/SetupScreen.tsx (changed_after_baseline)
        blame: 2fd899e4 2026-09-10 fix(qa): ISSUE-002 — do not submit an empty login form (Alessandro Viganò)
        review the concept against the code, then: drift link knowledge/project/setup.md src/screens/SetupScreen.tsx --doc-is-still-accurate  + a dated line in knowledge/log.md
FAIL  knowledge/project/setup.md: drifted from src/settings/settingsStore.ts (changed_after_baseline)
        blame: 6600eb54 2026-09-09 Add the server, login and logout flow (Alessandro Viganò)
        review the concept against the code, then: drift link knowledge/project/setup.md src/settings/settingsStore.ts --doc-is-still-accurate  + a dated line in knowledge/log.md
FAIL  knowledge/project/stack.md: drifted from package.json (changed_after_baseline)
        blame: a020a87c 2026-09-10 Close the gaps the review found (Alessandro Viganò)
        review the concept against the code, then: drift link knowledge/project/stack.md package.json --doc-is-still-accurate  + a dated line in knowledge/log.md
FAIL  knowledge/project/stack.md: drifted from pnpm-lock.yaml (changed_after_baseline)
        blame: 991e509c 2026-09-10 Pin chrono-node exactly (Alessandro Viganò)
        review the concept against the code, then: drift link knowledge/project/stack.md pnpm-lock.yaml --doc-is-still-accurate  + a dated line in knowledge/log.md
FAIL  knowledge/project/stack.md: drifted from vite.config.ts (changed_after_baseline)
        blame: d3cbce38 2026-09-09 Scaffold the React + Vite SPA (Alessandro Viganò)
        review the concept against the code, then: drift link knowledge/project/stack.md vite.config.ts --doc-is-still-accurate  + a dated line in knowledge/log.md
FAIL  knowledge/project/state.md: drifted from src-tauri/src/lib.rs (changed_after_baseline)
        blame: - - (uncommitted change — nothing to blame yet) (-)
        review the concept against the code, then: drift link knowledge/project/state.md src-tauri/src/lib.rs --doc-is-still-accurate  + a dated line in knowledge/log.md
FAIL  knowledge/project/state.md: drifted from src-tauri/src/lifecycle.rs (changed_after_baseline)
        blame: - - (uncommitted change — nothing to blame yet) (-)
        review the concept against the code, then: drift link knowledge/project/state.md src-tauri/src/lifecycle.rs --doc-is-still-accurate  + a dated line in knowledge/log.md
FAIL  knowledge/project/state.md: drifted from src/app/App.tsx (changed_after_baseline)
        blame: cd55ec8e 2026-09-09 Show real projects, Inbox and Today from Vikunja (Alessandro Viganò)
        review the concept against the code, then: drift link knowledge/project/state.md src/app/App.tsx --doc-is-still-accurate  + a dated line in knowledge/log.md
FAIL  knowledge/project/state.md: drifted from src/lifecycle/useDesktopLifecycle.tsx (changed_after_baseline)
        blame: - - (uncommitted change — nothing to blame yet) (-)
        review the concept against the code, then: drift link knowledge/project/state.md src/lifecycle/useDesktopLifecycle.tsx --doc-is-still-accurate  + a dated line in knowledge/log.md
FAIL  knowledge/project/state.md: drifted from src/ui/Shell.tsx (changed_after_baseline)
        blame: b17af321 2026-09-09 Add the theme tokens, icon set and shell at the measured layout (Alessandro Viganò)
        review the concept against the code, then: drift link knowledge/project/state.md src/ui/Shell.tsx --doc-is-still-accurate  + a dated line in knowledge/log.md
FAIL  knowledge/project/state.md: drifted from src/ui/detail/TaskDetail.tsx (changed_after_baseline)
        blame: c75c277f 2026-09-15 Put a sub-task under its parent, and only there (Alessandro Viganò)
        review the concept against the code, then: drift link knowledge/project/state.md src/ui/detail/TaskDetail.tsx --doc-is-still-accurate  + a dated line in knowledge/log.md
EXIT_STATUS=1
```

## 7. Final repository checks

### git diff --check — PASS

```text
EXIT_STATUS=0
```

### git status --short — PASS

The command exited 0. Its exact output was:

```text
 M .gitignore
 M CHANGELOG.md
 M README.md
 M docs/HANDOVER.md
 M docs/layout-specs.md
 M drift.lock
 M knowledge/architecture/architecture.md
 M knowledge/log.md
 M knowledge/project/setup.md
 M knowledge/project/stack.md
 M knowledge/project/state.md
 M package.json
 M pnpm-lock.yaml
 M scripts/sync-version.mjs
 M src/api/errors.ts
 M src/api/http.test.ts
 M src/api/http.ts
 M src/app/App.tsx
 M src/queries/useCompleteTask.test.tsx
 M src/queries/useCompleteTask.ts
 M src/screens/SetupScreen.module.css
 M src/screens/SetupScreen.test.tsx
 M src/screens/SetupScreen.tsx
 M src/settings/settingsStore.ts
 M src/store/persistentValue.test.ts
 M src/store/persistentValue.ts
 M src/ui/ConfirmDialog.tsx
 M src/ui/ListView.module.css
 M src/ui/QuickAdd.module.css
 M src/ui/QuickAdd.tsx
 M src/ui/Shell.module.css
 M src/ui/Shell.tsx
 M src/ui/Sidebar.tsx
 M src/ui/detail/Comments.tsx
 M src/ui/detail/EditableField.tsx
 M src/ui/detail/PickerField.tsx
 M src/ui/detail/TaskDetail.module.css
 M src/ui/detail/TaskDetail.test.tsx
 M src/ui/detail/TaskDetail.tsx
 M src/ui/icons/paths.ts
 M vite.config.ts
?? docs/designs/
?? src-tauri/
?? src/app/App.module.css
?? src/app/App.test.tsx
?? src/lifecycle/
?? src/screens/TransportConsentScreen.module.css
?? src/screens/TransportConsentScreen.tsx
?? src/settings/transportPolicy.test.ts
?? src/settings/transportPolicy.ts
?? src/store/persistenceNotice.ts
?? src/ui/Shell.test.tsx
?? src/ui/overlayStack.tsx
EXIT_STATUS=0

The dirty entries above were present before the verification run; generated dist/, src-tauri/target/, and src-tauri/gen/ output did not appear as additional status entries.
