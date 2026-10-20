use super::*;
use crate::action::LearningMapIntent;
use state::LearningMapState;

const LEVELS: [&str; 6] = ["A1", "A2", "B1", "B2", "C1", "C2"];

impl App {
    pub(super) fn learning_map_key(&self, key: KeyEvent) -> Option<Action> {
        use LearningMapIntent as Intent;
        let View::LearningMap { state, .. } = &self.view else {
            return None;
        };
        if state.searching {
            return match key.code {
                KeyCode::Esc | KeyCode::Enter => Some(Action::LearningMap(Intent::Search)),
                KeyCode::Backspace => Some(Action::LearningMap(Intent::Erase)),
                KeyCode::Char(c) => Some(Action::LearningMap(Intent::Input(c))),
                _ => None,
            };
        }
        let intent = match key.code {
            KeyCode::Up | KeyCode::Char('k') => Intent::Up,
            KeyCode::Down | KeyCode::Char('j') => Intent::Down,
            KeyCode::Enter => Intent::Select,
            KeyCode::Esc | KeyCode::Char('q') => Intent::Back,
            KeyCode::Char(' ') => Intent::Toggle,
            KeyCode::Char('p') => Intent::Preview,
            KeyCode::Char('r') => Intent::Refresh,
            KeyCode::Char('[') => Intent::Level(-1),
            KeyCode::Char(']') => Intent::Level(1),
            KeyCode::Char('c') => Intent::Current,
            KeyCode::Char('v') => Intent::Requirements,
            KeyCode::Char('/') => Intent::Search,
            KeyCode::Char('a') => Intent::Advance,
            KeyCode::PageUp => Intent::Scroll(-5),
            KeyCode::PageDown => Intent::Scroll(5),
            _ => return None,
        };
        Some(Action::LearningMap(intent))
    }

    pub(super) fn learning_map_intent(&mut self, intent: LearningMapIntent) {
        use LearningMapIntent as Intent;
        if matches!(intent, Intent::Open) {
            let View::CourseHome {
                course,
                starting: false,
                ..
            } = &self.view
            else {
                return;
            };
            let course = course.clone();
            self.view = View::LearningMap {
                state: Box::new(LearningMapState::new(course.current_level.clone())),
                course,
            };
            self.load_learning_map(None);
            return;
        }
        match intent {
            Intent::Refresh => {
                self.load_learning_map(None);
                return;
            }
            Intent::Preview => {
                self.preview_learning_map_selection();
                return;
            }
            Intent::Advance => {
                self.advance_learning_map();
                return;
            }
            Intent::Select => {
                if matches!(&self.view, View::LearningMap { state, .. } if state.preview.is_some())
                {
                    self.start_learning_map_selection();
                    return;
                }
            }
            Intent::Level(delta) => {
                let View::LearningMap { state, .. } = &self.view else {
                    return;
                };
                let current = LEVELS
                    .iter()
                    .position(|level| *level == state.level)
                    .unwrap_or(0);
                let maximum = LEVELS.len() - 1;
                let next = (current as i16 + i16::from(delta)).clamp(0, maximum as i16) as usize;
                self.load_learning_map(Some(LEVELS[next].into()));
                return;
            }
            Intent::Current => {
                let View::LearningMap { course, .. } = &self.view else {
                    return;
                };
                self.load_learning_map(Some(course.current_level.clone()));
                return;
            }
            _ => {}
        }
        let View::LearningMap { course, state } = &mut self.view else {
            return;
        };
        match intent {
            Intent::Back => {
                if state.preview.take().is_some()
                    || state.detail.take().is_some()
                    || std::mem::take(&mut state.requirements)
                {
                    state.scroll = 0;
                } else {
                    let course = course.clone();
                    self.enter_course_home(course);
                    return;
                }
            }
            Intent::Up | Intent::Down => {
                let down = matches!(intent, Intent::Down);
                if state.preview.is_some() {
                    state.format_cursor = if down {
                        state
                            .format_cursor
                            .saturating_add(1)
                            .min(state.formats().len().saturating_sub(1))
                    } else {
                        state.format_cursor.saturating_sub(1)
                    };
                } else if state.detail.is_some() || state.requirements {
                    state.scroll = if down {
                        state.scroll.saturating_add(1)
                    } else {
                        state.scroll.saturating_sub(1)
                    };
                } else {
                    state.cursor = if down {
                        state
                            .cursor
                            .saturating_add(1)
                            .min(state.rows().len().saturating_sub(1))
                    } else {
                        state.cursor.saturating_sub(1)
                    };
                }
            }
            Intent::Select => {
                state.detail = state
                    .rows()
                    .get(state.cursor)
                    .and_then(|entry| entry["node"]["id"].as_str())
                    .map(str::to_owned);
                state.scroll = 0;
            }
            Intent::Toggle if !state.loading && !state.is_future() => {
                let id = state.detail.clone().or_else(|| {
                    state
                        .rows()
                        .get(state.cursor)
                        .and_then(|entry| entry["node"]["id"].as_str())
                        .map(str::to_owned)
                });
                if let Some(id) = id {
                    if let Some(index) = state.selected.iter().position(|selected| selected == &id)
                    {
                        state.selected.remove(index);
                    } else if state.selected.len() < 8 {
                        state.selected.push(id);
                    } else {
                        state.error = Some("Choose at most eight nodes for a preview.".into());
                    }
                    state.preview = None;
                }
            }
            Intent::Requirements => {
                state.requirements = !state.requirements;
                state.detail = None;
                state.preview = None;
                state.scroll = 0;
            }
            Intent::Search => {
                state.searching = !state.searching;
                state.detail = None;
                state.preview = None;
            }
            Intent::Input(c) => {
                if state.query.chars().count() < 240 {
                    state.query.push(c);
                }
                state.cursor = 0;
            }
            Intent::Erase => {
                state.query.pop();
                state.cursor = 0;
            }
            Intent::Scroll(delta) => {
                state.scroll = state.scroll.saturating_add_signed(delta);
            }
            _ => {}
        }
        self.render();
    }

    fn load_learning_map(&mut self, level: Option<String>) {
        let View::LearningMap { course, state } = &mut self.view else {
            return;
        };
        if let Some(level) = level {
            state.level = level;
        }
        state.response = None;
        if state.advance_request.is_none() {
            state.advance_confirmation = false;
        }
        state.loading = true;
        state.error = None;
        state.preview = None;
        state.detail = None;
        state.selected.clear();
        state.cursor = 0;
        state.scroll = 0;
        let level = state.level.clone();
        let course_id = course.id.clone();
        let req_gen = self.bump_gen();
        let client = Arc::clone(&self.client);
        self.dispatch(
            req_gen,
            async move { client.learning_map(&course_id, Some(&level)).await },
            Action::LearningMapLoaded,
        );
        self.render();
    }

    pub(super) fn on_learning_map_loaded(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::LearningMapResponse>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        let View::LearningMap { course, state } = &mut self.view else {
            return;
        };
        state.loading = false;
        match result.as_ref().as_ref().map(serde_json::to_value) {
            Ok(Ok(value))
                if value["courseId"] == course.id
                    && value["targetLang"] == course.target_lang
                    && value["viewedLevel"] == state.level =>
            {
                if let Some(level) = value["currentLevel"].as_str() {
                    course.current_level = level.into();
                }
                state.response = Some(value);
                state.error = None;
            }
            Ok(Ok(_)) => {
                state.error =
                    Some("The learning map belongs to a different course, language or band.".into())
            }
            Ok(Err(error)) => state.error = Some(error.to_string()),
            Err(error) => state.error = Some(error.clone()),
        }
        self.render();
    }

    fn preview_learning_map_selection(&mut self) {
        let View::LearningMap { course, state } = &mut self.view else {
            return;
        };
        if state.loading {
            return;
        }
        if state.is_future() {
            state.error = Some("Reach this level to practise its objectives.".into());
            self.render();
            return;
        }
        if state.selected.is_empty() {
            state.error = Some("Select a group or objective with Space first.".into());
            self.render();
            return;
        }
        let selection = match state.selection_request() {
            Ok(value) => value,
            Err(error) => {
                state.error = Some(error);
                self.render();
                return;
            }
        };
        state.loading = true;
        state.error = None;
        state.preview = None;
        let course_id = course.id.clone();
        let client = Arc::clone(&self.client);
        let req_gen = self.bump_gen();
        self.dispatch(
            req_gen,
            async move {
                client
                    .preview_learning_selection(&course_id, selection)
                    .await
            },
            Action::LearningSelectionPreviewed,
        );
        self.render();
    }

    pub(super) fn on_learning_selection_previewed(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::LearningSelectionPreview>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        let View::LearningMap { course, state } = &mut self.view else {
            return;
        };
        state.loading = false;
        match result.as_ref().as_ref().map(serde_json::to_value) {
            Ok(Ok(value))
                if value["selection"]["level"] == state.level
                    && value["selection"]["targetLang"] == course.target_lang
                    && state.response.as_ref().is_some_and(|map| {
                        value["selection"]["catalogHash"] == map["catalogHash"]
                    }) =>
            {
                state.preview = Some(value);
                state.format_cursor = 0;
                state.detail = None;
            }
            Ok(Ok(_)) => {
                state.error = Some(
                    "The selection preview changed its frozen language, band or catalog.".into(),
                )
            }
            Ok(Err(error)) => state.error = Some(error.to_string()),
            Err(error) => state.error = Some(error.clone()),
        }
        self.render();
    }

    fn start_learning_map_selection(&mut self) {
        let View::LearningMap { course, state } = &mut self.view else {
            return;
        };
        if state.loading {
            return;
        }
        let Some(kind) = state.formats().get(state.format_cursor).cloned() else {
            return;
        };
        let selected = state.resolved_request().and_then(|selection| {
            let kind: types::PracticeKind = serde_json::from_value(serde_json::Value::String(kind))
                .map_err(|error| error.to_string())?;
            let skill = SkillChoice::MENU
                .into_iter()
                .find(|skill| skill.kind() == kind)
                .ok_or("This server format is unavailable in the terminal.")?;
            Ok((selection, skill))
        });
        match selected {
            Ok((selection, skill)) => {
                let course = course.clone();
                self.start_focused_skill(course, skill, Some(selection));
            }
            Err(error) => {
                state.error = Some(error);
                self.render();
            }
        }
    }

    fn advance_learning_map(&mut self) {
        let View::LearningMap { course, state } = &mut self.view else {
            return;
        };
        if state.loading {
            return;
        }
        if state.advance_request.is_none() {
            let Some(map) = state.response.as_ref() else {
                return;
            };
            if state.level != course.current_level
                || map["readiness"]["ready"] != true
                || !map["blockers"].as_array().is_some_and(Vec::is_empty)
            {
                state.error = Some("The server has not cleared the current band for advancement. Review its requirements and blockers.".into());
                self.render();
                return;
            }
            if !state.advance_confirmation {
                state.advance_confirmation = true;
                self.render();
                return;
            }
            state.advance_request = Some(
                serde_json::json!({ "requestId": uuid::Uuid::new_v4(), "expectedLevel": map["currentLevel"], "catalogHash": map["catalogHash"] }),
            );
        }
        let request = match serde_json::from_value::<types::AdvanceLearningLevelRequest>(
            state.advance_request.clone().unwrap_or_default(),
        ) {
            Ok(value) => value,
            Err(error) => {
                state.error = Some(error.to_string());
                self.render();
                return;
            }
        };
        state.loading = true;
        state.error = None;
        let course_id = course.id.clone();
        let client = Arc::clone(&self.client);
        let req_gen = self.bump_gen();
        self.dispatch(
            req_gen,
            async move { client.advance_learning_level(&course_id, request).await },
            Action::LearningLevelAdvanced,
        );
        self.render();
    }

    pub(super) fn on_learning_level_advanced(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::LearningLevelCompletion>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        let View::LearningMap { course, state } = &mut self.view else {
            return;
        };
        state.loading = false;
        match result.as_ref().as_ref().map(serde_json::to_value) {
            Ok(Ok(value))
                if value["courseId"] == course.id
                    && state
                        .advance_request
                        .as_ref()
                        .is_some_and(|request| request["expectedLevel"] == value["level"]) =>
            {
                let Some(level) = value["currentLevel"].as_str().map(str::to_owned) else {
                    return;
                };
                course.current_level = level.clone();
                state.advance_request = None;
                state.advance_confirmation = false;
                self.load_learning_map(Some(level));
                return;
            }
            Ok(Ok(_)) => {
                state.error =
                    Some("The completion receipt belongs to a different transition.".into())
            }
            Ok(Err(error)) => state.error = Some(error.to_string()),
            Err(error) => state.error = Some(error.clone()),
        }
        self.render();
    }
}
