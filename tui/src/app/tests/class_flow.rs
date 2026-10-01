    fn next_outcome(outcome: NextClassOutcome) -> ApiResult<NextClassOutcome> {
        Arc::new(Ok(outcome))
    }

    fn class_detail(mut json: serde_json::Value) -> ApiResult<types::ClassDetailResponse> {
        if let Some(obj) = json.as_object_mut() {
            obj.entry("courseId")
                .or_insert_with(|| serde_json::json!("course1"));
        }
        Arc::new(Ok(serde_json::from_value(json).expect("valid class JSON")))
    }

    #[tokio::test]
    async fn next_class_done_shows_the_course_complete_screen() {
        let mut app = test_app();
        app.enter_course_home(course("A"));
        // Start the class flow; the next-class resolver needs pending_course set.
        app.on_next_class();
        let req_gen = app.request_gen;

        app.on_next_class_resolved(req_gen, next_outcome(NextClassOutcome::Done));

        match &app.view {
            View::ClassDone { course } => assert_eq!(course.id, "A"),
            other => panic!("expected ClassDone, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn next_class_created_enters_the_class_and_loads_sections() {
        let mut app = test_app();
        app.enter_course_home(course("A"));
        app.on_next_class();
        let req_gen = app.request_gen;

        // next-class returns a class id -> enter Class (sections load next).
        app.on_next_class_resolved(
            req_gen,
            next_outcome(NextClassOutcome::Created {
                class_id: "cls1".into(),
            }),
        );
        match &app.view {
            View::Class {
                class_id, sections, ..
            } => {
                assert_eq!(class_id, "cls1");
                assert!(sections.is_none(), "sections load separately");
            }
            other => panic!("expected Class, got {other:?}"),
        }

        // The class detail lands and the sections populate, in order.
        let load_gen = app.request_gen;
        app.on_class_loaded(
            load_gen,
            class_detail(serde_json::json!({
                "id": "cls1", "status": "IN_PROGRESS", "order": 1, "passThreshold": 0.7,
                "submitted": false,
                "sections": [
                    { "id": "sec-g", "skill": "GRAMMAR", "status": "READY", "episode": null,
                      "prompts": [], "writingPrompts": [],
                      "questions": [{ "id": "g0", "order": 0, "question": "?", "options": ["a","b"], "passageRef": null, "passageText": null }] }
                ]
            })),
        );
        match &app.view {
            View::Class {
                sections: Some(sections),
                ..
            } => assert_eq!(sections.len(), 1),
            other => panic!("expected loaded Class, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn incomplete_saved_class_offers_repair_without_advancing_the_gate() {
        let mut app = test_app();
        app.enter_course_home(course("A"));
        app.view = View::class_view(course("A"), "cls1".into());
        let req_gen = app.request_gen;

        // Empty sections retain their identity and offer an explicit repair.
        app.on_class_loaded(
            req_gen,
            class_detail(serde_json::json!({
                "id": "cls1", "status": "IN_PROGRESS", "order": 1, "passThreshold": 0.7,
                "submitted": false, "sections": []
            })),
        );
        assert!(matches!(app.view, View::ClassRepair { ref class_id, attempt: 1, .. } if class_id == "cls1"));
        app.on_next_class();
        assert!(matches!(app.view, View::Loading));
        assert_eq!(app.pending_course.as_ref().map(|course| course.id.as_str()), Some("A"));
    }

    #[tokio::test]
    async fn class_submit_result_shows_pass_and_offers_next_class() {
        let mut app = test_app();
        app.view = View::class_view(course("A"), "cls1".into());
        let req_gen = app.request_gen;

        let resp: ApiResult<types::SubmitClassResponse> =
            Arc::new(Ok(serde_json::from_value(serde_json::json!({
                "passed": true, "overallScore": 0.85, "passedSections": 5, "totalSections": 5,
                "sections": []
            }))
            .expect("valid submit")));
        app.on_class_submitted(req_gen, resp);

        match &app.view {
            View::ClassOutcome { result, .. } => {
                assert!(result.passed);
                assert_eq!(result.overall_score, 85);
            }
            other => panic!("expected ClassOutcome, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn stale_class_result_for_a_previous_class_is_ignored() {
        let mut app = test_app();
        app.view = View::class_view(course("A"), "cls1".into());
        let stale_gen = app.request_gen;
        // Navigate away (bumps gen) before the submit result lands.
        app.enter_course_home(course("A"));

        let resp: ApiResult<types::SubmitClassResponse> =
            Arc::new(Ok(serde_json::from_value(serde_json::json!({
                "passed": true, "overallScore": 1.0, "passedSections": 1, "totalSections": 1,
                "sections": []
            }))
            .expect("valid")));
        app.on_class_submitted(stale_gen, resp);

        // The stale result must NOT replace the CourseHome with a class outcome.
        assert!(matches!(app.view, View::CourseHome { .. }));
    }

    /// Build a `Class` view whose sections are loaded from `sections` JSON.
    fn class_with_sections(sections: serde_json::Value) -> View {
        let cls: types::ClassDetailResponse = serde_json::from_value(serde_json::json!({
            "id": "cls1", "status": "IN_PROGRESS", "order": 1, "passThreshold": 0.7,
            "courseId": "course1", "submitted": false, "sections": sections
        }))
        .expect("valid class");
        let built = state::class_sections(&cls).expect("well-formed sections");
        View::Class {
            course: course("A"),
            class_id: "cls1".into(),
            attempt: 1,
            progress: Default::default(),
            sections: Some(built),
            cursor: 0,
            submitting: false,
        }
    }

    #[tokio::test]
    async fn second_submit_enter_while_submitting_does_not_dispatch_twice() {
        // A single one-question grammar section: answering it submits the class.
        let mut app = test_app();
        app.view = class_with_sections(serde_json::json!([
            { "id": "sec-g", "skill": "GRAMMAR", "status": "READY", "episode": null,
              "prompts": [], "writingPrompts": [],
              "questions": [{ "id": "g0", "order": 0, "question": "?", "options": ["a","b"], "passageRef": null, "passageText": null }] }
        ]));

        let before = app.request_gen;
        app.on_select(); // answers the only question -> submits the class
        let after_first = app.request_gen;
        assert_eq!(after_first, before + 1, "first submit dispatches once");
        assert!(
            matches!(
                app.view,
                View::Class {
                    submitting: true,
                    ..
                }
            ),
            "submit marked in flight"
        );

        app.on_select(); // key-mash while submitting: must be ignored
        assert_eq!(
            app.request_gen, after_first,
            "a second Enter while submitting must not dispatch again"
        );
    }

    #[tokio::test]
    async fn writing_failure_can_be_retried() {
        let mut app = test_app();
        app.view = class_with_sections(serde_json::json!([
            { "id": "sec-w", "skill": "WRITING", "status": "READY", "episode": null,
              "questions": [], "prompts": [],
              "writingPrompts": [{ "id": "w0", "order": 0, "task": "Write", "guidance": null, "response": null }] }
        ]));

        // Type something and submit.
        for c in "hola".chars() {
            app.on_writing_input(c);
        }
        app.on_writing_submit();
        assert!(
            matches!(
                app.current_section().map(|s| &s.progress),
                Some(SectionProgress::Writing {
                    phase: WritingPhase::Submitting,
                    ..
                })
            ),
            "submit marks the writing in flight"
        );

        // Grading fails.
        let req_gen = app.request_gen;
        let err: ApiResult<crate::api::WritingGradeResponse> = Arc::new(Err("grader down".into()));
        app.on_class_writing_graded(req_gen, err);
        assert!(app.in_writing_failed(), "failure -> Failed phase");

        // The preserved text can be resubmitted from Failed (the retry path).
        let before = app.request_gen;
        app.on_writing_submit();
        assert_eq!(
            app.request_gen,
            before + 1,
            "retry re-dispatches the submit"
        );
        assert!(
            matches!(
                app.current_section().map(|s| &s.progress),
                Some(SectionProgress::Writing {
                    phase: WritingPhase::Submitting,
                    ..
                })
            ),
            "retry returns to Submitting"
        );
    }

    #[tokio::test]
    async fn multi_prompt_writing_keeps_each_grade_visible_until_explicit_advance() {
        // A WRITING section with two prompts. After grading the first, its score +
        // feedback must stay visible (phase Graded, index still 0) until the
        // learner presses enter to advance — it must NOT auto-advance to a fresh
        // editor for the second prompt and silently discard the first feedback.
        let mut app = test_app();
        app.view = class_with_sections(serde_json::json!([
            { "id": "sec-w", "skill": "WRITING", "status": "READY", "episode": null,
              "questions": [], "prompts": [],
              "writingPrompts": [
                { "id": "w0", "order": 0, "task": "Write one", "guidance": null, "response": null },
                { "id": "w1", "order": 1, "task": "Write two", "guidance": null, "response": null }
              ] }
        ]));

        // Compose + submit the first prompt.
        for c in "first answer".chars() {
            app.on_writing_input(c);
        }
        app.on_writing_submit();
        let req_gen = app.request_gen;

        // The first prompt grades.
        let graded: ApiResult<crate::api::WritingGradeResponse> =
            Arc::new(Ok(serde_json::from_value(serde_json::json!({
                "overallScore": 0.8, "feedback": "Good use of past tense."
            }))
            .expect("valid grade")));
        app.on_class_writing_graded(req_gen, graded);

        // The grade is visible and we are STILL on the first prompt (index 0).
        match app.current_section().map(|s| &s.progress) {
            Some(SectionProgress::Writing { phase, index, .. }) => {
                assert_eq!(*index, 0, "must not auto-advance past the first prompt");
                match phase {
                    WritingPhase::Graded { score, feedback } => {
                        assert_eq!(*score, 80);
                        assert_eq!(feedback, "Good use of past tense.");
                    }
                    other => panic!("expected the first prompt's Graded feedback, got {other:?}"),
                }
            }
            other => panic!("expected a Writing section, got {other:?}"),
        }

        // Explicit advance (enter) -> fresh editor for the SECOND prompt.
        app.on_select();
        match app.current_section().map(|s| &s.progress) {
            Some(SectionProgress::Writing {
                phase,
                index,
                input,
                ..
            }) => {
                assert_eq!(*index, 1, "enter advances to the second prompt");
                assert_eq!(
                    *phase,
                    WritingPhase::Editing,
                    "second prompt opens a fresh editor"
                );
                assert!(input.is_empty(), "the second prompt's editor starts empty");
            }
            other => panic!("expected the second Writing prompt, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn stale_episode_for_a_previous_section_is_ignored() {
        // Section 0 listening, section 1 listening: advancing bumps the gen, so a
        // late episode load for section 0 must not attach to section 1.
        let mut app = test_app();
        app.view = class_with_sections(serde_json::json!([
            { "id": "sec-l0", "skill": "LISTENING", "status": "READY",
              "episode": { "id": "ep0", "audioUrl": null, "title": "First", "references": [] },
              "prompts": [], "writingPrompts": [],
              "questions": [{ "id": "q0", "order": 0, "question": "?", "options": ["a","b"], "passageRef": null, "passageText": null }] },
            { "id": "sec-l1", "skill": "LISTENING", "status": "READY",
              "episode": { "id": "ep1", "audioUrl": null, "title": "Second", "references": [] },
              "prompts": [], "writingPrompts": [],
              "questions": [{ "id": "q1", "order": 0, "question": "?", "options": ["a","b"], "passageRef": null, "passageText": null }] }
        ]));
        // Capture section 0's in-flight generation, then answer to advance to
        // section 1 (which bumps the generation).
        let stale_gen = app.request_gen;
        app.on_select(); // answers q0 (last in section 0) -> advance to section 1

        // A late episode load for section 0, tagged with the stale generation.
        let ep0: ApiResult<types::EpisodeDetailResponse> =
            Arc::new(Ok(serde_json::from_value(serde_json::json!({
                "id": "ep0", "title": "First", "status": "READY", "audioUrl": null,
                "duration": null, "language": "es", "segments": []
            }))
            .expect("valid episode")));
        app.on_class_episode_loaded(stale_gen, ep0);

        // Section 1 is current; its episode must remain unloaded (the stale ep0
        // result was dropped, not attached to section 1).
        match app.current_section().map(|s| &s.progress) {
            Some(SectionProgress::Listening { episode, .. }) => {
                assert!(
                    episode.is_none(),
                    "stale episode for section 0 must not attach to section 1"
                );
            }
            other => panic!("expected listening section 1, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn transcript_only_saved_class_requires_repair_before_completion() {
        // A class with a single transcript-only listening section (no MC
        // questions). Completing it must advance via next-class, not stall on
        // View::Class. The submit route rejects empty answers (.min(1)), so this
        // class cannot be submitted; the no-MC path re-resolves via next-class.
        let mut app = test_app();
        app.view = class_with_sections(serde_json::json!([
            { "id": "sec-l", "skill": "LISTENING", "status": "READY",
              "episode": { "id": "ep0", "audioUrl": null, "title": "Listen", "references": [] },
              "prompts": [], "writingPrompts": [], "questions": [] }
        ]));

        let before = app.request_gen;
        // Enter on the transcript-only section -> it is the last section -> the
        // no-MC completion path dispatches next-class.
        app.on_select();

        // It must NOT stall on View::Class; the next-class dispatch shows Loading
        // and bumps the generation.
        assert!(
            matches!(app.view, View::ClassRepair { .. }),
            "no-MC class must advance (Loading after next-class dispatch), not stall on Class"
        );
        assert_eq!(
            app.request_gen,
            before,
            "repair requires an explicit learner action"
        );

        app.on_next_class();
        assert!(matches!(app.view, View::Loading));
        // The accepted repair result resumes this same saved class.
        let req_gen = app.request_gen;
        app.on_next_class_resolved(req_gen, next_outcome(NextClassOutcome::Created { class_id: "cls1".into() }));
        assert!(
            matches!(app.view, View::Class { ref class_id, .. } if class_id == "cls1"),
            "repair resumes the same saved class"
        );
    }

    #[tokio::test]
    async fn speaking_only_saved_class_requires_repair_after_last_prompt() {
        // A speaking-only class: after the last prompt is graded, Enter advances
        // past the final section into the no-MC completion path (next-class).
        let mut app = test_app();
        app.view = class_with_sections(serde_json::json!([
            { "id": "sec-s", "skill": "SPEAKING", "status": "READY", "episode": null,
              "questions": [], "writingPrompts": [],
              "prompts": [{ "id": "s0", "order": 0, "targetPhrase": "Hola", "translation": "Hi", "ipa": null, "referenceTtsUrl": null }] }
        ]));
        // Mark the single prompt graded so Enter advances the section.
        if let Some(section) = app.current_section_mut()
            && let state::SectionProgress::Speaking { phase, .. } = &mut section.progress
        {
            *phase = state::SpeakingPhase::Graded {
                score: Some(90),
                transcript: None,
                feedback: None,
            };
        }

        let before = app.request_gen;
        app.on_select(); // last graded prompt -> advance past last section -> next-class

        assert!(
            matches!(app.view, View::ClassRepair { .. }),
            "speaking-only class must advance, not stall"
        );
        assert_eq!(
            app.request_gen,
            before,
            "repair requires an explicit learner action"
        );
    }

    // --- P6c: exams (hermetic, StubApi) -----------------------------------

#[tokio::test]
async fn an_active_partial_class_can_request_repair_without_advancing_the_course() {
    let mut app = test_app();
    app.view = View::class_view(course("A"), "partial-class".into());
    if let View::Class { attempt, .. } = &mut app.view { *attempt = 4; }
    let action = app.map_key(key(KeyCode::Char('N')));
    assert!(matches!(action, Some(Action::NextClass)));
    app.on_next_class();
    assert!(matches!(app.view, View::Loading));
    assert_eq!(app.pending_course.as_ref().map(|course| course.id.as_str()), Some("A"));
    let req_gen = app.request_gen;
    app.on_next_class_resolved(req_gen, next_outcome(NextClassOutcome::Created { class_id: "partial-class".into() }));
    assert!(matches!(&app.view, View::Class { class_id, .. } if class_id == "partial-class"));
}


#[tokio::test]
async fn class_repair_waits_for_saved_drafts_and_restores_retained_work_in_the_new_attempt() {
    let mut app = test_app();
    app.view = class_with_sections(serde_json::json!([{
        "id": "writing", "skill": "WRITING", "status": "READY",
        "episode": null, "questions": [], "prompts": [],
        "writingPrompts": [{ "id": "w0", "task": "Greet Ana.", "order": 0 }]
    }]));
    for letter in "Hola Ana.".chars() { app.on_writing_input(letter); }
    app.on_next_class();
    let sequence = match &app.view {
        View::Class { progress, .. } => progress.in_flight.expect("draft save pending"),
        other => panic!("repair discarded the writing screen: {other:?}"),
    };
    assert!(app.pending_course.is_none());
    app.on_next_class();
    assert!(matches!(app.view, View::Class { .. }));
    app.on_practice_progress_saved("CLASS/cls1/1".into(), sequence,
        Arc::new(Ok(serde_json::from_value(serde_json::json!({
            "saved": true, "progressRevision": 1
        })).unwrap())));
    app.on_next_class();
    assert!(matches!(app.view, View::Loading));
    app.on_next_class_resolved(app.request_gen, next_outcome(NextClassOutcome::Created { class_id: "cls1".into() }));
    app.on_class_loaded(app.request_gen, class_detail(serde_json::json!({
        "id": "cls1", "attempt": 2, "status": "IN_PROGRESS", "order": 1,
        "passThreshold": 0.7, "submitted": false, "progressRevision": 1,
        "writingDrafts": { "w0": "Hola Ana." },
        "sections": [{ "id": "writing", "skill": "WRITING", "status": "READY",
            "episode": null, "questions": [], "prompts": [],
            "writingPrompts": [{ "id": "w0", "task": "Greet Ana.", "order": 0, "savedDraft": "Hola Ana." }] }]
    })));
    assert!(matches!(app.view, View::Class { attempt: 2, .. }));
    assert!(matches!(app.current_section().map(|section| &section.progress),
        Some(SectionProgress::Writing { input, .. }) if input.text() == "Hola Ana."));
}

#[tokio::test]
async fn class_repair_keeps_an_unknown_recording_on_its_original_prompt() {
    let mut app = test_app();
    app.view = class_with_sections(serde_json::json!([{
        "id": "speaking", "skill": "SPEAKING", "status": "READY",
        "episode": null, "questions": [], "writingPrompts": [],
        "prompts": [{ "id": "s0", "targetPhrase": "Hola", "translation": "Hello", "order": 0 }]
    }]));
    app.on_class_speaking_uploaded(app.request_gen, Arc::new(Err("Lost acknowledgement".into())));
    app.on_next_class();
    assert!(app.view.has_uncertain_upload());
    assert!(matches!(app.view, View::Class { attempt: 1, .. }));
    assert!(app.pending_course.is_none());
}

#[tokio::test]
async fn class_saved_recording_identity_recovers_only_a_new_upload_after_lost_acknowledgement() {
    let mut app = test_app();
    let detail = |recording_id: &str| class_detail(serde_json::json!({
        "id": "cls1", "attempt": 1, "status": "IN_PROGRESS", "order": 1,
        "passThreshold": 0.7, "submitted": false,
        "sections": [{ "id": "speaking", "skill": "SPEAKING", "status": "READY",
            "episode": null, "questions": [], "writingPrompts": [],
            "prompts": [{ "id": "s0", "targetPhrase": "Hola", "translation": "Hello", "order": 0,
                "latestRecording": { "id": recording_id, "status": "SCORED",
                    "overallScore": 0.9, "transcript": "Hola", "feedback": "Recognized greeting" } }] }]
    }));
    app.view = View::class_view(course("A"), "cls1".into());
    app.on_class_loaded(app.request_gen, detail("previous-recording"));
    if let View::Class { progress, .. } = &mut app.view { progress.conflict = true; }
    app.cache_practice();
    app.view = View::class_view(course("A"), "cls1".into());
    app.on_class_loaded(app.request_gen, detail("recognized-recording"));
    app.on_class_speaking_uploaded(app.request_gen, Arc::new(Err("Lost acknowledgement".into())));
    app.cache_practice();
    app.view = View::class_view(course("A"), "cls1".into());
    app.on_class_loaded(app.request_gen, detail("recognized-recording"));
    assert!(app.view.has_uncertain_upload());
    app.cache_practice();
    app.view = View::class_view(course("A"), "cls1".into());
    app.on_class_loaded(app.request_gen, detail("new-recording"));
    assert!(!app.view.has_uncertain_upload());
    assert!(matches!(app.current_section().map(|section| &section.progress),
        Some(SectionProgress::Speaking { phase: SpeakingPhase::Graded { score: Some(90), .. }, .. })));
}
