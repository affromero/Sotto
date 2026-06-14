//! Onboarding-adjacent flows (P6d): PLACEMENT (assess a CEFR level + create a
//! course), the read-only MEMORY graph, and the read-only SETTINGS/config view.
//!
//! Placement makes the no-course state actionable: pick native+target languages
//! → fetch MC questions → answer (reusing the MC machinery) → submit → assessed
//! level + created course → land in that course. Memory and settings are pure
//! read-only fetch-and-render screens.
//!
//! All P4-P6c patterns hold: the `request_gen` stale-result guard, in-flight
//! submit guard (`submitting`/`loading`), persistent error/retry, and malformed
//! rejection (an empty/zero-option placement batch is rejected, not entered).

use std::sync::Arc;

use crate::action::{Action, ApiResult};
use crate::api::types;

use super::App;
use super::state::{
    ConfigView, LANGUAGES, LangColumn, PlacementOutcome, View, answer_current_choice,
    build_placement_answers, course_title, cursor_down, cursor_up, list_down, list_up,
    memory_items, placement_questions,
};

impl App {
    // --- Placement ---------------------------------------------------------

    /// Open the language picker to start placement (from empty courses / `n`).
    pub(super) fn on_start_placement(&mut self) {
        // A fresh navigation target.
        self.bump_gen();
        self.view = View::placement_lang();
        self.render();
    }

    /// Toggle the focused language column in the picker (Tab).
    pub(super) fn on_toggle_lang_column(&mut self) {
        if let View::PlacementLang { column, .. } = &mut self.view {
            *column = match column {
                LangColumn::Native => LangColumn::Target,
                LangColumn::Target => LangColumn::Native,
            };
            self.render();
        }
    }

    /// Move the focused column's cursor in the language picker.
    pub(super) fn placement_lang_move(&mut self, up: bool) {
        if let View::PlacementLang {
            native_cursor,
            target_cursor,
            column,
            ..
        } = &mut self.view
        {
            let cursor = match column {
                LangColumn::Native => native_cursor,
                LangColumn::Target => target_cursor,
            };
            *cursor = if up {
                list_up(*cursor)
            } else {
                list_down(*cursor, LANGUAGES.len())
            };
            self.render();
        }
    }

    /// Confirm the picked languages and fetch the placement question batch.
    pub(super) fn placement_lang_confirm(&mut self) {
        let (native, target, loading) = match &self.view {
            View::PlacementLang {
                native_cursor,
                target_cursor,
                loading,
                ..
            } => {
                let last = LANGUAGES.len() - 1;
                (
                    LANGUAGES[(*native_cursor).min(last)].0,
                    LANGUAGES[(*target_cursor).min(last)].0,
                    *loading,
                )
            }
            _ => return,
        };
        if loading {
            return; // already fetching
        }
        if native == target {
            self.status_bar
                .set_error("Native and target languages must differ.".to_string());
            self.render();
            return;
        }
        let req_gen = self.bump_gen();
        if let View::PlacementLang { loading, .. } = &mut self.view {
            *loading = true;
        }
        let client = Arc::clone(&self.client);
        let (native, target) = (native.to_string(), target.to_string());
        self.dispatch(
            req_gen,
            async move { client.generate_placement(&native, &target).await },
            Action::PlacementLoaded,
        );
        self.render();
    }

    pub(super) fn on_placement_loaded(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::GeneratePlacementResponse>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        match result.as_ref() {
            Ok(resp) => match placement_questions(resp) {
                Some(questions) => {
                    self.view =
                        View::placement_review(resp.native.clone(), resp.target.clone(), questions);
                }
                None => {
                    self.status_bar
                        .set_error("Placement came back empty. Try again.".to_string());
                    if let View::PlacementLang { loading, .. } = &mut self.view {
                        *loading = false;
                    }
                }
            },
            Err(message) => {
                if let View::PlacementLang { loading, .. } = &mut self.view {
                    *loading = false;
                }
                self.status_bar.set_error(message.clone());
            }
        }
        self.render();
    }

    /// Record a choice for the current placement question and advance, or submit
    /// when it was the last. `choice` is the selected option index.
    pub(super) fn placement_answer(&mut self, choice: usize) {
        let submit = if let View::PlacementReview {
            questions,
            selected,
            index,
            cursor,
            prompt_scroll,
            submitting,
            ..
        } = &mut self.view
        {
            if *submitting {
                return; // in-flight guard
            }
            let last = answer_current_choice(questions.len(), selected, *index, choice);
            if last {
                true
            } else {
                *index += 1;
                *cursor = 0;
                *prompt_scroll = 0;
                false
            }
        } else {
            false
        };
        if submit {
            self.submit_placement();
        }
        self.render();
    }

    /// Move the option cursor for the current placement question.
    pub(super) fn placement_cursor_move(&mut self, up: bool) {
        if let View::PlacementReview {
            questions,
            index,
            cursor,
            ..
        } = &mut self.view
        {
            let count = questions.get(*index).map_or(0, |q| q.options.len());
            *cursor = if up {
                cursor_up(*cursor)
            } else {
                cursor_down(*cursor, count)
            };
            self.render();
        }
    }

    /// Scroll the current placement question's prompt.
    pub(super) fn placement_scroll(&mut self, down: bool) {
        if let View::PlacementReview { prompt_scroll, .. } = &mut self.view {
            *prompt_scroll = if down {
                prompt_scroll.saturating_add(1)
            } else {
                prompt_scroll.saturating_sub(1)
            };
            self.render();
        }
    }

    fn submit_placement(&mut self) {
        let (native, target, answers) = match &self.view {
            View::PlacementReview {
                native,
                target,
                questions,
                selected,
                submitting,
                ..
            } => {
                if *submitting {
                    return;
                }
                match build_placement_answers(questions, selected) {
                    Ok(answers) if !answers.is_empty() => (native.clone(), target.clone(), answers),
                    Ok(_) => {
                        // The route requires at least one answer (`.min(1)`).
                        self.status_bar
                            .set_error("Answer at least one question to submit.".to_string());
                        self.render();
                        return;
                    }
                    Err(message) => {
                        self.status_bar.set_error(message);
                        self.render();
                        return;
                    }
                }
            }
            _ => return,
        };
        let req_gen = self.bump_gen();
        if let View::PlacementReview { submitting, .. } = &mut self.view {
            *submitting = true;
        }
        let client = Arc::clone(&self.client);
        self.dispatch(
            req_gen,
            async move { client.submit_placement(&native, &target, answers).await },
            Action::PlacementSubmitted,
        );
        self.render();
    }

    pub(super) fn on_placement_submitted(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::SubmitPlacementResponse>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        match result.as_ref() {
            Ok(resp) => {
                // Carry the submitted languages into the outcome so the course we
                // land in shows real native/target, not blanks. They live on the
                // PlacementReview view we are still on when the result lands.
                let (native, target) = match &self.view {
                    View::PlacementReview { native, target, .. } => {
                        (native.clone(), target.clone())
                    }
                    _ => (String::new(), String::new()),
                };
                self.view = View::PlacementResult {
                    outcome: PlacementOutcome::from_response(resp, native, target),
                };
            }
            Err(message) => {
                if let View::PlacementReview { submitting, .. } = &mut self.view {
                    *submitting = false;
                }
                self.status_bar.set_error(message.clone());
            }
        }
        self.render();
    }

    /// Dismiss the placement result and land in the created course. The course
    /// carries the real native/target the learner submitted (and the assessed
    /// level), so the course home/list rows show real metadata, not blanks. The
    /// course home refetches due counts.
    pub(super) fn placement_result_continue(&mut self) {
        if let View::PlacementResult { outcome } = &self.view {
            let title = course_title(&outcome.native, &outcome.target);
            let course = super::state::Course {
                id: outcome.course_id.clone(),
                title,
                native_lang: outcome.native.clone(),
                target_lang: outcome.target.clone(),
                current_level: outcome.level.clone(),
            };
            self.enter_course_home(course);
        }
    }

    // --- Memory graph ------------------------------------------------------

    /// Open the read-only memory graph for the current course (`m`).
    pub(super) fn on_open_memory(&mut self) {
        let course = match &self.view {
            View::CourseHome { course, .. } => course.clone(),
            _ => return,
        };
        let req_gen = self.bump_gen();
        let course_id = course.id.clone();
        self.view = View::Memory {
            course,
            items: None,
            scroll: 0,
        };
        let client = Arc::clone(&self.client);
        self.dispatch(
            req_gen,
            async move { client.graph(&course_id).await },
            Action::GraphLoaded,
        );
        self.render();
    }

    pub(super) fn on_graph_loaded(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::MemoryGraphResponse>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        match result.as_ref() {
            Ok(resp) => {
                let built = memory_items(resp);
                if let View::Memory { items, .. } = &mut self.view {
                    *items = Some(built);
                }
            }
            Err(message) => self.status_bar.set_error(message.clone()),
        }
        self.render();
    }

    /// Scroll the memory list.
    pub(super) fn memory_scroll(&mut self, down: bool) {
        if let View::Memory { items, scroll, .. } = &mut self.view {
            let len = items.as_ref().map_or(0, |i| i.len());
            *scroll = if down {
                (*scroll + 1).min(len.saturating_sub(1))
            } else {
                scroll.saturating_sub(1)
            };
            self.render();
        }
    }

    // --- Settings / config -------------------------------------------------

    /// Open the read-only settings/config view (`s`).
    pub(super) fn on_open_settings(&mut self) {
        let req_gen = self.bump_gen();
        self.view = View::Settings { config: None };
        let client = Arc::clone(&self.client);
        self.dispatch(
            req_gen,
            async move { client.onboarding_config().await },
            Action::ConfigLoaded,
        );
        self.render();
    }

    pub(super) fn on_config_loaded(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::OnboardingConfigResponse>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        match result.as_ref() {
            Ok(resp) => {
                if let View::Settings { config } = &mut self.view {
                    *config = Some(ConfigView::from(resp));
                }
            }
            Err(message) => self.status_bar.set_error(message.clone()),
        }
        self.render();
    }
}
