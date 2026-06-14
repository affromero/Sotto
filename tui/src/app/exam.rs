//! The mock-exam flow (P6c): `Exam` view orchestration.
//!
//! Exams are structurally like classes, so they REUSE the section-walk
//! machinery in [`super::class`]: the same `SectionProgress` states, input
//! handlers (cursor/scroll/answer/writing), audio/speaking/writing dispatch
//! (parameterized by `FlowKind`), and result reducers for episode/audio/
//! speaking/writing. Only the start/load/submit endpoints and the final
//! band/score result differ, which is what this module adds.
//!
//! Flow: course screen → `start-exam` (mints id) → `get exam` (sections) →
//! walk sections → `submit exam` → band/score `ExamOutcome`. Exams never
//! advance the course level.

use std::sync::Arc;

use crate::action::{Action, ApiResult};
use crate::api::types;

use super::App;
use super::state::{Course, ExamResult, View, exam_sections};

impl App {
    /// Start the mock-exam flow for the current course: enter the `Exam` view
    /// (id/sections load next) and dispatch `start-exam`, which mints the id.
    pub(super) fn on_start_exam(&mut self) {
        let course = match &self.view {
            View::CourseHome { course, .. } => course.clone(),
            _ => return,
        };
        let req_gen = self.bump_gen();
        self.stop_audio();
        self.view = View::exam_view(course.clone());
        // Carry the course so a load failure can route back to the course home.
        self.pending_course = Some(course.clone());
        let client = Arc::clone(&self.client);
        let course_id = course.id.clone();
        // Start at the course's current level (the route defaults it when absent).
        self.dispatch(
            req_gen,
            async move { client.start_exam(&course_id, None).await },
            Action::ExamStarted,
        );
        self.render();
    }

    pub(super) fn on_exam_started(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::StartExamResponse>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        let course = match self.pending_course.take() {
            Some(c) => c,
            None => return,
        };
        match result.as_ref() {
            Ok(resp) => {
                let exam_id = resp.exam_id.clone();
                // Record the id on the Exam view, then fetch the exam detail.
                if let View::Exam { exam_id: slot, .. } = &mut self.view {
                    *slot = Some(exam_id.clone());
                }
                let fetch_gen = self.bump_gen();
                let client = Arc::clone(&self.client);
                self.dispatch(
                    fetch_gen,
                    async move { client.exam(&exam_id).await },
                    Action::ExamLoaded,
                );
            }
            Err(message) => {
                self.status_bar.set_error(message.clone());
                self.enter_course_home(course);
            }
        }
        self.render();
    }

    pub(super) fn on_exam_loaded(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::ExamDetailResponse>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        match result.as_ref() {
            Ok(resp) => match exam_sections(resp) {
                Some(built) => {
                    if let View::Exam { sections, .. } = &mut self.view {
                        *sections = Some(built);
                    }
                    // If the first section is listening, kick off its episode.
                    self.class_fetch_current_episode();
                }
                None => {
                    self.status_bar
                        .set_error("This exam came back empty or malformed.".to_string());
                    if let Some(course) = self.exam_course() {
                        self.enter_course_home(course);
                    }
                }
            },
            Err(message) => self.status_bar.set_error(message.clone()),
        }
        self.render();
    }

    pub(super) fn on_exam_submitted(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::SubmitExamResponse>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        match result.as_ref() {
            Ok(resp) => {
                if let View::Exam { course, .. } = &self.view {
                    let course = course.clone();
                    self.stop_audio();
                    self.view = View::ExamOutcome {
                        course,
                        result: ExamResult::from(resp),
                    };
                }
            }
            Err(message) => {
                if let View::Exam { submitting, .. } = &mut self.view {
                    *submitting = false;
                }
                self.status_bar.set_error(message.clone());
            }
        }
        self.render();
    }

    fn exam_course(&self) -> Option<Course> {
        if let View::Exam { course, .. } = &self.view {
            Some(course.clone())
        } else {
            None
        }
    }
}
