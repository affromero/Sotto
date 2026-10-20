use crate::action::LearningMapIntent as MapIntent;
use crate::api::learning_map_fixtures::{
    completion as completion_fixture, map as map_fixture, preview as preview_fixture,
};

fn map_app(ready: bool) -> App {
    let mut app = test_app();
    let course = course("map-course");
    let mut state = state::LearningMapState::new("A2".into());
    state.loading = false;
    state.response = Some(map_fixture(&course.id, "A2", "A2", ready));
    app.view = View::LearningMap {
        course,
        state: Box::new(state),
    };
    app
}

#[tokio::test]
async fn map_navigation_discards_old_course_and_band_responses() {
    let mut app = map_app(false);
    app.learning_map_intent(MapIntent::Level(-1));
    let stale = app.request_gen;
    app.learning_map_intent(MapIntent::Current);
    app.on_learning_map_loaded(
        stale,
        ok(serde_json::from_value(map_fixture("map-course", "A1", "A2", false)).unwrap()),
    );
    assert!(
        matches!(&app.view, View::LearningMap { state, .. } if state.level == "A2" && state.response.is_none())
    );
    let current = app.request_gen;
    app.enter_course_home(course("another-course"));
    app.on_learning_map_loaded(
        current,
        ok(serde_json::from_value(map_fixture("map-course", "A2", "A2", false)).unwrap()),
    );
    assert!(matches!(&app.view, View::CourseHome { course, .. } if course.id == "another-course"));
}

#[test]
fn map_search_detail_and_requirements_keep_unassessed_status_visible() {
    let mut app = map_app(false);
    app.learning_map_intent(MapIntent::Search);
    for c in "he llegado".chars() {
        app.learning_map_intent(MapIntent::Input(c));
    }
    if let View::LearningMap { state, .. } = &app.view {
        assert_eq!(state.rows().len(), 1);
        assert_eq!(state.rows()[0]["progress"]["status"], "NOT_ASSESSED");
    } else {
        panic!("map expected");
    }
    assert!(matches!(
        app.map_key(key(KeyCode::Char('t'))),
        Some(Action::LearningMap(MapIntent::Input('t')))
    ));
    app.learning_map_intent(MapIntent::Search);
    app.learning_map_intent(MapIntent::Select);
    let screen = map_screen(&mut app, 100, 28);
    assert!(screen.contains("Choose or construct the perfect form."));
    assert!(screen.contains("NOT_ASSESSED"));
    app.learning_map_intent(MapIntent::Requirements);
    let screen = map_screen(&mut app, 100, 28);
    assert!(screen.contains("Server readiness: Not ready"));
    assert!(screen.contains("unassessed"));
    assert!(screen.contains("Missing required objectives"));
    assert!(screen.contains("Source exposure never grants mastery"));
    for (width, height) in [(40, 10), (40, 15), (20, 6)] {
        render_at(&mut app, width, height);
    }
}

#[tokio::test]
async fn future_band_browsing_stays_read_only_without_changing_the_course_level() {
    let mut app = map_app(false);
    app.learning_map_intent(MapIntent::Level(1));
    app.on_learning_map_loaded(
        app.request_gen,
        ok(serde_json::from_value(map_fixture("map-course", "B1", "A2", false)).unwrap()),
    );
    app.learning_map_intent(MapIntent::Toggle);
    app.learning_map_intent(MapIntent::Preview);
    assert!(
        matches!(&app.view, View::LearningMap { course, state } if course.current_level == "A2" && state.level == "B1" && state.selected.is_empty() && state.error.as_deref() == Some("Reach this level to practise its objectives."))
    );
    assert!(app.pending_admissions.is_empty());
    assert!(map_screen(&mut app, 100, 20).contains("Future-band preview"));
}

#[tokio::test]
async fn lower_band_preview_freezes_group_leaves_and_only_server_formats() {
    let mut app = map_app(false);
    app.learning_map_intent(MapIntent::Level(-1));
    app.on_learning_map_loaded(
        app.request_gen,
        ok(serde_json::from_value(map_fixture("map-course", "A1", "A2", false)).unwrap()),
    );
    app.learning_map_intent(MapIntent::Toggle);
    app.learning_map_intent(MapIntent::Preview);
    app.on_learning_selection_previewed(
        app.request_gen,
        ok(serde_json::from_value(preview_fixture("A1")).unwrap()),
    );
    if let View::LearningMap { course, state } = &app.view {
        assert_eq!(course.current_level, "A2");
        assert_eq!(state.formats(), vec!["GRAMMAR"]);
        let selection = serde_json::to_value(state.resolved_request().unwrap()).unwrap();
        assert_eq!(selection["level"], "A1");
        assert_eq!(selection["nodeIds"], serde_json::json!(["es.g.perfect"]));
    } else {
        panic!("map expected");
    }
    app.learning_map_intent(MapIntent::Select);
    let request_id = match &app.view {
        View::PracticePreparing {
            request_id, course, ..
        } => {
            assert_eq!(course.current_level, "A2");
            *request_id
        }
        _ => panic!("preparing expected"),
    };
    let frozen = serde_json::to_value(app.pending_selections.get(&request_id).unwrap()).unwrap();
    let initial = loop {
        if let Some(Action::PracticeStarted(req_gen, result)) = app.action_rx.recv().await {
            break (req_gen, result);
        }
    };
    app.on_practice_started(initial.0, initial.1);
    app.practice_check_status(true);
    let action = loop {
        if let Some(Action::PracticeStarted(_, result)) = app.action_rx.recv().await {
            break result;
        }
    };
    assert!(
        action
            .as_ref()
            .as_ref()
            .unwrap_err()
            .contains("Selected admission acknowledgement lost")
    );
    assert_eq!(
        serde_json::to_value(app.pending_selections.get(&request_id).unwrap()).unwrap(),
        frozen
    );
}

#[tokio::test]
async fn preview_from_another_catalog_never_enables_admission() {
    let mut app = map_app(false);
    app.learning_map_intent(MapIntent::Toggle);
    app.learning_map_intent(MapIntent::Preview);
    let mut preview = preview_fixture("A2");
    preview["selection"]["catalogHash"] = serde_json::json!("b".repeat(64));
    app.on_learning_selection_previewed(
        app.request_gen,
        ok(serde_json::from_value(preview).unwrap()),
    );
    assert!(
        matches!(&app.view, View::LearningMap { state, .. } if state.preview.is_none() && state.error.is_some())
    );
    assert!(app.pending_admissions.is_empty());
}

#[tokio::test]
async fn advancement_uses_server_clearance_and_replays_the_same_confirmed_request() {
    let mut blocked = map_app(false);
    blocked.learning_map_intent(MapIntent::Advance);
    assert!(
        matches!(&blocked.view, View::LearningMap { state, .. } if state.advance_request.is_none() && !state.loading)
    );
    let mut app = map_app(true);
    app.learning_map_intent(MapIntent::Advance);
    assert!(
        matches!(&app.view, View::LearningMap { state, .. } if state.advance_confirmation && state.advance_request.is_none())
    );
    app.learning_map_intent(MapIntent::Advance);
    let body = match &app.view {
        View::LearningMap { state, .. } => state.advance_request.clone().unwrap(),
        _ => panic!("map expected"),
    };
    app.learning_map_intent(MapIntent::Advance);
    app.on_learning_level_advanced(
        app.request_gen,
        Arc::new(Err("Lost committed acknowledgement".into())),
    );
    app.learning_map_intent(MapIntent::Advance);
    assert!(
        matches!(&app.view, View::LearningMap { state, .. } if state.advance_request.as_ref() == Some(&body))
    );
    app.on_learning_level_advanced(
        app.request_gen,
        ok(serde_json::from_value(completion_fixture("map-course", "A2")).unwrap()),
    );
    assert!(
        matches!(&app.view, View::LearningMap { course, state } if course.current_level == "B1" && state.level == "B1" && state.advance_request.is_none())
    );
}

fn map_screen(app: &mut App, width: u16, height: u16) -> String {
    let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
    terminal
        .draw(|frame| {
            app.draw(frame).unwrap();
        })
        .unwrap();
    terminal
        .backend()
        .buffer()
        .content()
        .iter()
        .map(|cell| cell.symbol())
        .collect()
}
