# Lifecycle trace equivalence

Generated from the public `LifecycleCoordinator` calls and `Machine::step` effects. The `same` column is observational data; this slice does not assert equivalence.

### asks_ready_frontend_once

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `FrontendReady` | `NoOp` | `NoOp` | `true` | — |
| `Begin(Close,true)` | `Asked` | `Asked` | `true` | — |
| `Begin(Close,true)` | `Ignored` | `Ignored` | `true` | — |

### b1_timeout_reemits_an_active_attempt_after_frontend_replacement

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `FrontendReady` | `NoOp` | `NoOp` | `true` | — |
| `Begin(Close,true)` | `Asked` | `Asked` | `true` | — |
| `FrontendReady` | `Reemit` | `Reemit` | `true` | — |
| `TimeoutExpired` | `Reemit` | `Stale` | `false` | review-5 F3 |

### b1_frontend_ready_reports_an_active_attempt_for_reemit

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `FrontendReady` | `NoOp` | `NoOp` | `true` | — |
| `Begin(Close,true)` | `Asked` | `Asked` | `true` | — |
| `FrontendReady` | `Reemit` | `Reemit` | `true` | — |

### s1_decide_reserves_finalization_before_recreation_can_begin

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `FrontendReady` | `NoOp` | `NoOp` | `true` | — |
| `Begin(Quit,true)` | `Asked` | `Asked` | `true` | — |
| `Decide` | `Authorized` | `Authorized` | `true` | — |
| `BeginRecreation` | `Ignored` | `Ignored` | `true` | — |
| `FinishFinalize` | `NoOp` | `Stale` | `false` | D10/8 |
| `BeginRecreation` | `Other(started)` | `Ignored` | `false` | D10/8 |

### s2_quit_during_recreation_is_queued_and_replayed_after_success

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `BeginRecreation` | `Other(started)` | `Other(started)` | `true` | — |
| `Begin(Quit,false)` | `Queued` | `Queued` | `true` | — |
| `FinishRecreation(true)` | `Queued` | `Queued` | `true` | — |

### s2_quit_during_recreation_is_replayed_after_failure_too

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `BeginRecreation` | `Other(started)` | `Other(started)` | `true` | — |
| `Begin(Quit,false)` | `Queued` | `Queued` | `true` | — |
| `FinishRecreation(false)` | `Queued` | `Authorized` | `false` | Q2 |

### clean_allow_authorizes_once

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `FrontendReady` | `NoOp` | `NoOp` | `true` | — |
| `Begin(Quit,true)` | `Asked` | `Asked` | `true` | — |
| `Decide` | `Authorized` | `Authorized` | `true` | — |
| `Decide` | `Stale` | `Stale` | `true` | — |

### dirty_allow_requires_a_current_recheck

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `FrontendReady` | `NoOp` | `NoOp` | `true` | — |
| `Begin(Close,true)` | `Asked` | `Asked` | `true` | — |
| `Decide` | `Recheck` | `Recheck` | `true` | — |
| `Decide` | `Authorized` | `Authorized` | `true` | — |

### pending_work_cannot_be_discarded_as_clean

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `FrontendReady` | `NoOp` | `NoOp` | `true` | — |
| `Begin(Close,true)` | `Asked` | `Asked` | `true` | — |
| `Decide` | `Recheck` | `Recheck` | `true` | — |
| `Decide` | `Authorized` | `Authorized` | `true` | — |

### recovery_dialog_is_one_per_active_attempt

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `Begin(Close,true)` | `Recovered` | `Queued` | `false` | D1 |
| `StartRecovery` | `Recovered` | `Other(no counterpart)` | `false` | No counterpart: Timeout emits ShowRecoveryDialog |
| `StartRecovery` | `Stale` | `Other(no counterpart)` | `false` | No counterpart: Timeout emits ShowRecoveryDialog |
| `Recover(false)` | `Cancelled` | `Stale` | `false` | D1 |

### stale_generation_and_attempt_are_ignored

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `FrontendReady` | `NoOp` | `NoOp` | `true` | — |
| `Begin(Close,true)` | `Asked` | `Asked` | `true` | — |
| `Decide` | `Stale` | `Stale` | `true` | — |
| `Decide` | `Stale` | `Stale` | `true` | — |

### new_window_invalidates_old_frontend_and_attempt

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `FrontendReady` | `NoOp` | `NoOp` | `true` | — |
| `Begin(Close,true)` | `Asked` | `Asked` | `true` | — |
| `NewWindow` | `NoOp` | `Other(no counterpart)` | `false` | No counterpart: D12 uses RecreationStarted/Finished |
| `FrontendReady` | `NoOp` | `Reemit` | `false` | Coordinator: consequence of the unmapped `NewWindow` above, not a reachable divergence. The old coordinator had invalidated the attempt; the machine is still `Asking` because a window replacement during an ask goes through queued recreation (D13) and only then a new generation. With `NewWindow` mapped to `RecreationStarted` + `RecreationFinished{ok:true}` the ready would land in `AwaitingFrontend`/`Asking` of the new generation as designed. |
| `Decide` | `Stale` | `Stale` | `true` | — |

### close_then_quit_supersedes_the_close_attempt

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `FrontendReady` | `NoOp` | `NoOp` | `true` | — |
| `Begin(Close,true)` | `Asked` | `Asked` | `true` | — |
| `Begin(Quit,true)` | `Asked` | `Asked` | `true` | — |
| `Decide` | `Stale` | `Stale` | `true` | — |

### timeout_from_superseded_attempt_is_stale

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `FrontendReady` | `NoOp` | `NoOp` | `true` | — |
| `Begin(Close,true)` | `Asked` | `Asked` | `true` | — |
| `Begin(Quit,true)` | `Asked` | `Asked` | `true` | — |
| `TimeoutExpired` | `Stale` | `Stale` | `true` | — |

### finalization_reservation_is_taken_before_a_newer_request_can_start

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `FrontendReady` | `NoOp` | `NoOp` | `true` | — |
| `Begin(Close,true)` | `Asked` | `Asked` | `true` | — |
| `Decide` | `Authorized` | `Authorized` | `true` | — |
| `BeginRecreation` | `Ignored` | `Queued` | `false` | D13 |
| `Begin(Quit,true)` | `Queued` | `Queued` | `true` | — |

### finalization_reservation_blocks_newer_actions_until_finished

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `FrontendReady` | `NoOp` | `NoOp` | `true` | — |
| `Begin(Quit,true)` | `Asked` | `Asked` | `true` | — |
| `Decide` | `Authorized` | `Authorized` | `true` | — |
| `Begin(Quit,true)` | `Ignored` | `Ignored` | `true` | — |
| `FinishFinalize` | `NoOp` | `Stale` | `false` | D10/8 |
| `Begin(Quit,true)` | `Asked` | `Ignored` | `false` | D10/8 |

### new_1_quit_during_close_finalization_is_not_lost

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `FrontendReady` | `NoOp` | `NoOp` | `true` | — |
| `Begin(Close,true)` | `Asked` | `Asked` | `true` | — |
| `Decide` | `Authorized` | `Authorized` | `true` | — |
| `Begin(Quit,true)` | `Queued` | `Queued` | `true` | — |

### new_1_recreation_does_not_clear_an_active_decision

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `FrontendReady` | `NoOp` | `NoOp` | `true` | — |
| `Begin(Close,true)` | `Asked` | `Asked` | `true` | — |
| `BeginRecreation` | `Ignored` | `Queued` | `false` | D13 |

### new_3_recreation_refuses_an_active_lifecycle_attempt

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `FrontendReady` | `NoOp` | `NoOp` | `true` | — |
| `Begin(Quit,true)` | `Asked` | `Asked` | `true` | — |
| `BeginRecreation` | `Ignored` | `Queued` | `false` | D13 |

### new_4_timeout_cannot_clear_a_replacement_frontend

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `FrontendReady` | `NoOp` | `NoOp` | `true` | — |
| `Begin(Close,true)` | `Asked` | `Asked` | `true` | — |
| `FrontendReady` | `Reemit` | `Reemit` | `true` | — |
| `TimeoutExpired` | `Reemit` | `Stale` | `false` | review-5 F3 |

### readiness_cleanup_is_bound_to_the_native_generation_token

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `FrontendReady` | `NoOp` | `NoOp` | `true` | — |
| `FrontendReady` | `NoOp` | `NoOp` | `true` | — |
| `FrontendUnready` | `NoOp` | `NoOp` | `true` | — |
| `FrontendUnready` | `NoOp` | `NoOp` | `true` | — |

### readiness_tokens_record_the_window_generation

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `FrontendReady` | `NoOp` | `NoOp` | `true` | — |
| `NewWindow` | `NoOp` | `Other(no counterpart)` | `false` | No counterpart: D12 uses RecreationStarted/Finished |
| `FrontendReady` | `NoOp` | `NoOp` | `true` | — |
| `FrontendUnready` | `NoOp` | `NoOp` | `true` | — |

### recovery_decision_from_superseded_attempt_is_stale

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `Begin(Close,true)` | `Recovered` | `Queued` | `false` | D1 |
| `StartRecovery` | `Recovered` | `Other(no counterpart)` | `false` | No counterpart: Timeout emits ShowRecoveryDialog |
| `Begin(Quit,true)` | `Recovered` | `Queued` | `false` | D1 |
| `Recover(true)` | `Stale` | `Stale` | `true` | — |
| `StartRecovery` | `Recovered` | `Other(no counterpart)` | `false` | No counterpart: Timeout emits ShowRecoveryDialog |
| `Recover(false)` | `Cancelled` | `Stale` | `false` | D1 |

### recreation_is_serialized_and_generation_advances_after_success

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `BeginRecreation` | `Other(started)` | `Other(started)` | `true` | — |
| `BeginRecreation` | `Ignored` | `Ignored` | `true` | — |
| `FinishRecreation(false)` | `NoOp` | `NoOp` | `true` | — |
| `BeginRecreation` | `Other(started)` | `Other(started)` | `true` | — |
| `FinishRecreation(true)` | `NoOp` | `NoOp` | `true` | — |

### quit_without_a_visible_window_can_exit_directly

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `FrontendReady` | `NoOp` | `NoOp` | `true` | — |
| `Begin(Quit,false)` | `AllowedDirect` | `AllowedDirect` | `true` | — |

### bypasses_are_one_use_and_generation_bound

| call | old outcome | new outcome | same | explained by |
|---|---|---|---|---|
| `ArmExitBypass` | `NoOp` | `Other(no counterpart)` | `false` | No counterpart: ArmExitBypass is a machine effect |
| `TakeExitBypass` | `Bypassed` | `Other(no counterpart)` | `false` | No counterpart: ExitRequested consumes the bypass |

### Summary

- Rows same: 79.
- Different rows explained by a design decision or an explicit no-counterpart mapping: 23.
- Unexplained rows: 0 (one row folded by the coordinator after the wave: see `new_window_invalidates_old_frontend_and_attempt`).
- Old calls with no machine counterpart: `NewWindow` (D12 recreation event pair), `PrepareFrontendReemit` (machine re-emits on entry), `FrontendLost` (use generation-bound `FrontendUnready`), `StartRecovery` (Timeout owns dialog launch), `ArmExitBypass` (machine effect), `TakeExitBypass` (ExitRequested transition).
