//! Adaptive-listening Q&A (P6e): the "ask a question" overlay during a listening
//! lesson. Works in BOTH the standalone [`View::ListeningReview`] and the
//! in-class/in-exam listening section ([`SectionProgress::Listening`]) — both
//! carry an [`AskState`], so this module reaches the active one through the
//! `current_ask_*` accessors and drives a single ask→poll→answer flow.
//!
//! Flow: `a` opens the overlay → type a question → Ctrl-D submits (POST
//! interact) → poll loop (~1.5s, gen-guarded so a stale answer for a previous
//! question/episode is dropped) → ANSWERED shows the answer text; if a future
//! route ever returns answer audio, it plays through the existing rodio player
//! via the UNAUTHENTICATED download client (no key leak). FAILED/timeout shows a
//! retryable error line. The episode play/pause + comprehension items keep
//! working — the overlay is a sub-mode.

use std::sync::Arc;

use crate::action::{Action, ApiResult};
use crate::api::types;

use super::App;
use super::state::{
    AskPhase, AskState, SectionProgress, View, ask_is_terminal, reduce_interaction_poll,
};

impl App {
    // --- Accessors over the active listening context -----------------------

    /// The active listening context's ask state (mutable), whether standalone
    /// or an in-class/in-exam listening section.
    fn current_ask_mut(&mut self) -> Option<&mut AskState> {
        match &mut self.view {
            View::ListeningReview { ask, .. } => Some(ask.as_mut()),
            // In a class/exam, the active section's listening progress.
            View::Class {
                sections: Some(sections),
                cursor,
                ..
            }
            | View::Exam {
                sections: Some(sections),
                cursor,
                ..
            } => match sections.get_mut(*cursor).map(|s| &mut s.progress) {
                Some(SectionProgress::Listening { ask, .. }) => Some(ask.as_mut()),
                _ => None,
            },
            _ => None,
        }
    }

    /// The active listening context's ask state (read-only).
    fn current_ask(&self) -> Option<&AskState> {
        match &self.view {
            View::ListeningReview { ask, .. } => Some(ask.as_ref()),
            _ => match self.current_section().map(|s| &s.progress) {
                Some(SectionProgress::Listening { ask, .. }) => Some(ask.as_ref()),
                _ => None,
            },
        }
    }

    /// The episode id of the active listening context (the interact target).
    fn current_episode_id(&self) -> Option<String> {
        match &self.view {
            View::ListeningReview { episode_id, .. } => Some(episode_id.clone()),
            _ => match self.current_section().map(|s| &s.progress) {
                Some(SectionProgress::Listening { episode_id, .. }) => Some(episode_id.clone()),
                _ => None,
            },
        }
    }

    /// True when the ask overlay is open in the active listening context. Used to
    /// route text input to the question editor.
    pub(super) fn ask_overlay_open(&self) -> bool {
        self.current_ask().is_some_and(|a| a.open)
    }

    /// True when the overlay is open AND editing the question.
    pub(super) fn ask_editing(&self) -> bool {
        matches!(
            self.current_ask().map(|a| (a.open, &a.phase)),
            Some((true, AskPhase::Editing))
        )
    }

    /// True when the ask failed (retryable via `r`).
    pub(super) fn ask_failed(&self) -> bool {
        matches!(
            self.current_ask().map(|a| &a.phase),
            Some(AskPhase::Failed { .. })
        )
    }

    /// True when the overlay is showing the answer (terminal, success).
    pub(super) fn ask_answered(&self) -> bool {
        matches!(
            self.current_ask().map(|a| &a.phase),
            Some(AskPhase::Answered { .. })
        )
    }

    // --- Overlay open/close + text input -----------------------------------

    /// Toggle the ask overlay (`a`). Opening starts a fresh question.
    pub(super) fn on_toggle_ask(&mut self) {
        if let Some(ask) = self.current_ask_mut() {
            if ask.open {
                *ask = AskState::closed();
            } else {
                *ask = AskState::opened();
            }
            self.render();
        }
    }

    pub(super) fn ask_input_char(&mut self, c: char) {
        if let Some(ask) = self.current_ask_mut()
            && matches!(ask.phase, AskPhase::Editing)
        {
            ask.input.push_char(c);
            self.render();
        }
    }

    pub(super) fn ask_input_newline(&mut self) {
        if let Some(ask) = self.current_ask_mut()
            && matches!(ask.phase, AskPhase::Editing)
        {
            ask.input.newline();
            self.render();
        }
    }

    pub(super) fn ask_input_backspace(&mut self) {
        if let Some(ask) = self.current_ask_mut()
            && matches!(ask.phase, AskPhase::Editing)
        {
            ask.input.backspace();
            self.render();
        }
    }

    // --- Ask (POST) --------------------------------------------------------

    /// Submit the typed question (Ctrl-D). Allowed from `Editing` or, as a
    /// retry, from `Failed` (the text is preserved). In-flight (`Asking`/
    /// `Polling`) is ignored so a question is never double-submitted.
    pub(super) fn on_ask_submit(&mut self) {
        let question = match self
            .current_ask()
            .map(|a| (&a.phase, a.input.is_empty(), a.input.text()))
        {
            Some((AskPhase::Editing | AskPhase::Failed { .. }, empty, text)) => {
                if empty {
                    self.status_bar
                        .set_error("Type a question before asking.".to_string());
                    self.render();
                    return;
                }
                text
            }
            _ => return,
        };
        let episode_id = match self.current_episode_id() {
            Some(id) if !id.is_empty() => id,
            _ => {
                self.status_bar
                    .set_error("No episode to ask about yet.".to_string());
                self.render();
                return;
            }
        };
        // The asked-at playback position (we don't track exact playback time, so
        // 0.0 is a valid "from the start" context the route accepts).
        let timestamp = 0.0_f64;
        let req_gen = self.bump_gen();
        if let Some(ask) = self.current_ask_mut() {
            ask.phase = AskPhase::Asking;
        }
        let client = Arc::clone(&self.client);
        let q = question.clone();
        self.dispatch(
            req_gen,
            async move { client.ask_interaction(&episode_id, q, timestamp).await },
            Action::InteractionAsked,
        );
        self.render();
    }

    pub(super) fn on_interaction_asked(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::InteractionResponse>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        match result.as_ref() {
            Ok(resp) => {
                let interaction_id = resp.id.clone();
                if let Some(ask) = self.current_ask_mut() {
                    ask.phase = AskPhase::Polling {
                        interaction_id: interaction_id.clone(),
                    };
                    ask.polls_left = super::state::ASK_MAX_POLLS;
                }
                self.poll_interaction(interaction_id, req_gen);
            }
            Err(message) => {
                if let Some(ask) = self.current_ask_mut() {
                    ask.phase = AskPhase::Failed {
                        message: message.clone(),
                    };
                }
                self.status_bar.set_error(message.clone());
            }
        }
        self.render();
    }

    // --- Poll (GET) --------------------------------------------------------

    /// Dispatch a single interaction poll under `req_gen`.
    fn poll_interaction(&self, interaction_id: String, req_gen: u64) {
        let episode_id = match self.current_episode_id() {
            Some(id) => id,
            None => return,
        };
        let client = Arc::clone(&self.client);
        self.dispatch(
            req_gen,
            async move { client.poll_interaction(&episode_id, &interaction_id).await },
            Action::InteractionPolled,
        );
    }

    /// Re-poll after a short delay, still gen-tagged so a navigation/new ask
    /// invalidates the loop.
    fn schedule_interaction_poll(&self, interaction_id: String, req_gen: u64) {
        let episode_id = match self.current_episode_id() {
            Some(id) => id,
            None => return,
        };
        let client = Arc::clone(&self.client);
        let tx = self.action_tx.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
            let result = client
                .poll_interaction(&episode_id, &interaction_id)
                .await
                .map_err(|e| e.to_string());
            let _ = tx.send(Action::InteractionPolled(req_gen, Arc::new(result)));
        });
    }

    pub(super) fn on_interaction_polled(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::InteractionResponse>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        // The id currently being polled (drops a result for a superseded ask).
        let interaction_id = match self.current_ask().map(|a| &a.phase) {
            Some(AskPhase::Polling { interaction_id }) => interaction_id.clone(),
            _ => return,
        };
        match result.as_ref() {
            Ok(resp) => {
                let next = reduce_interaction_poll(&interaction_id, resp);
                let terminal = ask_is_terminal(&next);
                // Bound the wait: no FAILED status exists server-side, so cap polls.
                let timed_out = if let Some(ask) = self.current_ask_mut() {
                    if !terminal {
                        ask.polls_left = ask.polls_left.saturating_sub(1);
                    }
                    ask.polls_left == 0 && !terminal
                } else {
                    false
                };
                if timed_out {
                    if let Some(ask) = self.current_ask_mut() {
                        ask.phase = AskPhase::Failed {
                            message: "Timed out waiting for an answer.".to_string(),
                        };
                    }
                } else {
                    if let Some(ask) = self.current_ask_mut() {
                        ask.phase = next;
                    }
                    if !terminal {
                        self.schedule_interaction_poll(interaction_id, req_gen);
                    } else {
                        self.maybe_play_answer_audio(req_gen);
                    }
                }
            }
            Err(message) => {
                if let Some(ask) = self.current_ask_mut() {
                    ask.phase = AskPhase::Failed {
                        message: message.clone(),
                    };
                }
                self.status_bar.set_error(message.clone());
            }
        }
        self.render();
    }

    // --- Answer audio (optional, reserved) ---------------------------------

    /// If the answer carries a spoken-clarification URL, download it (via the
    /// unauthenticated client — no key leak) and play it. The current episode-
    /// interact route is text-only, so this is a no-op until that field exists.
    fn maybe_play_answer_audio(&mut self, req_gen: u64) {
        let url = match self.current_ask().map(|a| &a.phase) {
            Some(AskPhase::Answered {
                answer_audio: Some(url),
                ..
            }) => url.clone(),
            _ => return,
        };
        let client = Arc::clone(&self.client);
        self.dispatch(
            req_gen,
            async move { client.download(&url).await },
            Action::AnswerAudioDownloaded,
        );
    }

    pub(super) fn on_answer_audio_downloaded(&mut self, req_gen: u64, result: ApiResult<Vec<u8>>) {
        if !self.is_current(req_gen) {
            return;
        }
        if let Ok(bytes) = result.as_ref() {
            self.play_bytes(bytes.clone());
        }
        self.render();
    }
}
