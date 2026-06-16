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
use super::overlay::{DeleteOverlay, ManualOverlay};
use super::state::{
    ConfigView, LANGUAGES, LangColumn, NotesPhase, PlacementOutcome, View, answer_current_choice,
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
                placement_source: Some("TEST".to_string()),
            };
            self.enter_course_home(course);
        }
    }

    // --- Notes-based placement ---------------------------------------------

    /// Enter notes-based placement for the languages picked in PlacementLang.
    pub(super) fn start_notes_placement(&mut self) {
        if let View::PlacementLang {
            native_cursor,
            target_cursor,
            loading,
            ..
        } = &self.view
        {
            if *loading {
                return;
            }
            let last = LANGUAGES.len() - 1;
            let native = LANGUAGES[(*native_cursor).min(last)].0.to_string();
            let target = LANGUAGES[(*target_cursor).min(last)].0.to_string();
            if native == target {
                self.status_bar
                    .set_error("Native and target languages must differ.".to_string());
                self.render();
                return;
            }
            self.view = View::NotesPlacement {
                native,
                target,
                input: String::new(),
                phase: NotesPhase::Entry,
            };
            self.render();
        }
    }

    /// Append a typed character to the materials (Entry phase only).
    pub(super) fn notes_input_char(&mut self, c: char) {
        if let View::NotesPlacement {
            input,
            phase: NotesPhase::Entry,
            ..
        } = &mut self.view
        {
            input.push(c);
            self.render();
        }
    }

    /// Insert a newline into the materials (Entry phase only).
    pub(super) fn notes_input_newline(&mut self) {
        if let View::NotesPlacement {
            input,
            phase: NotesPhase::Entry,
            ..
        } = &mut self.view
        {
            input.push('\n');
            self.render();
        }
    }

    /// Delete the last character of the materials (Entry phase only).
    pub(super) fn notes_input_backspace(&mut self) {
        if let View::NotesPlacement {
            input,
            phase: NotesPhase::Entry,
            ..
        } = &mut self.view
        {
            input.pop();
            self.render();
        }
    }

    /// Submit the pasted materials for level deduction.
    pub(super) fn notes_submit(&mut self) {
        let (native, target, content) = match &self.view {
            View::NotesPlacement {
                native,
                target,
                input,
                phase: NotesPhase::Entry,
            } => {
                if input.trim().is_empty() {
                    self.status_bar
                        .set_error("Paste some material first.".to_string());
                    self.render();
                    return;
                }
                (native.clone(), target.clone(), input.trim().to_string())
            }
            _ => return,
        };
        let req_gen = self.bump_gen();
        if let View::NotesPlacement { phase, .. } = &mut self.view {
            *phase = NotesPhase::Deducing;
        }
        let client = Arc::clone(&self.client);
        self.dispatch(
            req_gen,
            async move { client.deduce_from_notes(&native, &target, &content).await },
            Action::NotesDeduced,
        );
        self.render();
    }

    pub(super) fn on_notes_deduced(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::DeduceFromNotesResponse>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        match result.as_ref() {
            Ok(resp) => {
                let confidence = (resp.confidence * 100.0).round().clamp(0.0, 100.0) as u8;
                if let View::NotesPlacement { phase, .. } = &mut self.view {
                    *phase = NotesPhase::Result {
                        level: resp.deduced_level.to_string(),
                        rationale: resp.rationale.clone(),
                        confidence,
                    };
                }
            }
            Err(message) => {
                if let View::NotesPlacement { phase, .. } = &mut self.view {
                    *phase = NotesPhase::Entry;
                }
                self.status_bar.set_error(message.clone());
            }
        }
        self.render();
    }

    /// "Start here": confirm the deduced level and create the course.
    pub(super) fn notes_confirm(&mut self) {
        let (native, target) = match &self.view {
            View::NotesPlacement {
                native,
                target,
                phase: NotesPhase::Result { .. },
                ..
            } => (native.clone(), target.clone()),
            _ => return,
        };
        let req_gen = self.bump_gen();
        if let View::NotesPlacement { phase, .. } = &mut self.view {
            *phase = NotesPhase::Confirming;
        }
        let client = Arc::clone(&self.client);
        self.dispatch(
            req_gen,
            async move { client.confirm_from_notes(&native, &target).await },
            Action::NotesConfirmed,
        );
        self.render();
    }

    pub(super) fn on_notes_confirmed(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::ConfirmFromNotesResponse>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        match result.as_ref() {
            Ok(resp) => {
                let (native, target) = match &self.view {
                    View::NotesPlacement { native, target, .. } => (native.clone(), target.clone()),
                    _ => (String::new(), String::new()),
                };
                let course = super::state::Course {
                    id: resp.course_id.clone(),
                    title: course_title(&native, &target),
                    native_lang: native,
                    target_lang: target,
                    current_level: resp.level.to_string(),
                    placement_source: Some("NOTES".to_string()),
                };
                self.enter_course_home(course);
            }
            Err(message) => {
                // The deduction stays cached server-side; drop to entry so the
                // learner can retry the confirm or take the test instead.
                if let View::NotesPlacement { phase, .. } = &mut self.view {
                    *phase = NotesPhase::Entry;
                }
                self.status_bar.set_error(message.clone());
                self.render();
            }
        }
    }

    /// From the deduced-level result, take the MC test instead. The backend
    /// seeds the cached materials onto the course when this test is submitted.
    pub(super) fn notes_take_test(&mut self) {
        let (native, target) = match &self.view {
            View::NotesPlacement {
                native,
                target,
                phase: NotesPhase::Result { .. },
                ..
            } => (native.clone(), target.clone()),
            _ => return,
        };
        let req_gen = self.bump_gen();
        let client = Arc::clone(&self.client);
        self.dispatch(
            req_gen,
            async move { client.generate_placement(&native, &target).await },
            Action::PlacementLoaded,
        );
        self.render();
    }

    /// Esc in notes placement: from the result, return to editing; from editing,
    /// return to the language picker.
    pub(super) fn notes_cancel(&mut self) {
        match &mut self.view {
            View::NotesPlacement {
                phase: phase @ NotesPhase::Result { .. },
                ..
            } => {
                *phase = NotesPhase::Entry;
                self.render();
            }
            View::NotesPlacement { .. } => {
                self.view = View::placement_lang();
                self.render();
            }
            _ => {}
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

    // --- Manual placement (declare a level yourself) -----------------------

    /// Open the manual level picker for the languages picked in PlacementLang.
    pub(super) fn on_manual_open(&mut self) {
        if let View::PlacementLang {
            native_cursor,
            target_cursor,
            loading,
            ..
        } = &self.view
        {
            if *loading {
                return;
            }
            let last = LANGUAGES.len() - 1;
            let native = LANGUAGES[(*native_cursor).min(last)].0.to_string();
            let target = LANGUAGES[(*target_cursor).min(last)].0.to_string();
            if native == target {
                self.status_bar
                    .set_error("Native and target languages must differ.".to_string());
                self.render();
                return;
            }
            self.manual = ManualOverlay::opened(native, target);
            self.render();
        }
    }

    /// Submit the picked level: create the course or raise to it (MANUAL).
    pub(super) fn on_manual_submit(&mut self) {
        if !self.manual.open || self.manual.submitting {
            return;
        }
        let native = self.manual.native.clone();
        let target = self.manual.target.clone();
        let level = self.manual.level().to_string();
        let req_gen = self.bump_gen();
        self.manual.submitting = true;
        let client = Arc::clone(&self.client);
        self.dispatch(
            req_gen,
            async move { client.manual_placement(&native, &target, &level).await },
            Action::ManualPlaced,
        );
        self.render();
    }

    pub(super) fn on_manual_placed(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::ManualPlacementResponse>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        match result.as_ref() {
            Ok(resp) => {
                let native = self.manual.native.clone();
                let target = self.manual.target.clone();
                let course = super::state::Course {
                    id: resp.course_id.clone(),
                    title: course_title(&native, &target),
                    native_lang: native,
                    target_lang: target,
                    current_level: resp.level.to_string(),
                    placement_source: Some("MANUAL".to_string()),
                };
                self.manual = ManualOverlay::closed();
                self.enter_course_home(course);
            }
            Err(message) => {
                self.manual.submitting = false;
                self.status_bar.set_error(message.clone());
                self.render();
            }
        }
    }

    /// Close the manual level picker without submitting.
    pub(super) fn on_manual_close(&mut self) {
        self.manual = ManualOverlay::closed();
        self.render();
    }

    // --- Course delete (reset / remove) ------------------------------------

    /// Open the delete-confirm overlay for the current course.
    pub(super) fn on_delete_open(&mut self) {
        if let View::CourseHome { course, .. } = &self.view {
            self.delete = DeleteOverlay::opened(
                course.id.clone(),
                course.target_lang.clone(),
                course.title.clone(),
            );
            self.render();
        }
    }

    /// Append a typed character to the delete-confirm input.
    pub(super) fn on_delete_input(&mut self, c: char) {
        if self.delete.open && !self.delete.deleting {
            self.delete.input.push(c);
            self.render();
        }
    }

    /// Delete the last character of the delete-confirm input.
    pub(super) fn on_delete_backspace(&mut self) {
        if self.delete.open && !self.delete.deleting {
            self.delete.input.pop();
            self.render();
        }
    }

    /// Confirm deletion once the typed code matches the target language.
    pub(super) fn on_delete_confirm(&mut self) {
        if !self.delete.open || self.delete.deleting || !self.delete.confirmed() {
            return;
        }
        let course_id = self.delete.course_id.clone();
        let confirm = self.delete.target_lang.clone();
        let req_gen = self.bump_gen();
        self.delete.deleting = true;
        let client = Arc::clone(&self.client);
        self.dispatch(
            req_gen,
            async move { client.delete_course(&course_id, &confirm).await },
            Action::CourseDeleted,
        );
        self.render();
    }

    pub(super) fn on_course_deleted(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::DeleteCourseResponse>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        match result.as_ref() {
            Ok(_) => {
                // The course is gone; close the overlay and reload the list.
                self.delete = DeleteOverlay::closed();
                self.fetch_courses();
            }
            Err(message) => {
                self.delete.deleting = false;
                self.status_bar.set_error(message.clone());
                self.render();
            }
        }
    }

    /// Close the delete-confirm overlay without deleting.
    pub(super) fn on_delete_close(&mut self) {
        self.delete = DeleteOverlay::closed();
        self.render();
    }
}
