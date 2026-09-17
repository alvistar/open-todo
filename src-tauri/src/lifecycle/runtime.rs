/*
   Tauri callbacks / commands / worker threads
                         │
                         ▼
   Sender<Envelope> ──► recv ──► Machine::step ──► effects in order
                                                   │
                                                   ▼
                                             EffectRunner::run
                                                   │
                                  completion Event ─┘
                                  (queued, never re-entrant)
*/

use super::machine::{Effect, Event, Machine, Token};
use std::sync::mpsc::{self, Receiver, RecvError, Sender};
use std::thread;

pub struct Envelope {
    pub event: Event,
    pub reply: Option<Reply>,
}

pub enum Reply {
    Token(Sender<Token>),
    Exit(Sender<ExitVerdict>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExitVerdict {
    Allow,
    Prevent,
}

pub trait EffectRunner: Send + 'static {
    /// Perform one effect. Completions are sent back as Events through `tx`;
    /// the runner never calls `Machine::step`.
    fn run(&mut self, effect: Effect, tx: &Sender<Envelope>);
}

#[derive(Clone)]
pub struct LifecycleHandle {
    tx: Sender<Envelope>,
}

impl LifecycleHandle {
    pub fn send(&self, event: Event) {
        let _ = self.tx.send(Envelope { event, reply: None });
    }

    pub fn ready(&self, instance_id: String) -> Result<Token, RecvError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        if self
            .tx
            .send(Envelope {
                event: Event::FrontendReady { instance_id },
                reply: Some(Reply::Token(reply_tx)),
            })
            .is_err()
        {
            return reply_rx.recv();
        }
        reply_rx.recv()
    }

    pub fn exit_requested(&self) -> ExitVerdict {
        let (reply_tx, reply_rx) = mpsc::channel();
        if self
            .tx
            .send(Envelope {
                event: Event::ExitRequested,
                reply: Some(Reply::Exit(reply_tx)),
            })
            .is_err()
        {
            return ExitVerdict::Prevent;
        }
        reply_rx.recv().unwrap_or(ExitVerdict::Prevent)
    }
}

pub fn spawn_loop(machine: Machine, runner: impl EffectRunner) -> LifecycleHandle {
    let (tx, rx) = mpsc::channel();
    let loop_tx = tx.clone();
    thread::spawn(move || run_loop(machine, runner, rx, loop_tx));
    LifecycleHandle { tx }
}

fn run_loop(
    mut machine: Machine,
    mut runner: impl EffectRunner,
    rx: Receiver<Envelope>,
    tx: Sender<Envelope>,
) {
    while let Ok(Envelope { event, reply }) = rx.recv() {
        let effects = machine.step(event);
        let mut answered = false;
        for effect in effects {
            match (&effect, reply.as_ref()) {
                (Effect::ReplyToken(token), Some(Reply::Token(reply_tx))) if !answered => {
                    let _ = reply_tx.send(token.clone());
                    answered = true;
                }
                (Effect::AllowExit | Effect::PreventExit, Some(Reply::Exit(reply_tx)))
                    if !answered =>
                {
                    let verdict = match &effect {
                        Effect::AllowExit => ExitVerdict::Allow,
                        Effect::PreventExit => ExitVerdict::Prevent,
                        _ => unreachable!(),
                    };
                    let _ = reply_tx.send(verdict);
                    answered = true;
                }
                _ => {}
            }
            runner.run(effect, &tx);
        }

        if !answered {
            match reply {
                Some(Reply::Token(_)) => {
                    log::debug!("lifecycle ready reply had no ReplyToken effect");
                }
                Some(Reply::Exit(reply_tx)) => {
                    log::debug!("lifecycle exit reply had no exit verdict effect");
                    let _ = reply_tx.send(ExitVerdict::Prevent);
                }
                None => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::machine::{Effect, Event, Kind, Machine, Token};
    use super::*;
    use std::sync::{mpsc, Arc, Mutex};
    use std::time::Duration;

    struct NoopRunner;

    impl EffectRunner for NoopRunner {
        fn run(&mut self, _effect: Effect, _tx: &std::sync::mpsc::Sender<Envelope>) {}
    }

    struct PanickingRunner {
        stopped: mpsc::Sender<()>,
    }

    impl EffectRunner for PanickingRunner {
        fn run(&mut self, _effect: Effect, _tx: &std::sync::mpsc::Sender<Envelope>) {
            let _ = self.stopped.send(());
            panic!("test runner stops the lifecycle loop");
        }
    }

    struct FakeRunner {
        seen: Arc<Mutex<Vec<Effect>>>,
        responses: Vec<(Effect, Event)>,
        notify: mpsc::Sender<()>,
    }

    impl EffectRunner for FakeRunner {
        fn run(&mut self, effect: Effect, tx: &mpsc::Sender<Envelope>) {
            self.seen.lock().unwrap().push(effect.clone());
            let response = self
                .responses
                .iter()
                .position(|(trigger, _)| trigger == &effect)
                .map(|index| self.responses.remove(index).1);
            if let Some(event) = response {
                let _ = tx.send(Envelope { event, reply: None });
            }
            let _ = self.notify.send(());
        }
    }

    fn fake_runner(
        responses: Vec<(Effect, Event)>,
    ) -> (FakeRunner, Arc<Mutex<Vec<Effect>>>, mpsc::Receiver<()>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let (notify, notifications) = mpsc::channel();
        (
            FakeRunner {
                seen: seen.clone(),
                responses,
                notify,
            },
            seen,
            notifications,
        )
    }

    fn wait_for_effects(notifications: &mpsc::Receiver<()>, count: usize) {
        for _ in 0..count {
            notifications
                .recv_timeout(Duration::from_secs(1))
                .expect("effect runner did not observe the expected effect");
        }
    }

    #[test]
    fn ready_returns_machine_minted_token() {
        let handle = spawn_loop(Machine::new(1), NoopRunner);
        assert_eq!(
            handle.ready("bridge".into()).unwrap(),
            Token {
                instance_id: "bridge".into(),
                generation: 1,
            }
        );
    }

    #[test]
    fn effects_are_observed_in_step_order() {
        let (runner, seen, notifications) = fake_runner(Vec::new());
        let handle = spawn_loop(Machine::new(1), runner);
        handle.send(Event::Begin {
            kind: Kind::Quit,
            window_exists: false,
        });
        wait_for_effects(&notifications, 2);
        assert_eq!(
            *seen.lock().unwrap(),
            vec![Effect::ArmExitBypass(1), Effect::Exit]
        );
    }

    #[test]
    fn event_sent_during_run_waits_until_current_effects_finish() {
        let (runner, seen, notifications) =
            fake_runner(vec![(Effect::ArmExitBypass(1), Event::ExitRequested)]);
        let handle = spawn_loop(Machine::new(1), runner);
        handle.send(Event::Begin {
            kind: Kind::Quit,
            window_exists: false,
        });
        wait_for_effects(&notifications, 3);
        assert_eq!(
            *seen.lock().unwrap(),
            vec![Effect::ArmExitBypass(1), Effect::Exit, Effect::AllowExit,]
        );
    }

    #[test]
    fn exit_requested_allows_only_after_bypass_is_armed() {
        let handle = spawn_loop(Machine::new(1), NoopRunner);
        assert_eq!(handle.exit_requested(), ExitVerdict::Prevent);
        drop(handle);

        let handle = spawn_loop(Machine::new(1), NoopRunner);
        handle.send(Event::Begin {
            kind: Kind::Quit,
            window_exists: false,
        });
        assert_eq!(handle.exit_requested(), ExitVerdict::Allow);
    }

    #[test]
    fn dropped_reply_does_not_panic_the_loop() {
        let handle = spawn_loop(Machine::new(1), NoopRunner);
        let (reply_tx, reply_rx) = mpsc::channel();
        drop(reply_rx);
        handle
            .tx
            .send(Envelope {
                event: Event::FrontendReady {
                    instance_id: "dropped".into(),
                },
                reply: Some(Reply::Token(reply_tx)),
            })
            .unwrap();
        assert_eq!(
            handle.ready("survived".into()).unwrap(),
            Token {
                instance_id: "survived".into(),
                generation: 1,
            }
        );
    }

    #[test]
    fn a_gone_loop_prevents_exit() {
        let (stopped, stopped_rx) = mpsc::channel();
        let handle = spawn_loop(Machine::new(1), PanickingRunner { stopped });
        handle.send(Event::Begin {
            kind: Kind::Quit,
            window_exists: false,
        });
        stopped_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("runner did not stop the lifecycle loop");
        assert_eq!(handle.exit_requested(), ExitVerdict::Prevent);
    }
}
