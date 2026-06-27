    #[tokio::test]
    async fn memory_opens_and_renders_the_graph() {
        let mut app = test_app();
        app.enter_course_home(course("A"));
        app.on_open_memory();
        assert!(matches!(app.view, View::Memory { items: None, .. }));

        let req_gen = app.request_gen;
        let graph: ApiResult<types::MemoryGraphResponse> = Arc::new(Ok(serde_json::from_value(
            serde_json::json!({
                "nodes": [
                    { "id": "v0", "kind": "vocab", "label": "casa", "translation": "house", "strength": 0.6, "due": true }
                ],
                "edges": []
            }),
        )
        .expect("valid")));
        app.on_graph_loaded(req_gen, graph);
        match &app.view {
            View::Memory {
                items: Some(items), ..
            } => {
                assert_eq!(items.len(), 1);
                assert_eq!(items[0].label, "casa");
                assert_eq!(items[0].mastery, 60);
                assert!(items[0].due);
            }
            other => panic!("expected loaded Memory, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn settings_opens_and_renders_config() {
        let mut app = test_app();
        app.enter_course_home(course("A"));
        app.on_open_settings();
        assert!(matches!(app.view, View::Settings { config: None }));

        let req_gen = app.request_gen;
        let config: ApiResult<types::OnboardingConfigResponse> =
            Arc::new(Ok(serde_json::from_value(serde_json::json!({
                "selfHosted": true, "isOwner": false, "infra": null
            }))
            .expect("valid")));
        app.on_config_loaded(req_gen, config);
        match &app.view {
            View::Settings { config: Some(c) } => {
                assert!(c.self_hosted);
                assert!(!c.is_owner);
                assert!(c.infra.is_none());
            }
            other => panic!("expected loaded Settings, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn stale_graph_result_for_a_previous_course_is_ignored() {
        let mut app = test_app();
        app.enter_course_home(course("A"));
        app.on_open_memory();
        let stale_gen = app.request_gen;
        app.enter_course_home(course("B")); // navigate away (bumps gen)

        let graph: ApiResult<types::MemoryGraphResponse> = Arc::new(Ok(serde_json::from_value(
            serde_json::json!({ "nodes": [{ "id": "x", "kind": "vocab", "label": "stale", "strength": 1.0, "due": false }], "edges": [] }),
        )
        .expect("valid")));
        app.on_graph_loaded(stale_gen, graph);

        // The stale graph must not render onto course B's home.
        assert!(matches!(app.view, View::CourseHome { .. }));
    }

    // --- P6e: adaptive-listening Q&A ---------------------------------------

    /// A standalone listening session with one comprehension item, ready to ask.
    fn listening_app() -> App {
        let mut app = test_app();
        app.view = View::start_listening(
            course("L"),
            "sess-listen".into(),
            "ep-42".into(),
            vec![state::VocabItem {
                id: "v1".into(),
                prompt: "casa".into(),
                options: vec!["house".into(), "dog".into()],
            }],
        );
        app
    }

    fn interaction(json: serde_json::Value) -> ApiResult<types::InteractionResponse> {
        Arc::new(Ok(
            serde_json::from_value(json).expect("valid InteractionResponse JSON")
        ))
    }

    /// Open the overlay and type a question, character by character (the same
    /// path real key events take).
    fn type_question(app: &mut App, q: &str) {
        app.on_toggle_ask();
        for c in q.chars() {
            if c == '\n' {
                app.ask_input_newline();
            } else {
                app.ask_input_char(c);
            }
        }
    }

    fn current_ask_phase(app: &App) -> state::AskPhase {
        match &app.view {
            View::ListeningReview { ask, .. } => ask.phase.clone(),
            other => panic!("expected ListeningReview, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn ask_overlay_captures_the_typed_question() {
        let mut app = listening_app();
        assert!(!app.ask_overlay_open(), "overlay starts closed");

        type_question(&mut app, "what does casa mean?");
        assert!(app.ask_overlay_open(), "`a` opens the overlay");
        match &app.view {
            View::ListeningReview { ask, .. } => {
                assert!(ask.open);
                assert_eq!(ask.input.text(), "what does casa mean?");
                assert_eq!(ask.phase, state::AskPhase::Editing);
            }
            other => panic!("expected ListeningReview, got {other:?}"),
        }

        // Toggling again closes it and discards the draft.
        app.on_toggle_ask();
        assert!(!app.ask_overlay_open());
    }

    #[tokio::test]
    async fn ask_pending_then_answered_shows_the_answer_text() {
        let mut app = listening_app();
        type_question(&mut app, "what does casa mean?");

        // Submit -> dispatch (gen bumps), phase goes Asking.
        let ask_gen = {
            let before = app.request_gen;
            app.on_ask_submit();
            assert_eq!(app.request_gen, before + 1, "asking dispatches once");
            app.request_gen
        };
        assert_eq!(current_ask_phase(&app), state::AskPhase::Asking);

        // The POST returns a PENDING interaction -> we start polling it.
        app.on_interaction_asked(
            ask_gen,
            interaction(serde_json::json!({
                "id": "int-7", "question": "what does casa mean?", "timestamp": 0,
                "status": "PENDING", "answer": null, "helpful": null, "segmentOrder": null
            })),
        );
        assert_eq!(
            current_ask_phase(&app),
            state::AskPhase::Polling {
                interaction_id: "int-7".into()
            }
        );

        // A poll still PENDING keeps polling and burns a budget tick.
        let polls_before = match &app.view {
            View::ListeningReview { ask, .. } => ask.polls_left,
            _ => unreachable!(),
        };
        app.on_interaction_polled(
            ask_gen,
            interaction(serde_json::json!({
                "id": "int-7", "question": "?", "timestamp": 0,
                "status": "ANSWERING", "answer": null, "helpful": null, "segmentOrder": null
            })),
        );
        match &app.view {
            View::ListeningReview { ask, .. } => {
                assert!(matches!(ask.phase, state::AskPhase::Polling { .. }));
                assert_eq!(
                    ask.polls_left,
                    polls_before - 1,
                    "a non-terminal poll ticks"
                );
            }
            _ => unreachable!(),
        }

        // The answer lands -> Answered with the text (route is text-only).
        app.on_interaction_polled(
            ask_gen,
            interaction(serde_json::json!({
                "id": "int-7", "question": "?", "timestamp": 0,
                "status": "ANSWERED", "answer": "It means house.", "helpful": true, "segmentOrder": 1
            })),
        );
        match current_ask_phase(&app) {
            state::AskPhase::Answered {
                answer,
                answer_audio,
            } => {
                assert_eq!(answer, "It means house.");
                assert!(
                    answer_audio.is_none(),
                    "the interact route returns no audio"
                );
            }
            other => panic!("expected Answered, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn ask_failure_is_retryable() {
        let mut app = listening_app();
        type_question(&mut app, "?");
        app.on_ask_submit();
        let ask_gen = app.request_gen;

        // The POST itself fails.
        app.on_interaction_asked(ask_gen, Arc::new(Err("network down".into())));
        match current_ask_phase(&app) {
            state::AskPhase::Failed { message } => assert!(message.contains("network down")),
            other => panic!("expected Failed, got {other:?}"),
        }
        assert!(app.ask_failed(), "a failed ask is flagged for retry");

        // Re-submitting from Failed preserves the question and dispatches again.
        let before = app.request_gen;
        app.on_ask_submit();
        assert_eq!(app.request_gen, before + 1, "retry re-asks");
        assert_eq!(current_ask_phase(&app), state::AskPhase::Asking);
    }

    #[tokio::test]
    async fn second_ask_while_in_flight_does_not_dispatch_twice() {
        let mut app = listening_app();
        type_question(&mut app, "?");
        app.on_ask_submit();
        let gen_after_first = app.request_gen;
        assert_eq!(current_ask_phase(&app), state::AskPhase::Asking);

        // A second submit while still Asking/Polling is ignored.
        app.on_ask_submit();
        assert_eq!(
            app.request_gen, gen_after_first,
            "an in-flight ask must not dispatch a second request"
        );
    }

    #[tokio::test]
    async fn stale_answer_for_a_superseded_ask_is_dropped() {
        let mut app = listening_app();
        type_question(&mut app, "first question?");
        app.on_ask_submit();
        let stale_gen = app.request_gen;
        app.on_interaction_asked(
            stale_gen,
            interaction(serde_json::json!({
                "id": "int-A", "question": "first question?", "timestamp": 0,
                "status": "PENDING", "answer": null, "helpful": null, "segmentOrder": null
            })),
        );

        // The learner navigates away (bumps the generation) before the answer
        // for the first question lands.
        app.enter_course_home(course("Z"));

        // The late answer, tagged with the stale generation, must be dropped.
        app.on_interaction_polled(
            stale_gen,
            interaction(serde_json::json!({
                "id": "int-A", "question": "?", "timestamp": 0,
                "status": "ANSWERED", "answer": "stale answer", "helpful": true, "segmentOrder": 1
            })),
        );
        assert!(
            matches!(app.view, View::CourseHome { .. }),
            "a stale answer must not resurrect the ask overlay"
        );
    }

    #[tokio::test]
    async fn cancelling_the_ask_overlay_drops_in_flight_results_and_stops_polling() {
        let mut app = listening_app();
        type_question(&mut app, "what does casa mean?");
        app.on_ask_submit(); // -> Asking, dispatched under `asked_gen`
        let asked_gen = app.request_gen;

        // The learner presses Esc / `a` to close the overlay while the ask is in
        // flight. Cancel must invalidate the in-flight generation.
        app.on_toggle_ask();
        assert!(!app.ask_overlay_open(), "overlay is closed by cancel");
        assert!(
            app.request_gen > asked_gen,
            "cancel bumps the generation to invalidate in-flight work"
        );
        let gen_after_cancel = app.request_gen;

        // A late InteractionAsked for the cancelled ask (old gen) must be dropped:
        // no phase change, no reschedule (no further gen bump).
        app.on_interaction_asked(
            asked_gen,
            interaction(serde_json::json!({
                "id": "int-X", "question": "?", "timestamp": 0,
                "status": "PENDING", "answer": null, "helpful": null, "segmentOrder": null
            })),
        );
        // And a late InteractionPolled (old gen) is likewise dropped.
        app.on_interaction_polled(
            asked_gen,
            interaction(serde_json::json!({
                "id": "int-X", "question": "?", "timestamp": 0,
                "status": "ANSWERED", "answer": "late answer", "helpful": true, "segmentOrder": 1
            })),
        );

        // The overlay stayed closed (Editing/closed), never showed an answer or
        // error, and nothing re-bumped the generation (no poll was scheduled).
        match &app.view {
            View::ListeningReview { ask, .. } => {
                assert!(!ask.open, "the cancelled overlay must stay closed");
                assert_eq!(
                    ask.phase,
                    state::AskPhase::Editing,
                    "a dropped result must not move the phase to Answered/Failed",
                );
            }
            other => panic!("expected ListeningReview, got {other:?}"),
        }
        assert_eq!(
            app.request_gen, gen_after_cancel,
            "a dropped result must not reschedule a poll (no further gen bump)",
        );
    }
