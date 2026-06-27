    fn exam_detail(json: serde_json::Value) -> ApiResult<types::ExamDetailResponse> {
        Arc::new(Ok(serde_json::from_value(json).expect("valid exam JSON")))
    }

    /// Build an `Exam` view whose sections are loaded from `sections` JSON.
    fn exam_with_sections(sections: serde_json::Value) -> View {
        let exam: types::ExamDetailResponse = serde_json::from_value(serde_json::json!({
            "id": "exam1", "institution": "CEFR_GENERIC", "institutionLabel": "CEFR",
            "level": "B1", "status": "IN_PROGRESS", "examName": "Mock", "result": null,
            "sections": sections
        }))
        .expect("valid exam");
        let built = state::exam_sections(&exam).expect("well-formed sections");
        View::Exam {
            course: course("A"),
            exam_id: Some("exam1".into()),
            sections: Some(built),
            cursor: 0,
            submitting: false,
        }
    }

    #[tokio::test]
    async fn exam_start_enters_the_exam_and_loads_sections() {
        let mut app = test_app();
        app.enter_course_home(course("A"));
        app.on_start_exam();

        // Entered the Exam view (id/sections load next).
        assert!(
            matches!(
                app.view,
                View::Exam {
                    exam_id: None,
                    sections: None,
                    ..
                }
            ),
            "on_start_exam enters the Exam view"
        );

        // The start response mints an id and triggers the exam load.
        let started_gen = app.request_gen;
        let resp: ApiResult<types::StartExamResponse> = Arc::new(Ok(serde_json::from_value(
            serde_json::json!({ "examId": "exam1" }),
        )
        .expect("valid")));
        app.on_exam_started(started_gen, resp);
        match &app.view {
            View::Exam {
                exam_id, sections, ..
            } => {
                assert_eq!(exam_id.as_deref(), Some("exam1"));
                assert!(sections.is_none(), "sections load separately");
            }
            other => panic!("expected Exam, got {other:?}"),
        }

        // The exam detail lands; sections populate, in order.
        let load_gen = app.request_gen;
        app.on_exam_loaded(
            load_gen,
            exam_detail(serde_json::json!({
                "id": "exam1", "institution": "CEFR_GENERIC", "institutionLabel": "CEFR",
                "level": "B1", "status": "IN_PROGRESS", "examName": "Mock", "result": null,
                "sections": [
                    { "id": "ex-g", "skill": "GRAMMAR", "part": "P1", "order": 0, "format": "mc", "weight": 1.0, "status": "READY", "score": null,
                      "episode": null, "speakingPrompts": [], "writingPrompts": [],
                      "questions": [{ "id": "g0", "order": 0, "question": "?", "options": ["a","b"], "passageRef": null, "passageText": null }] }
                ]
            })),
        );
        match &app.view {
            View::Exam {
                sections: Some(sections),
                ..
            } => assert_eq!(sections.len(), 1),
            other => panic!("expected loaded Exam, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn answering_the_last_exam_question_submits_and_shows_the_band() {
        let mut app = test_app();
        app.view = exam_with_sections(serde_json::json!([
            { "id": "ex-g", "skill": "GRAMMAR", "part": "P1", "order": 0, "format": "mc", "weight": 1.0, "status": "READY", "score": null,
              "episode": null, "speakingPrompts": [], "writingPrompts": [],
              "questions": [{ "id": "g0", "order": 0, "question": "?", "options": ["a","b"], "passageRef": null, "passageText": null }] }
        ]));

        let before = app.request_gen;
        app.on_select(); // answers the only question -> submits the exam
        let after = app.request_gen;
        assert_eq!(after, before + 1, "submit dispatches once");
        assert!(matches!(
            app.view,
            View::Exam {
                submitting: true,
                ..
            }
        ));

        // The score result lands -> band/score outcome.
        let resp: ApiResult<types::SubmitExamResponse> = Arc::new(Ok(serde_json::from_value(
            serde_json::json!({
                "overallScore": 0.9, "band": "C1", "feedback": "Strong.",
                "sections": [{ "sectionId": "ex-g", "skill": "GRAMMAR", "weight": 1.0, "score": 0.9 }]
            }),
        )
        .expect("valid")));
        app.on_exam_submitted(after, resp);
        match &app.view {
            View::ExamOutcome { result, .. } => {
                assert_eq!(result.band, "C1");
                assert_eq!(result.overall_score, 90);
                assert_eq!(result.sections.len(), 1);
            }
            other => panic!("expected ExamOutcome, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn second_exam_submit_enter_while_submitting_does_not_dispatch_twice() {
        let mut app = test_app();
        app.view = exam_with_sections(serde_json::json!([
            { "id": "ex-g", "skill": "GRAMMAR", "part": "P1", "order": 0, "format": "mc", "weight": 1.0, "status": "READY", "score": null,
              "episode": null, "speakingPrompts": [], "writingPrompts": [],
              "questions": [{ "id": "g0", "order": 0, "question": "?", "options": ["a","b"], "passageRef": null, "passageText": null }] }
        ]));

        let before = app.request_gen;
        app.on_select(); // answers -> submits
        let after_first = app.request_gen;
        assert_eq!(after_first, before + 1);
        assert!(matches!(
            app.view,
            View::Exam {
                submitting: true,
                ..
            }
        ));

        app.on_select(); // key-mash while submitting: ignored
        assert_eq!(
            app.request_gen, after_first,
            "a second Enter while submitting must not dispatch again"
        );
    }

    #[tokio::test]
    async fn stale_exam_result_for_a_previous_exam_is_ignored() {
        let mut app = test_app();
        app.view = View::exam_view(course("A"));
        if let View::Exam { exam_id, .. } = &mut app.view {
            *exam_id = Some("exam1".into());
        }
        let stale_gen = app.request_gen;
        // Navigate away (bumps gen) before the submit result lands.
        app.enter_course_home(course("A"));

        let resp: ApiResult<types::SubmitExamResponse> =
            Arc::new(Ok(serde_json::from_value(serde_json::json!({
                "overallScore": 1.0, "band": "C2", "feedback": "x", "sections": []
            }))
            .expect("valid")));
        app.on_exam_submitted(stale_gen, resp);

        // The stale result must NOT replace the CourseHome with an exam outcome.
        assert!(matches!(app.view, View::CourseHome { .. }));
    }

    #[tokio::test]
    async fn malformed_exam_backs_out_to_course_home() {
        let mut app = test_app();
        app.enter_course_home(course("A"));
        app.view = View::exam_view(course("A"));
        let req_gen = app.request_gen;

        // Empty sections -> malformed -> back to CourseHome.
        app.on_exam_loaded(
            req_gen,
            exam_detail(serde_json::json!({
                "id": "exam1", "institution": "CEFR_GENERIC", "institutionLabel": "CEFR",
                "level": "B1", "status": "IN_PROGRESS", "examName": "Mock", "result": null,
                "sections": []
            })),
        );
        assert!(matches!(app.view, View::CourseHome { .. }));
    }

    // --- P6d: placement / memory / settings (hermetic, StubApi) -----------

    fn placement_loaded(json: serde_json::Value) -> ApiResult<types::GeneratePlacementResponse> {
        Arc::new(Ok(
            serde_json::from_value(json).expect("valid placement JSON")
        ))
    }

    #[tokio::test]
    async fn empty_courses_n_opens_the_placement_picker() {
        let mut app = test_app();
        app.view = View::courses(&[]); // no courses
        app.on_start_placement();
        assert!(
            matches!(app.view, View::PlacementLang { .. }),
            "the empty-courses state must lead into placement"
        );
    }

    #[tokio::test]
    async fn placement_run_creates_a_course_and_lands_in_it() {
        let mut app = test_app();
        app.on_start_placement();
        // Native English (cursor 0), target Spanish (cursor 1) by default.
        app.placement_lang_confirm();
        assert!(
            matches!(app.view, View::PlacementLang { loading: true, .. }),
            "confirm marks the question fetch in flight"
        );

        // Questions arrive -> placement review.
        let load_gen = app.request_gen;
        app.on_placement_loaded(
            load_gen,
            placement_loaded(serde_json::json!({
                "native": "en", "target": "es",
                "questions": [
                    { "id": "pq_0", "cefr": "A1", "skill": "grammar", "prompt": "?", "options": ["a","b"] }
                ]
            })),
        );
        assert!(matches!(app.view, View::PlacementReview { .. }));

        // Answer the only question -> submits placement.
        let before = app.request_gen;
        app.on_select();
        let after = app.request_gen;
        assert_eq!(
            after,
            before + 1,
            "answering the last question submits once"
        );
        assert!(matches!(
            app.view,
            View::PlacementReview {
                submitting: true,
                ..
            }
        ));

        // The assessed result lands.
        let resp: ApiResult<types::SubmitPlacementResponse> =
            Arc::new(Ok(serde_json::from_value(serde_json::json!({
                "courseId": "course-new", "level": "B1", "scoreBySkill": { "grammar": 0.7 }
            }))
            .expect("valid")));
        app.on_placement_submitted(after, resp);
        match &app.view {
            View::PlacementResult { outcome } => {
                assert_eq!(outcome.course_id, "course-new");
                assert_eq!(outcome.level, "B1");
                // The submitted languages are carried onto the outcome.
                assert_eq!(outcome.native, "en");
                assert_eq!(outcome.target, "es");
            }
            other => panic!("expected PlacementResult, got {other:?}"),
        }

        // Continue -> land in the created course's home, with REAL language
        // metadata + a readable title (not blank "Your course").
        app.placement_result_continue();
        match &app.view {
            View::CourseHome { course, .. } => {
                assert_eq!(course.id, "course-new");
                assert_eq!(course.native_lang, "en");
                assert_eq!(course.target_lang, "es");
                assert_eq!(course.current_level, "B1");
                assert_eq!(course.title, "English → Spanish");
            }
            other => panic!("expected CourseHome, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn placement_picker_rejects_identical_languages() {
        let mut app = test_app();
        app.on_start_placement();
        // Make both columns point at the same language.
        if let View::PlacementLang {
            native_cursor,
            target_cursor,
            ..
        } = &mut app.view
        {
            *native_cursor = 0;
            *target_cursor = 0;
        }
        let before = app.request_gen;
        app.placement_lang_confirm();
        assert_eq!(
            app.request_gen, before,
            "identical languages must not dispatch a placement fetch"
        );
        assert!(matches!(
            app.view,
            View::PlacementLang { loading: false, .. }
        ));
    }

    #[tokio::test]
    async fn stale_placement_result_for_a_previous_run_is_ignored() {
        let mut app = test_app();
        app.view = View::placement_review(
            "en".into(),
            "es".into(),
            vec![state::PlacementQuestion {
                id: "pq_0".into(),
                prompt: "?".into(),
                options: vec!["a".into(), "b".into()],
            }],
        );
        let stale_gen = app.request_gen;
        // Navigate away (bumps gen) before the submit result lands.
        app.enter_course_home(course("A"));

        let resp: ApiResult<types::SubmitPlacementResponse> = Arc::new(Ok(serde_json::from_value(
            serde_json::json!({ "courseId": "c", "level": "C2", "scoreBySkill": {} }),
        )
        .expect("valid")));
        app.on_placement_submitted(stale_gen, resp);

        assert!(matches!(app.view, View::CourseHome { .. }));
    }
