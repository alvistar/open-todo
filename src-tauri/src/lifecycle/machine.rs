#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Close,
    Quit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Discard,
    Cancel,
    ExitAnyway,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Attempt {
    pub id: u64,
    pub generation: u64,
    pub kind: Kind,
    pub sequence: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Token {
    pub instance_id: String,
    pub generation: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecreationId(pub u64);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum State {
    Idle {
        hidden_by_close: bool,
    },
    AwaitingFrontend {
        attempt: Attempt,
        recreate_pending: bool,
    },
    Asking {
        attempt: Attempt,
        frontend: Token,
        recreate_pending: bool,
    },
    Recovering {
        attempt: Attempt,
        recreate_pending: bool,
    },
    Finalizing {
        attempt: Attempt,
        queued_quit: bool,
        recreate_pending: bool,
    },
    Recreating {
        id: RecreationId,
        reserved: u64,
        queued_quit: bool,
        ready: Option<Token>,
    },
    Exiting {
        attempt: Option<Attempt>,
        generation: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Begin {
        kind: Kind,
        window_exists: bool,
    },
    Decide {
        attempt_id: u64,
        generation: u64,
        sequence: u64,
        decision: Decision,
        dirty: bool,
        pending: bool,
    },
    Finalized {
        attempt: Attempt,
        ok: bool,
    },
    FrontendReady {
        instance_id: String,
    },
    FrontendUnready {
        token: Token,
    },
    EmitFailed {
        attempt: Attempt,
        frontend: Token,
    },
    Timeout(Attempt),
    Recovered {
        attempt: Attempt,
        allow: bool,
    },
    RecreationStarted,
    RecreationFinished {
        id: RecreationId,
        ok: bool,
    },
    ExitRequested,
    Exited,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    EmitRequest { attempt: Attempt, frontend: Token },
    ScheduleTimeout(Attempt),
    ShowRecoveryDialog(Attempt),
    ShowWindow,
    Finalize(Attempt),
    ArmExitBypass(u64),
    Exit,
    AllowExit,
    PreventExit,
    Recreate(RecreationId),
    ReplyToken(Token),
    EmitError(String),
    Log(&'static str),
}

#[derive(Debug)]
pub struct Machine {
    state: State,
    generation: u64,
    next_attempt: u64,
    next_recreation: u64,
    frontend: Option<Token>,
    exit_bypass: Option<u64>,
}

impl Machine {
    pub fn new(generation: u64) -> Self {
        Self {
            state: State::Idle {
                hidden_by_close: false,
            },
            generation,
            next_attempt: 0,
            next_recreation: 0,
            frontend: None,
            exit_bypass: None,
        }
    }

    pub fn state(&self) -> &State {
        &self.state
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn step(&mut self, event: Event) -> Vec<Effect> {
        let current = std::mem::replace(
            &mut self.state,
            State::Idle {
                hidden_by_close: false,
            },
        );
        let (state, effects) = self.transition(current, event);
        debug_assert!(!effects.is_empty());
        self.state = state;
        effects
    }

    fn transition(&mut self, state: State, event: Event) -> (State, Vec<Effect>) {
        match state {
            State::Idle { hidden_by_close } => self.idle(hidden_by_close, event),
            State::AwaitingFrontend {
                attempt,
                recreate_pending,
            } => self.awaiting_frontend(attempt, recreate_pending, event),
            State::Asking {
                attempt,
                frontend,
                recreate_pending,
            } => self.asking(attempt, frontend, recreate_pending, event),
            State::Recovering {
                attempt,
                recreate_pending,
            } => self.recovering(attempt, recreate_pending, event),
            State::Finalizing {
                attempt,
                queued_quit,
                recreate_pending,
            } => self.finalizing(attempt, queued_quit, recreate_pending, event),
            State::Recreating {
                id,
                reserved,
                queued_quit,
                ready,
            } => self.recreating(id, reserved, queued_quit, ready, event),
            State::Exiting {
                attempt,
                generation,
            } => self.exiting(attempt, generation, event),
        }
    }

    fn idle(&mut self, hidden_by_close: bool, event: Event) -> (State, Vec<Effect>) {
        match event {
            Event::Begin {
                kind: Kind::Quit,
                window_exists: false,
            }
            | Event::Begin {
                kind: Kind::Quit,
                window_exists: true,
            } if hidden_by_close => (
                State::Exiting {
                    attempt: None,
                    generation: self.generation,
                },
                vec![self.arm_exit_bypass(), Effect::Exit],
            ),
            Event::Begin {
                kind: Kind::Quit,
                window_exists: false,
            } => (
                State::Exiting {
                    attempt: None,
                    generation: self.generation,
                },
                vec![self.arm_exit_bypass(), Effect::Exit],
            ),
            Event::Begin {
                kind: Kind::Close,
                window_exists: false,
            } => (
                State::Idle { hidden_by_close },
                vec![Effect::Log("no window")],
            ),
            Event::Begin {
                kind,
                window_exists: true,
            } => self.begin_attempt(hidden_by_close, kind),
            Event::RecreationStarted => self.start_recreation(),
            Event::FrontendReady { instance_id } => {
                let token = Token {
                    instance_id,
                    generation: self.generation,
                };
                self.frontend = Some(token.clone());
                (
                    State::Idle { hidden_by_close },
                    vec![Effect::ReplyToken(token), Effect::Log("ready")],
                )
            }
            Event::FrontendUnready { token } => {
                if self.frontend.as_ref() == Some(&token) {
                    self.frontend = None;
                    (
                        State::Idle { hidden_by_close },
                        vec![Effect::Log("unready")],
                    )
                } else {
                    (State::Idle { hidden_by_close }, vec![Effect::Log("stale")])
                }
            }
            Event::ExitRequested => {
                if self.exit_bypass == Some(self.generation) {
                    self.exit_bypass = None;
                    (State::Idle { hidden_by_close }, vec![Effect::AllowExit])
                } else {
                    let (state, mut effects) = self.transition(
                        State::Idle { hidden_by_close },
                        Event::Begin {
                            kind: Kind::Quit,
                            window_exists: true,
                        },
                    );
                    effects.insert(0, Effect::PreventExit);
                    (state, effects)
                }
            }
            _ => (State::Idle { hidden_by_close }, vec![Effect::Log("stale")]),
        }
    }

    fn begin_attempt(&mut self, hidden_by_close: bool, kind: Kind) -> (State, Vec<Effect>) {
        let attempt = self.new_attempt(kind);
        if let Some(frontend) = self.frontend.clone() {
            let mut effects = Vec::with_capacity(3);
            if hidden_by_close {
                effects.push(Effect::ShowWindow);
            }
            effects.push(Effect::EmitRequest {
                attempt: attempt.clone(),
                frontend: frontend.clone(),
            });
            effects.push(Effect::ScheduleTimeout(attempt.clone()));
            (
                State::Asking {
                    attempt,
                    frontend,
                    recreate_pending: false,
                },
                effects,
            )
        } else {
            (
                State::AwaitingFrontend {
                    attempt: attempt.clone(),
                    recreate_pending: false,
                },
                vec![Effect::ScheduleTimeout(attempt)],
            )
        }
    }

    fn awaiting_frontend(
        &mut self,
        attempt: Attempt,
        recreate_pending: bool,
        event: Event,
    ) -> (State, Vec<Effect>) {
        match event {
            Event::Begin {
                kind: Kind::Close, ..
            }
            | Event::Begin {
                kind: Kind::Quit,
                window_exists: true,
            } if attempt.kind == Kind::Quit => (
                State::AwaitingFrontend {
                    attempt,
                    recreate_pending,
                },
                vec![Effect::Log("dup")],
            ),
            Event::Begin {
                kind: Kind::Close, ..
            } => (
                State::AwaitingFrontend {
                    attempt,
                    recreate_pending,
                },
                vec![Effect::Log("dup")],
            ),
            Event::Begin {
                kind: Kind::Quit, ..
            } if attempt.kind == Kind::Close => {
                let upgraded = Self::bump_attempt(&attempt, Kind::Quit);
                (
                    State::AwaitingFrontend {
                        attempt: upgraded.clone(),
                        recreate_pending,
                    },
                    vec![Effect::ScheduleTimeout(upgraded)],
                )
            }
            Event::FrontendReady { instance_id } => {
                let token = Token {
                    instance_id,
                    generation: self.generation,
                };
                self.frontend = Some(token.clone());
                let asking = Self::bump_attempt(&attempt, attempt.kind);
                (
                    State::Asking {
                        attempt: asking.clone(),
                        frontend: token.clone(),
                        recreate_pending,
                    },
                    vec![
                        Effect::ReplyToken(token.clone()),
                        Effect::EmitRequest {
                            attempt: asking.clone(),
                            frontend: token,
                        },
                        Effect::ScheduleTimeout(asking),
                    ],
                )
            }
            Event::FrontendUnready { token } => {
                if self.frontend.as_ref() == Some(&token) {
                    self.frontend = None;
                }
                (
                    State::AwaitingFrontend {
                        attempt,
                        recreate_pending,
                    },
                    vec![Effect::Log("unready")],
                )
            }
            Event::RecreationStarted => (
                State::AwaitingFrontend {
                    attempt,
                    recreate_pending: true,
                },
                vec![Effect::Log("queued")],
            ),
            Event::Timeout(timeout) if same_attempt(&attempt, &timeout) => (
                State::Recovering {
                    attempt: attempt.clone(),
                    recreate_pending,
                },
                vec![Effect::ShowRecoveryDialog(attempt)],
            ),
            Event::ExitRequested => {
                let (state, mut effects) = self.transition(
                    State::AwaitingFrontend {
                        attempt,
                        recreate_pending,
                    },
                    Event::Begin {
                        kind: Kind::Quit,
                        window_exists: true,
                    },
                );
                effects.insert(0, Effect::PreventExit);
                (state, effects)
            }
            _ => (
                State::AwaitingFrontend {
                    attempt,
                    recreate_pending,
                },
                vec![Effect::Log("stale")],
            ),
        }
    }

    fn asking(
        &mut self,
        attempt: Attempt,
        frontend: Token,
        recreate_pending: bool,
        event: Event,
    ) -> (State, Vec<Effect>) {
        match event {
            Event::Begin {
                kind: Kind::Close, ..
            }
            | Event::Begin {
                kind: Kind::Quit, ..
            } if attempt.kind == Kind::Quit => (
                State::Asking {
                    attempt,
                    frontend,
                    recreate_pending,
                },
                vec![Effect::Log("dup")],
            ),
            Event::Begin {
                kind: Kind::Close, ..
            } => (
                State::Asking {
                    attempt,
                    frontend,
                    recreate_pending,
                },
                vec![Effect::Log("dup")],
            ),
            Event::Begin {
                kind: Kind::Quit, ..
            } if attempt.kind == Kind::Close => {
                let superseded = self.new_attempt(Kind::Quit);
                (
                    State::Asking {
                        attempt: superseded.clone(),
                        frontend: frontend.clone(),
                        recreate_pending,
                    },
                    vec![
                        Effect::EmitRequest {
                            attempt: superseded.clone(),
                            frontend,
                        },
                        Effect::ScheduleTimeout(superseded),
                    ],
                )
            }
            Event::Decide {
                attempt_id,
                generation,
                sequence,
                decision,
                dirty,
                pending,
            } => {
                if !owner_matches(&attempt, attempt_id, generation, sequence) {
                    return (
                        State::Asking {
                            attempt,
                            frontend,
                            recreate_pending,
                        },
                        vec![Effect::Log("stale")],
                    );
                }
                let needs_recheck = match decision {
                    Decision::Allow => dirty || pending,
                    Decision::Discard => pending,
                    Decision::Cancel | Decision::ExitAnyway => false,
                };
                match decision {
                    Decision::Cancel => {
                        let idle = State::Idle {
                            hidden_by_close: false,
                        };
                        if recreate_pending {
                            let (state, more) = self.transition(idle, Event::RecreationStarted);
                            let mut effects = vec![Effect::Log("cancelled")];
                            effects.extend(more);
                            (state, effects)
                        } else {
                            (idle, vec![Effect::Log("cancelled")])
                        }
                    }
                    _ if needs_recheck => {
                        let recheck = Self::bump_attempt(&attempt, attempt.kind);
                        (
                            State::Asking {
                                attempt: recheck.clone(),
                                frontend: frontend.clone(),
                                recreate_pending,
                            },
                            vec![
                                Effect::EmitRequest {
                                    attempt: recheck.clone(),
                                    frontend,
                                },
                                Effect::ScheduleTimeout(recheck),
                            ],
                        )
                    }
                    Decision::Allow | Decision::Discard | Decision::ExitAnyway => {
                        self.authorize(attempt, recreate_pending)
                    }
                }
            }
            Event::FrontendReady { instance_id } => {
                let token = Token {
                    instance_id,
                    generation: self.generation,
                };
                self.frontend = Some(token.clone());
                if token == frontend {
                    (
                        State::Asking {
                            attempt,
                            frontend,
                            recreate_pending,
                        },
                        vec![Effect::ReplyToken(token), Effect::Log("ready")],
                    )
                } else {
                    let replacement = Self::bump_attempt(&attempt, attempt.kind);
                    (
                        State::Asking {
                            attempt: replacement.clone(),
                            frontend: token.clone(),
                            recreate_pending,
                        },
                        vec![
                            Effect::ReplyToken(token.clone()),
                            Effect::EmitRequest {
                                attempt: replacement.clone(),
                                frontend: token,
                            },
                            Effect::ScheduleTimeout(replacement),
                        ],
                    )
                }
            }
            Event::FrontendUnready { token } => {
                if token == frontend {
                    self.frontend = None;
                    (
                        State::Asking {
                            attempt,
                            frontend,
                            recreate_pending,
                        },
                        vec![Effect::Log("unready")],
                    )
                } else {
                    (
                        State::Asking {
                            attempt,
                            frontend,
                            recreate_pending,
                        },
                        vec![Effect::Log("stale")],
                    )
                }
            }
            Event::EmitFailed {
                attempt: failed_attempt,
                frontend: failed_frontend,
            } => {
                if same_attempt(&attempt, &failed_attempt) && frontend == failed_frontend {
                    self.frontend = None;
                    (
                        State::Asking {
                            attempt,
                            frontend,
                            recreate_pending,
                        },
                        vec![
                            Effect::EmitError("lifecycle request emission failed".into()),
                            Effect::Log("emit failed"),
                        ],
                    )
                } else {
                    (
                        State::Asking {
                            attempt,
                            frontend,
                            recreate_pending,
                        },
                        vec![Effect::Log("stale")],
                    )
                }
            }
            Event::Timeout(timeout) => {
                if !same_attempt(&attempt, &timeout) {
                    return (
                        State::Asking {
                            attempt,
                            frontend,
                            recreate_pending,
                        },
                        vec![Effect::Log("stale")],
                    );
                }
                match self.frontend.as_ref() {
                    Some(current) if current != &frontend => {
                        let replacement = Self::bump_attempt(&attempt, attempt.kind);
                        (
                            State::Asking {
                                attempt: replacement.clone(),
                                frontend: current.clone(),
                                recreate_pending,
                            },
                            vec![
                                Effect::EmitRequest {
                                    attempt: replacement.clone(),
                                    frontend: current.clone(),
                                },
                                Effect::ScheduleTimeout(replacement),
                            ],
                        )
                    }
                    _ => (
                        State::Recovering {
                            attempt: attempt.clone(),
                            recreate_pending,
                        },
                        vec![Effect::ShowRecoveryDialog(attempt)],
                    ),
                }
            }
            Event::RecreationStarted => (
                State::Asking {
                    attempt,
                    frontend,
                    recreate_pending: true,
                },
                vec![Effect::Log("queued")],
            ),
            Event::ExitRequested => {
                let (state, mut effects) = self.transition(
                    State::Asking {
                        attempt,
                        frontend,
                        recreate_pending,
                    },
                    Event::Begin {
                        kind: Kind::Quit,
                        window_exists: true,
                    },
                );
                effects.insert(0, Effect::PreventExit);
                (state, effects)
            }
            _ => (
                State::Asking {
                    attempt,
                    frontend,
                    recreate_pending,
                },
                vec![Effect::Log("stale")],
            ),
        }
    }

    fn recovering(
        &mut self,
        attempt: Attempt,
        recreate_pending: bool,
        event: Event,
    ) -> (State, Vec<Effect>) {
        match event {
            Event::Begin { .. } => (
                State::Recovering {
                    attempt,
                    recreate_pending,
                },
                vec![Effect::Log("dialog owns input")],
            ),
            Event::FrontendReady { instance_id } => {
                let token = Token {
                    instance_id,
                    generation: self.generation,
                };
                self.frontend = Some(token.clone());
                (
                    State::Recovering {
                        attempt,
                        recreate_pending,
                    },
                    vec![
                        Effect::ReplyToken(token),
                        Effect::Log("dialog is the authority"),
                    ],
                )
            }
            Event::FrontendUnready { token } => {
                if self.frontend.as_ref() == Some(&token) {
                    self.frontend = None;
                }
                (
                    State::Recovering {
                        attempt,
                        recreate_pending,
                    },
                    vec![Effect::Log("unready")],
                )
            }
            Event::Recovered {
                attempt: recovered,
                allow,
            } => {
                if !same_attempt(&attempt, &recovered) {
                    return (
                        State::Recovering {
                            attempt,
                            recreate_pending,
                        },
                        vec![Effect::Log("stale")],
                    );
                }
                if !allow {
                    let idle = State::Idle {
                        hidden_by_close: false,
                    };
                    if recreate_pending {
                        let (state, more) = self.transition(idle, Event::RecreationStarted);
                        let mut effects = vec![Effect::Log("cancelled")];
                        effects.extend(more);
                        return (state, effects);
                    }
                    return (idle, vec![Effect::Log("cancelled")]);
                }
                self.authorize_recovered(attempt, recreate_pending)
            }
            Event::RecreationStarted => (
                State::Recovering {
                    attempt,
                    recreate_pending: true,
                },
                vec![Effect::Log("queued")],
            ),
            Event::ExitRequested => {
                let (state, mut effects) = self.transition(
                    State::Recovering {
                        attempt,
                        recreate_pending,
                    },
                    Event::Begin {
                        kind: Kind::Quit,
                        window_exists: true,
                    },
                );
                effects.insert(0, Effect::PreventExit);
                (state, effects)
            }
            _ => (
                State::Recovering {
                    attempt,
                    recreate_pending,
                },
                vec![Effect::Log("stale")],
            ),
        }
    }

    fn authorize_recovered(
        &mut self,
        attempt: Attempt,
        recreate_pending: bool,
    ) -> (State, Vec<Effect>) {
        match attempt.kind {
            Kind::Close => {
                #[cfg(target_os = "macos")]
                let effects = vec![Effect::Finalize(attempt.clone())];
                #[cfg(not(target_os = "macos"))]
                let effects = vec![self.arm_exit_bypass(), Effect::Finalize(attempt.clone())];
                (
                    State::Finalizing {
                        attempt,
                        queued_quit: false,
                        recreate_pending,
                    },
                    effects,
                )
            }
            Kind::Quit => (
                State::Exiting {
                    attempt: Some(attempt),
                    generation: self.generation,
                },
                vec![self.arm_exit_bypass(), Effect::Exit],
            ),
        }
    }

    fn finalizing(
        &mut self,
        attempt: Attempt,
        queued_quit: bool,
        recreate_pending: bool,
        event: Event,
    ) -> (State, Vec<Effect>) {
        match event {
            Event::Begin {
                kind: Kind::Quit, ..
            } => (
                State::Finalizing {
                    attempt,
                    queued_quit: true,
                    recreate_pending,
                },
                vec![Effect::Log("queued")],
            ),
            Event::Begin {
                kind: Kind::Close, ..
            } => (
                State::Finalizing {
                    attempt,
                    queued_quit,
                    recreate_pending,
                },
                vec![Effect::Log("finalizing")],
            ),
            Event::Finalized {
                attempt: finalized,
                ok,
            } => {
                if !same_attempt(&attempt, &finalized) {
                    return (
                        State::Finalizing {
                            attempt,
                            queued_quit,
                            recreate_pending,
                        },
                        vec![Effect::Log("stale")],
                    );
                }
                let hidden_by_close = attempt.kind == Kind::Close && ok;
                if ok {
                    let idle = State::Idle { hidden_by_close };
                    if queued_quit {
                        let (state, effects) = self.transition(
                            idle,
                            Event::Begin {
                                kind: Kind::Quit,
                                window_exists: true,
                            },
                        );
                        return (state, effects);
                    }
                    if recreate_pending {
                        return self.transition(idle, Event::RecreationStarted);
                    }
                    (idle, vec![Effect::Log("finalized")])
                } else {
                    let mut effects =
                        vec![Effect::EmitError("lifecycle finalization failed".into())];
                    let idle = State::Idle {
                        hidden_by_close: false,
                    };
                    if queued_quit {
                        let (state, more) = self.transition(
                            idle,
                            Event::Begin {
                                kind: Kind::Quit,
                                window_exists: true,
                            },
                        );
                        effects.extend(more);
                        (state, effects)
                    } else if recreate_pending {
                        let (state, more) = self.transition(idle, Event::RecreationStarted);
                        effects.extend(more);
                        (state, effects)
                    } else {
                        effects.push(Effect::Log("finalization failed"));
                        (idle, effects)
                    }
                }
            }
            Event::FrontendReady { instance_id } => {
                let token = Token {
                    instance_id,
                    generation: self.generation,
                };
                self.frontend = Some(token.clone());
                (
                    State::Finalizing {
                        attempt,
                        queued_quit,
                        recreate_pending,
                    },
                    vec![Effect::ReplyToken(token), Effect::Log("ready")],
                )
            }
            Event::FrontendUnready { token } => {
                if self.frontend.as_ref() == Some(&token) {
                    self.frontend = None;
                }
                (
                    State::Finalizing {
                        attempt,
                        queued_quit,
                        recreate_pending,
                    },
                    vec![Effect::Log("unready")],
                )
            }
            Event::RecreationStarted => (
                State::Finalizing {
                    attempt,
                    queued_quit,
                    recreate_pending: true,
                },
                vec![Effect::Log("queued")],
            ),
            Event::ExitRequested => (
                State::Finalizing {
                    attempt,
                    queued_quit: true,
                    recreate_pending,
                },
                vec![Effect::PreventExit, Effect::Log("finalizing; quit queued")],
            ),
            _ => (
                State::Finalizing {
                    attempt,
                    queued_quit,
                    recreate_pending,
                },
                vec![Effect::Log("stale")],
            ),
        }
    }

    fn start_recreation(&mut self) -> (State, Vec<Effect>) {
        self.next_recreation = self.next_recreation.saturating_add(1);
        let id = RecreationId(self.next_recreation);
        (
            State::Recreating {
                id,
                reserved: self.generation.saturating_add(1),
                queued_quit: false,
                ready: None,
            },
            vec![Effect::Recreate(id)],
        )
    }

    fn recreating(
        &mut self,
        id: RecreationId,
        reserved: u64,
        queued_quit: bool,
        ready: Option<Token>,
        event: Event,
    ) -> (State, Vec<Effect>) {
        match event {
            Event::Begin {
                kind: Kind::Quit, ..
            } => (
                State::Recreating {
                    id,
                    reserved,
                    queued_quit: true,
                    ready,
                },
                vec![Effect::Log("queued")],
            ),
            Event::Begin {
                kind: Kind::Close, ..
            } => (
                State::Recreating {
                    id,
                    reserved,
                    queued_quit,
                    ready,
                },
                vec![Effect::Log("no window")],
            ),
            Event::FrontendReady { instance_id } => {
                let token = Token {
                    instance_id,
                    generation: reserved,
                };
                (
                    State::Recreating {
                        id,
                        reserved,
                        queued_quit,
                        ready: Some(token.clone()),
                    },
                    vec![Effect::ReplyToken(token), Effect::Log("ready")],
                )
            }
            Event::FrontendUnready { token } => {
                let is_ready = ready.as_ref() == Some(&token);
                let is_current = self.frontend.as_ref() == Some(&token);
                if is_ready || is_current {
                    self.frontend = None;
                }
                (
                    State::Recreating {
                        id,
                        reserved,
                        queued_quit,
                        ready: if is_ready { None } else { ready },
                    },
                    vec![Effect::Log("unready")],
                )
            }
            Event::RecreationStarted => (
                State::Recreating {
                    id,
                    reserved,
                    queued_quit,
                    ready,
                },
                vec![Effect::Log("already recreating")],
            ),
            Event::RecreationFinished {
                id: finished_id,
                ok,
            } => {
                if id != finished_id {
                    return (
                        State::Recreating {
                            id,
                            reserved,
                            queued_quit,
                            ready,
                        },
                        vec![Effect::Log("stale")],
                    );
                }
                if ok {
                    self.generation = reserved;
                    self.frontend = ready.clone();
                    if queued_quit {
                        if let Some(frontend) = ready {
                            let attempt = self.new_attempt(Kind::Quit);
                            return (
                                State::Asking {
                                    attempt: attempt.clone(),
                                    frontend: frontend.clone(),
                                    recreate_pending: false,
                                },
                                vec![
                                    Effect::EmitRequest {
                                        attempt: attempt.clone(),
                                        frontend,
                                    },
                                    Effect::ScheduleTimeout(attempt),
                                ],
                            );
                        }
                        let attempt = self.new_attempt(Kind::Quit);
                        return (
                            State::AwaitingFrontend {
                                attempt: attempt.clone(),
                                recreate_pending: false,
                            },
                            vec![Effect::ScheduleTimeout(attempt)],
                        );
                    }
                    (
                        State::Idle {
                            hidden_by_close: false,
                        },
                        vec![Effect::Log("recreated")],
                    )
                } else {
                    self.frontend = None;
                    let mut effects = vec![Effect::EmitError("lifecycle recreation failed".into())];
                    if queued_quit {
                        effects.extend([self.arm_exit_bypass(), Effect::Exit]);
                        (
                            State::Exiting {
                                attempt: None,
                                generation: self.generation,
                            },
                            effects,
                        )
                    } else {
                        effects.push(Effect::Log("recreation failed"));
                        (
                            State::Idle {
                                hidden_by_close: false,
                            },
                            effects,
                        )
                    }
                }
            }
            Event::ExitRequested => (
                State::Recreating {
                    id,
                    reserved,
                    queued_quit: true,
                    ready,
                },
                vec![Effect::PreventExit, Effect::Log("queued")],
            ),
            _ => (
                State::Recreating {
                    id,
                    reserved,
                    queued_quit,
                    ready,
                },
                vec![Effect::Log("stale")],
            ),
        }
    }

    fn exiting(
        &mut self,
        attempt: Option<Attempt>,
        generation: u64,
        event: Event,
    ) -> (State, Vec<Effect>) {
        match event {
            Event::ExitRequested if self.exit_bypass == Some(generation) => {
                self.exit_bypass = None;
                (
                    State::Exiting {
                        attempt,
                        generation,
                    },
                    vec![Effect::AllowExit],
                )
            }
            Event::ExitRequested => (
                State::Exiting {
                    attempt,
                    generation,
                },
                vec![
                    Effect::PreventExit,
                    Effect::Log("unarmed exit request while exiting"),
                ],
            ),
            Event::Exited => (
                State::Exiting {
                    attempt,
                    generation,
                },
                vec![Effect::Log("exited")],
            ),
            _ => (
                State::Exiting {
                    attempt,
                    generation,
                },
                vec![Effect::Log("exiting")],
            ),
        }
    }

    fn authorize(&mut self, attempt: Attempt, recreate_pending: bool) -> (State, Vec<Effect>) {
        match attempt.kind {
            Kind::Close => {
                #[cfg(target_os = "macos")]
                let effects = vec![Effect::Finalize(attempt.clone())];
                #[cfg(not(target_os = "macos"))]
                let effects = vec![self.arm_exit_bypass(), Effect::Finalize(attempt.clone())];
                (
                    State::Finalizing {
                        attempt,
                        queued_quit: false,
                        recreate_pending,
                    },
                    effects,
                )
            }
            Kind::Quit => (
                State::Exiting {
                    attempt: Some(attempt),
                    generation: self.generation,
                },
                vec![self.arm_exit_bypass(), Effect::Exit],
            ),
        }
    }

    fn new_attempt(&mut self, kind: Kind) -> Attempt {
        self.next_attempt = self.next_attempt.saturating_add(1);
        Attempt {
            id: self.next_attempt,
            generation: self.generation,
            kind,
            sequence: 0,
        }
    }

    fn arm_exit_bypass(&mut self) -> Effect {
        self.exit_bypass = Some(self.generation);
        Effect::ArmExitBypass(self.generation)
    }

    fn bump_attempt(attempt: &Attempt, kind: Kind) -> Attempt {
        Attempt {
            id: attempt.id,
            generation: attempt.generation,
            kind,
            sequence: attempt.sequence.saturating_add(1),
        }
    }
}

fn same_attempt(left: &Attempt, right: &Attempt) -> bool {
    left.id == right.id && left.generation == right.generation && left.sequence == right.sequence
}

fn owner_matches(attempt: &Attempt, id: u64, generation: u64, sequence: u64) -> bool {
    attempt.id == id && attempt.generation == generation && attempt.sequence == sequence
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex1_upgrade_in_waiting_rearms_timeout() {
        let mut machine = Machine::new(1);

        machine.step(Event::Begin {
            kind: Kind::Close,
            window_exists: true,
        });

        let effects = machine.step(Event::Begin {
            kind: Kind::Quit,
            window_exists: true,
        });

        let attempt = Attempt {
            id: 1,
            generation: 1,
            kind: Kind::Quit,
            sequence: 1,
        };
        assert_eq!(
            (machine.state(), effects),
            (
                &State::AwaitingFrontend {
                    attempt: attempt.clone(),
                    recreate_pending: false,
                },
                vec![Effect::ScheduleTimeout(attempt)],
            )
        );
    }

    #[test]
    fn b1prime_quit_before_bridge_ready_waits_then_asks() {
        let mut machine = Machine::new(1);
        machine.step(Event::Begin {
            kind: Kind::Quit,
            window_exists: true,
        });

        let effects = machine.step(Event::FrontendReady {
            instance_id: "bridge".into(),
        });
        let attempt = Attempt {
            id: 1,
            generation: 1,
            kind: Kind::Quit,
            sequence: 1,
        };
        let token = Token {
            instance_id: "bridge".into(),
            generation: 1,
        };
        assert_eq!(
            (machine.state(), effects),
            (
                &State::Asking {
                    attempt: attempt.clone(),
                    frontend: token.clone(),
                    recreate_pending: false,
                },
                vec![
                    Effect::ReplyToken(token.clone()),
                    Effect::EmitRequest {
                        attempt: attempt.clone(),
                        frontend: token,
                    },
                    Effect::ScheduleTimeout(attempt),
                ],
            )
        );
    }

    #[test]
    fn codex6_late_emit_failure_does_not_clear_replacement_bridge() {
        let mut machine = Machine::new(1);
        machine.step(Event::FrontendReady {
            instance_id: "one".into(),
        });
        machine.step(Event::Begin {
            kind: Kind::Close,
            window_exists: true,
        });
        machine.step(Event::FrontendReady {
            instance_id: "two".into(),
        });

        let old_attempt = Attempt {
            id: 1,
            generation: 1,
            kind: Kind::Close,
            sequence: 0,
        };
        let effects = machine.step(Event::EmitFailed {
            attempt: old_attempt.clone(),
            frontend: Token {
                instance_id: "one".into(),
                generation: 1,
            },
        });
        let current_attempt = Attempt {
            sequence: 1,
            ..old_attempt
        };
        let current_token = Token {
            instance_id: "two".into(),
            generation: 1,
        };
        assert_eq!(
            (machine.state(), effects),
            (
                &State::Asking {
                    attempt: current_attempt,
                    frontend: current_token,
                    recreate_pending: false,
                },
                vec![Effect::Log("stale")],
            )
        );
    }

    #[test]
    fn old_asks_ready_frontend_once() {
        let mut machine = Machine::new(1);
        let effects = machine.step(Event::FrontendReady {
            instance_id: "bridge".into(),
        });
        assert_eq!(
            effects,
            vec![
                Effect::ReplyToken(Token {
                    instance_id: "bridge".into(),
                    generation: 1,
                }),
                Effect::Log("ready"),
            ]
        );
    }

    #[test]
    fn old_clean_allow_authorizes_once() {
        let mut machine = Machine::new(1);
        machine.step(Event::FrontendReady {
            instance_id: "bridge".into(),
        });
        machine.step(Event::Begin {
            kind: Kind::Close,
            window_exists: true,
        });
        let attempt = Attempt {
            id: 1,
            generation: 1,
            kind: Kind::Close,
            sequence: 0,
        };
        let effects = machine.step(Event::Decide {
            attempt_id: 1,
            generation: 1,
            sequence: 0,
            decision: Decision::Allow,
            dirty: false,
            pending: false,
        });
        #[cfg(target_os = "macos")]
        let expected_effects = vec![Effect::Finalize(attempt.clone())];
        #[cfg(not(target_os = "macos"))]
        let expected_effects = vec![Effect::ArmExitBypass(1), Effect::Finalize(attempt.clone())];
        assert_eq!(
            (machine.state(), effects),
            (
                &State::Finalizing {
                    attempt,
                    queued_quit: false,
                    recreate_pending: false,
                },
                expected_effects,
            )
        );
    }

    #[test]
    fn old_dirty_allow_requires_a_current_recheck() {
        let mut machine = Machine::new(1);
        machine.step(Event::FrontendReady {
            instance_id: "bridge".into(),
        });
        machine.step(Event::Begin {
            kind: Kind::Close,
            window_exists: true,
        });
        let effects = machine.step(Event::Decide {
            attempt_id: 1,
            generation: 1,
            sequence: 0,
            decision: Decision::Allow,
            dirty: true,
            pending: false,
        });
        let attempt = Attempt {
            id: 1,
            generation: 1,
            kind: Kind::Close,
            sequence: 1,
        };
        let token = Token {
            instance_id: "bridge".into(),
            generation: 1,
        };
        assert_eq!(
            (machine.state(), effects),
            (
                &State::Asking {
                    attempt: attempt.clone(),
                    frontend: token.clone(),
                    recreate_pending: false,
                },
                vec![
                    Effect::EmitRequest {
                        attempt: attempt.clone(),
                        frontend: token,
                    },
                    Effect::ScheduleTimeout(attempt),
                ],
            )
        );
    }

    #[test]
    fn old_pending_work_cannot_be_discarded_as_clean() {
        let mut machine = Machine::new(1);
        machine.step(Event::FrontendReady {
            instance_id: "bridge".into(),
        });
        machine.step(Event::Begin {
            kind: Kind::Close,
            window_exists: true,
        });
        let effects = machine.step(Event::Decide {
            attempt_id: 1,
            generation: 1,
            sequence: 0,
            decision: Decision::Discard,
            dirty: false,
            pending: true,
        });
        let attempt = Attempt {
            id: 1,
            generation: 1,
            kind: Kind::Close,
            sequence: 1,
        };
        let token = Token {
            instance_id: "bridge".into(),
            generation: 1,
        };
        assert_eq!(
            (machine.state(), effects),
            (
                &State::Asking {
                    attempt: attempt.clone(),
                    frontend: token.clone(),
                    recreate_pending: false,
                },
                vec![
                    Effect::EmitRequest {
                        attempt: attempt.clone(),
                        frontend: token,
                    },
                    Effect::ScheduleTimeout(attempt),
                ],
            )
        );
    }

    #[test]
    fn old_close_then_quit_supersedes_the_close_attempt() {
        let mut machine = Machine::new(1);
        machine.step(Event::FrontendReady {
            instance_id: "bridge".into(),
        });
        machine.step(Event::Begin {
            kind: Kind::Close,
            window_exists: true,
        });
        let effects = machine.step(Event::Begin {
            kind: Kind::Quit,
            window_exists: true,
        });
        let attempt = Attempt {
            id: 2,
            generation: 1,
            kind: Kind::Quit,
            sequence: 0,
        };
        let token = Token {
            instance_id: "bridge".into(),
            generation: 1,
        };
        assert_eq!(
            (machine.state(), effects),
            (
                &State::Asking {
                    attempt: attempt.clone(),
                    frontend: token.clone(),
                    recreate_pending: false,
                },
                vec![
                    Effect::EmitRequest {
                        attempt: attempt.clone(),
                        frontend: token,
                    },
                    Effect::ScheduleTimeout(attempt),
                ],
            )
        );
    }

    #[test]
    fn old_stale_generation_and_attempt_are_ignored() {
        let mut machine = Machine::new(1);
        machine.step(Event::FrontendReady {
            instance_id: "bridge".into(),
        });
        machine.step(Event::Begin {
            kind: Kind::Close,
            window_exists: true,
        });
        let effects = machine.step(Event::Decide {
            attempt_id: 1,
            generation: 2,
            sequence: 0,
            decision: Decision::Allow,
            dirty: false,
            pending: false,
        });
        let attempt = Attempt {
            id: 1,
            generation: 1,
            kind: Kind::Close,
            sequence: 0,
        };
        let token = Token {
            instance_id: "bridge".into(),
            generation: 1,
        };
        assert_eq!(
            (machine.state(), effects),
            (
                &State::Asking {
                    attempt,
                    frontend: token,
                    recreate_pending: false,
                },
                vec![Effect::Log("stale")],
            )
        );
    }

    #[test]
    fn old_quit_without_a_visible_window_can_exit_directly() {
        let mut machine = Machine::new(1);
        let effects = machine.step(Event::Begin {
            kind: Kind::Quit,
            window_exists: false,
        });
        assert_eq!(
            (machine.state(), effects),
            (
                &State::Exiting {
                    attempt: None,
                    generation: 1,
                },
                vec![Effect::ArmExitBypass(1), Effect::Exit],
            )
        );
    }

    #[test]
    fn new1_quit_queued_behind_close_exits_after_hide() {
        let mut machine = Machine::new(1);
        machine.step(Event::FrontendReady {
            instance_id: "bridge".into(),
        });
        machine.step(Event::Begin {
            kind: Kind::Close,
            window_exists: true,
        });
        machine.step(Event::Decide {
            attempt_id: 1,
            generation: 1,
            sequence: 0,
            decision: Decision::Allow,
            dirty: false,
            pending: false,
        });
        machine.step(Event::Begin {
            kind: Kind::Quit,
            window_exists: true,
        });

        let close = Attempt {
            id: 1,
            generation: 1,
            kind: Kind::Close,
            sequence: 0,
        };
        let effects = machine.step(Event::Finalized {
            attempt: close,
            ok: true,
        });
        assert_eq!(
            (machine.state(), effects),
            (
                &State::Exiting {
                    attempt: None,
                    generation: 1,
                },
                vec![Effect::ArmExitBypass(1), Effect::Exit],
            )
        );
    }

    #[test]
    fn codex2_cmd_h_then_quit_asks() {
        let mut machine = Machine::new(1);
        machine.step(Event::FrontendReady {
            instance_id: "bridge".into(),
        });

        let effects = machine.step(Event::Begin {
            kind: Kind::Quit,
            window_exists: true,
        });
        let attempt = Attempt {
            id: 1,
            generation: 1,
            kind: Kind::Quit,
            sequence: 0,
        };
        let token = Token {
            instance_id: "bridge".into(),
            generation: 1,
        };
        assert_eq!(
            (machine.state(), effects),
            (
                &State::Asking {
                    attempt: attempt.clone(),
                    frontend: token.clone(),
                    recreate_pending: false,
                },
                vec![
                    Effect::EmitRequest {
                        attempt: attempt.clone(),
                        frontend: token,
                    },
                    Effect::ScheduleTimeout(attempt),
                ],
            )
        );
    }

    #[test]
    fn codex7_failed_close_reasks_queued_quit() {
        let mut machine = Machine::new(1);
        machine.step(Event::FrontendReady {
            instance_id: "bridge".into(),
        });
        machine.step(Event::Begin {
            kind: Kind::Close,
            window_exists: true,
        });
        machine.step(Event::Decide {
            attempt_id: 1,
            generation: 1,
            sequence: 0,
            decision: Decision::Allow,
            dirty: false,
            pending: false,
        });
        machine.step(Event::Begin {
            kind: Kind::Quit,
            window_exists: true,
        });

        let effects = machine.step(Event::Finalized {
            attempt: Attempt {
                id: 1,
                generation: 1,
                kind: Kind::Close,
                sequence: 0,
            },
            ok: false,
        });
        let attempt = Attempt {
            id: 2,
            generation: 1,
            kind: Kind::Quit,
            sequence: 0,
        };
        let token = Token {
            instance_id: "bridge".into(),
            generation: 1,
        };
        assert_eq!(
            (machine.state(), effects),
            (
                &State::Asking {
                    attempt: attempt.clone(),
                    frontend: token.clone(),
                    recreate_pending: false,
                },
                vec![
                    Effect::EmitError("lifecycle finalization failed".into()),
                    Effect::EmitRequest {
                        attempt: attempt.clone(),
                        frontend: token,
                    },
                    Effect::ScheduleTimeout(attempt),
                ],
            )
        );
    }

    #[test]
    fn old_timeout_without_frontend_opens_recovery_dialog() {
        let mut machine = Machine::new(1);
        machine.step(Event::Begin {
            kind: Kind::Close,
            window_exists: true,
        });
        let attempt = Attempt {
            id: 1,
            generation: 1,
            kind: Kind::Close,
            sequence: 0,
        };
        let effects = machine.step(Event::Timeout(attempt.clone()));
        assert_eq!(
            (machine.state(), effects),
            (
                &State::Recovering {
                    attempt: attempt.clone(),
                    recreate_pending: false,
                },
                vec![Effect::ShowRecoveryDialog(attempt)],
            )
        );
    }

    #[test]
    fn old_recovery_dialog_authorizes_one_attempt() {
        let mut machine = Machine::new(1);
        machine.step(Event::Begin {
            kind: Kind::Close,
            window_exists: true,
        });
        let attempt = Attempt {
            id: 1,
            generation: 1,
            kind: Kind::Close,
            sequence: 0,
        };
        machine.step(Event::Timeout(attempt.clone()));
        let effects = machine.step(Event::Recovered {
            attempt: attempt.clone(),
            allow: true,
        });
        #[cfg(target_os = "macos")]
        let expected_effects = vec![Effect::Finalize(attempt.clone())];
        #[cfg(not(target_os = "macos"))]
        let expected_effects = vec![Effect::ArmExitBypass(1), Effect::Finalize(attempt.clone())];
        assert_eq!(
            (machine.state(), effects),
            (
                &State::Finalizing {
                    attempt,
                    queued_quit: false,
                    recreate_pending: false,
                },
                expected_effects,
            )
        );
    }

    #[test]
    fn codex4_recreation_requested_while_asking_starts_after_cancel() {
        let mut machine = Machine::new(1);
        machine.step(Event::FrontendReady {
            instance_id: "bridge".into(),
        });
        machine.step(Event::Begin {
            kind: Kind::Close,
            window_exists: true,
        });
        machine.step(Event::RecreationStarted);

        let effects = machine.step(Event::Decide {
            attempt_id: 1,
            generation: 1,
            sequence: 0,
            decision: Decision::Cancel,
            dirty: false,
            pending: false,
        });
        assert_eq!(
            (machine.state(), effects),
            (
                &State::Recreating {
                    id: RecreationId(1),
                    reserved: 2,
                    queued_quit: false,
                    ready: None,
                },
                vec![Effect::Log("cancelled"), Effect::Recreate(RecreationId(1))],
            )
        );
    }

    #[test]
    fn codex3_ready_before_recreation_finished_is_kept() {
        let mut machine = Machine::new(1);
        machine.step(Event::RecreationStarted);

        let effects = machine.step(Event::FrontendReady {
            instance_id: "rebuilt".into(),
        });
        let token = Token {
            instance_id: "rebuilt".into(),
            generation: 2,
        };
        assert_eq!(
            (machine.state(), effects),
            (
                &State::Recreating {
                    id: RecreationId(1),
                    reserved: 2,
                    queued_quit: false,
                    ready: Some(token.clone()),
                },
                vec![Effect::ReplyToken(token), Effect::Log("ready")],
            )
        );
    }

    #[test]
    fn s2_quit_queued_during_recreation_is_asked_by_new_bridge() {
        let mut machine = Machine::new(1);
        machine.step(Event::RecreationStarted);
        machine.step(Event::Begin {
            kind: Kind::Quit,
            window_exists: true,
        });
        machine.step(Event::FrontendReady {
            instance_id: "rebuilt".into(),
        });

        let effects = machine.step(Event::RecreationFinished {
            id: RecreationId(1),
            ok: true,
        });
        let attempt = Attempt {
            id: 1,
            generation: 2,
            kind: Kind::Quit,
            sequence: 0,
        };
        let token = Token {
            instance_id: "rebuilt".into(),
            generation: 2,
        };
        assert_eq!(
            (machine.state(), effects),
            (
                &State::Asking {
                    attempt: attempt.clone(),
                    frontend: token.clone(),
                    recreate_pending: false,
                },
                vec![
                    Effect::EmitRequest {
                        attempt: attempt.clone(),
                        frontend: token,
                    },
                    Effect::ScheduleTimeout(attempt),
                ],
            )
        );
    }

    #[test]
    fn codex5_finalize_quit_arms_bypass_first() {
        let mut machine = Machine::new(1);
        machine.step(Event::FrontendReady {
            instance_id: "bridge".into(),
        });
        machine.step(Event::Begin {
            kind: Kind::Quit,
            window_exists: true,
        });
        let effects = machine.step(Event::Decide {
            attempt_id: 1,
            generation: 1,
            sequence: 0,
            decision: Decision::Allow,
            dirty: false,
            pending: false,
        });
        let attempt = Attempt {
            id: 1,
            generation: 1,
            kind: Kind::Quit,
            sequence: 0,
        };
        assert_eq!(
            (machine.state(), effects),
            (
                &State::Exiting {
                    attempt: Some(attempt),
                    generation: 1,
                },
                vec![Effect::ArmExitBypass(1), Effect::Exit],
            )
        );
    }

    #[test]
    fn codex8_second_exit_request_while_exiting_is_prevented() {
        let mut machine = Machine::new(1);
        machine.step(Event::Begin {
            kind: Kind::Quit,
            window_exists: false,
        });
        machine.step(Event::ExitRequested);
        let effects = machine.step(Event::ExitRequested);
        assert_eq!(
            (machine.state(), effects),
            (
                &State::Exiting {
                    attempt: None,
                    generation: 1,
                },
                vec![
                    Effect::PreventExit,
                    Effect::Log("unarmed exit request while exiting"),
                ],
            )
        );
    }
}
