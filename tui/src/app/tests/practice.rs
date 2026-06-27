    #[tokio::test]
    async fn stale_due_result_for_a_previous_course_is_ignored() {
        let mut app = test_app();

        // Learner opens course A (gen bumps), then navigates to course B
        // (gen bumps again) before A's overview lands.
        app.enter_course_home(course("A"));
        let stale_gen = app.request_gen;
        app.enter_course_home(course("B"));

        // A's overview arrives late, tagged with the stale generation. Fed
        // directly into the reducer — no client involved.
        app.on_due_loaded(stale_gen, ok(overview(99.0, 99.0)));

        // It must NOT have written A's counts onto B's CourseHome.
        match &app.view {
            View::CourseHome { course, due, .. } => {
                assert_eq!(course.id, "B");
                assert_eq!(due.vocab, 0, "stale counts must not apply to course B");
            }
            other => panic!("expected CourseHome for B, got {other:?}"),
        }

        // The current generation's result still applies normally.
        let current = app.request_gen;
        app.on_due_loaded(current, ok(overview(5.0, 20.0)));
        match &app.view {
            View::CourseHome { due, .. } => assert_eq!(due.vocab, 5),
            other => panic!("expected CourseHome, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn grammar_start_result_routes_to_the_shared_item_review() {
        let mut app = test_app();
        // On a CourseHome (bumps gen, dispatches due fetch).
        app.enter_course_home(course("A"));
        let req_gen = app.request_gen;

        let resp: ApiResult<types::StartPracticeResponse> =
            Arc::new(Ok(serde_json::from_value(serde_json::json!({
                "status": "ready",
                "sessionId": "sess-gram",
                "kind": "GRAMMAR",
                "items": [
                    { "id": "q0", "prompt": "Pick the verb", "options": ["ser", "casa"] }
                ]
            }))
            .expect("valid grammar ready")));

        app.on_practice_started(req_gen, resp);

        match &app.view {
            View::ItemReview {
                kind,
                session_id,
                items,
                ..
            } => {
                assert_eq!(*kind, state::ReviewKind::Grammar);
                assert_eq!(session_id, "sess-gram");
                assert_eq!(items.len(), 1);
            }
            other => panic!("expected ItemReview after grammar start, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn second_select_while_starting_does_not_dispatch_twice() {
        let mut app = test_app();
        // Sit on a CourseHome that can start a review.
        app.view = View::CourseHome {
            course: course("A"),
            due: DueCounts {
                vocab: 3,
                grammar: 0,
                total_vocab: 9,
            },
            menu_cursor: 0,
            notice: None,
            starting: false,
        };

        let before = app.request_gen;
        app.on_select(); // first start: dispatches, sets starting, bumps gen
        let after_first = app.request_gen;
        assert_eq!(after_first, before + 1, "first start should dispatch once");
        assert!(
            matches!(app.view, View::CourseHome { starting: true, .. }),
            "start should be marked in flight"
        );

        app.on_select(); // key-mash: must be ignored while starting
        assert_eq!(
            app.request_gen, after_first,
            "a second Select while starting must not dispatch again"
        );
    }

    // --- Notes-based placement (P5) ----------------------------------------

    fn deduce_resp(level: &str, confidence: f64) -> ApiResult<types::DeduceFromNotesResponse> {
        Arc::new(Ok(serde_json::from_value(serde_json::json!({
            "native": "en", "target": "es",
            "deducedLevel": level, "rationale": "Uses past tense.", "confidence": confidence
        }))
        .expect("valid deduce JSON")))
    }

    #[test]
    fn materials_path_opens_the_editor_from_the_language_picker() {
        let mut app = test_app();
        app.view = View::placement_lang();
        app.start_notes_placement();
        assert!(matches!(
            app.view,
            View::NotesPlacement {
                phase: NotesPhase::Entry,
                ..
            }
        ));
    }

    #[tokio::test]
    async fn typing_then_submitting_materials_deduces_a_level() {
        let mut app = test_app();
        app.view = View::placement_lang();
        app.start_notes_placement();
        for c in "hola mundo".chars() {
            app.notes_input_char(c);
        }
        match &app.view {
            View::NotesPlacement { input, .. } => assert_eq!(input, "hola mundo"),
            other => panic!("expected NotesPlacement, got {other:?}"),
        }

        // Submit dispatches deduction; deliver the result with the current gen.
        app.notes_submit();
        let req_gen = app.request_gen;
        app.on_notes_deduced(req_gen, deduce_resp("B1", 0.8));

        match &app.view {
            View::NotesPlacement {
                phase:
                    NotesPhase::Result {
                        level, confidence, ..
                    },
                ..
            } => {
                assert_eq!(level, "B1");
                assert_eq!(*confidence, 80);
            }
            other => panic!("expected Result phase, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn starting_here_creates_the_course_and_lands_in_it() {
        let mut app = test_app();
        app.view = View::NotesPlacement {
            native: "en".into(),
            target: "es".into(),
            input: String::new(),
            phase: NotesPhase::Result {
                level: "B1".into(),
                rationale: "r".into(),
                confidence: 80,
            },
        };
        app.notes_confirm();
        let req_gen = app.request_gen;
        let resp: ApiResult<types::ConfirmFromNotesResponse> =
            Arc::new(Ok(serde_json::from_value(serde_json::json!({
                "courseId": "course-9", "level": "B1", "addedVocabulary": 4
            }))
            .expect("valid confirm JSON")));
        app.on_notes_confirmed(req_gen, resp);

        match &app.view {
            View::CourseHome { course, .. } => {
                assert_eq!(course.id, "course-9");
                assert_eq!(course.current_level, "B1");
                assert_eq!(course.native_lang, "en");
                assert_eq!(course.target_lang, "es");
            }
            other => panic!("expected CourseHome, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn manual_placement_opens_picks_a_level_and_lands_in_the_course() {
        let mut app = test_app();
        app.view = View::placement_lang();

        // `l` opens the manual level picker for the chosen pair.
        app.on_manual_open();
        assert!(app.manual.open);

        // ↓↓ selects B1 (A1, A2, B1), then Enter submits.
        app.on_down();
        app.on_down();
        assert_eq!(app.manual.level(), "B1");
        app.on_manual_submit();
        assert!(app.manual.submitting);

        let req_gen = app.request_gen;
        let resp: ApiResult<types::ManualPlacementResponse> =
            Arc::new(Ok(serde_json::from_value(serde_json::json!({
                "courseId": "course-man", "level": "B1"
            }))
            .expect("valid manual JSON")));
        app.on_manual_placed(req_gen, resp);

        assert!(!app.manual.open);
        match &app.view {
            View::CourseHome { course, .. } => {
                assert_eq!(course.id, "course-man");
                assert_eq!(course.current_level, "B1");
                assert_eq!(course.placement_source.as_deref(), Some("MANUAL"));
            }
            other => panic!("expected CourseHome, got {other:?}"),
        }
    }

    #[test]
    fn manual_placement_rejects_identical_languages() {
        let mut app = test_app();
        // Both columns default to the first language, so native == target.
        app.view = View::PlacementLang {
            native_cursor: 0,
            target_cursor: 0,
            column: state::LangColumn::Native,
            loading: false,
        };
        app.on_manual_open();
        assert!(
            !app.manual.open,
            "must not open the picker for identical pair"
        );
    }

    #[tokio::test]
    async fn deleting_a_course_requires_the_matching_code_then_reloads() {
        let mut app = test_app();
        app.enter_course_home(course("c1")); // target_lang "es"
        app.on_delete_open();
        assert!(app.delete.open);
        assert_eq!(app.delete.target_lang, "es");

        // Wrong code: confirm is a no-op (no request dispatched).
        app.on_delete_input('f');
        app.on_delete_input('r');
        assert!(!app.delete.confirmed());
        app.on_delete_confirm();
        assert!(!app.delete.deleting);

        // Correct code: confirm dispatches the delete.
        app.on_delete_backspace();
        app.on_delete_backspace();
        app.on_delete_input('e');
        app.on_delete_input('s');
        assert!(app.delete.confirmed());
        app.on_delete_confirm();
        assert!(app.delete.deleting);

        let req_gen = app.request_gen;
        let resp: ApiResult<types::DeleteCourseResponse> =
            Arc::new(Ok(serde_json::from_value(serde_json::json!({
                "deleted": true, "episodesDeleted": 0,
                "filesAttempted": 0, "filesDeleted": 0, "filesFailed": 0
            }))
            .expect("valid delete JSON")));
        app.on_course_deleted(req_gen, resp);

        // The overlay closes and the course list reloads.
        assert!(!app.delete.open);
        assert!(matches!(app.view, View::Loading));
    }

    #[test]
    fn esc_steps_back_from_result_to_editing_then_to_the_picker() {
        let mut app = test_app();
        app.view = View::NotesPlacement {
            native: "en".into(),
            target: "es".into(),
            input: "notes".into(),
            phase: NotesPhase::Result {
                level: "B1".into(),
                rationale: "r".into(),
                confidence: 80,
            },
        };
        app.notes_cancel();
        assert!(matches!(
            app.view,
            View::NotesPlacement {
                phase: NotesPhase::Entry,
                ..
            }
        ));
        app.notes_cancel();
        assert!(matches!(app.view, View::PlacementLang { .. }));
    }

    #[tokio::test]
    async fn second_select_while_submitting_does_not_dispatch_twice() {
        let mut app = test_app();
        // A single-item review, sitting on its last (only) item so Select submits.
        app.view = View::start_items(
            course("A"),
            super::state::ReviewKind::Vocab,
            "sess-1".into(),
            vec![super::state::VocabItem {
                id: "v1".into(),
                prompt: "casa".into(),
                options: vec!["house".into(), "dog".into()],
            }],
        );

        let before = app.request_gen;
        app.on_select(); // records the answer and submits
        let after_first = app.request_gen;
        assert_eq!(after_first, before + 1, "submit should dispatch once");
        assert!(
            matches!(
                app.view,
                View::ItemReview {
                    submitting: true,
                    ..
                }
            ),
            "submit should be marked in flight"
        );

        app.on_select(); // key-mash: must be ignored while submitting
        assert_eq!(
            app.request_gen, after_first,
            "a second Select while submitting must not dispatch again"
        );
    }

    #[tokio::test]
    async fn courses_load_failure_becomes_a_retryable_error_view() {
        let mut app = test_app();
        let req_gen = app.request_gen; // matches the in-flight initial fetch

        let err: ApiResult<types::CoursesListResponse> = Arc::new(Err("network down".into()));
        app.on_courses_loaded(req_gen, err);

        match &app.view {
            View::Error { message, retry } => {
                assert_eq!(message, "network down");
                assert_eq!(*retry, RetryKind::Courses);
            }
            other => panic!("expected Error view, got {other:?}"),
        }

        // Retrying re-dispatches the fetch and returns to Loading.
        app.on_retry();
        assert!(matches!(app.view, View::Loading));
    }

    // --- P6b: classes (hermetic, no device/network) -----------------------
