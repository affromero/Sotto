    fn next_outcome(outcome: NextClassOutcome) -> ApiResult<NextClassOutcome> {
        Arc::new(Ok(outcome))
    }

    fn accept_no_prelude(app: &mut App) {
        let value = serde_json::from_value(serde_json::json!({"kind": "NOT_REQUIRED"})).unwrap();
        app.on_class_prelude_loaded(app.request_gen, Arc::new(Ok(value)));
        if let View::ClassPrelude { course, class_id, in_flight: true, .. } = &app.view {
            app.view = View::class_view(course.clone(), class_id.clone());
        }
    }

    #[tokio::test]
    async fn reviewed_prelude_blocks_practice_until_acknowledged_and_discards_stale_results() {
        let mut app = test_app();
        app.enter_course_home(course("A"));
        app.on_next_class();
        let request = app.request_gen;
        app.on_next_class_resolved(request, next_outcome(NextClassOutcome::Created { class_id: "cls1".into() }));
        let prelude: types::ClassPreludeResponse = serde_json::from_value(serde_json::json!({
            "kind": "BASE", "nativeLang": "es", "targetLang": "ru",
            "receiptId": "00000000-0000-4000-a000-000000000001", "acknowledged": false,
            "teaching": { "version": 1, "title": "Pedir", "explanation": "Usa cortesía.",
                "workedExamples": [
                    { "prompt": "Agua", "answer": "Вода", "explanation": "Una bebida." },
                    { "prompt": "Té", "answer": "Чай", "explanation": "Otra bebida." }
                ], "commonMistake": { "incorrect": "A", "correction": "B", "explanation": "Corrige." }
            }
        })).unwrap();
        let current = app.request_gen;
        app.on_class_prelude_loaded(current, Arc::new(Ok(prelude.clone())));
        assert!(matches!(&app.view, View::ClassPrelude { value: Some(value), in_flight: false, .. } if value["kind"] == "BASE"));
        app.class_prelude_select();
        assert!(matches!(app.view, View::ClassPrelude { in_flight: true, .. }));
        app.on_back();
        app.on_class_prelude_loaded(current, Arc::new(Ok(prelude)));
        assert!(matches!(app.view, View::CourseHome { .. }));
    }

    #[tokio::test]
    async fn uncertain_preparation_requires_checking_saved_status_before_retry() {
        let mut app = test_app();
        app.enter_course_home(course("A"));
        app.on_next_class();
        let request = app.request_gen;
        app.on_next_class_resolved(request, next_outcome(NextClassOutcome::Created { class_id: "cls1".into() }));
        let available: types::ClassPreludeResponse = serde_json::from_value(serde_json::json!({
            "kind": "ADDENDUM", "nativeLang": "es", "targetLang": "ru", "status": "AVAILABLE",
            "request": { "sourceHash": "a".repeat(64), "snapshotHash": "b".repeat(64) }
        })).unwrap();
        let current = app.request_gen;
        app.on_class_prelude_loaded(current, Arc::new(Ok(available)));
        app.class_prelude_select();
        assert!(matches!(app.view, View::ClassPrelude { in_flight: true, .. }));
        app.on_class_prelude_loaded(current, Arc::new(Err("Connection lost".into())));
        assert!(matches!(app.view, View::ClassPrelude { value: None, in_flight: false, error: Some(_), .. }));
        app.class_prelude_select();
        assert!(matches!(app.view, View::ClassPrelude { value: None, in_flight: false, .. }));
        app.class_prelude_read();
        assert!(matches!(app.view, View::ClassPrelude { value: None, in_flight: true, .. }));
    }

    #[tokio::test]
    async fn pending_prelude_polls_and_navigation_cancels_its_wait() {
        let mut app = test_app();
        app.enter_course_home(course("A"));
        app.on_next_class();
        let request = app.request_gen;
        app.on_next_class_resolved(request, next_outcome(NextClassOutcome::Created { class_id: "cls1".into() }));
        let pending: types::ClassPreludeResponse = serde_json::from_value(serde_json::json!({
            "kind": "ADDENDUM", "nativeLang": "es", "targetLang": "ru", "status": "PENDING", "recoverable": true,
            "request": { "sourceHash": "a".repeat(64), "snapshotHash": "b".repeat(64) }
        })).unwrap();
        let current = app.request_gen;
        app.on_class_prelude_loaded(current, Arc::new(Ok(pending)));
        assert!(matches!(app.view, View::ClassPrelude { in_flight: true, polls: 1, .. }));
        assert!(app.prelude_task.is_some());
        app.on_back();
        assert!(app.prelude_task.is_none());
        assert!(matches!(app.view, View::CourseHome { .. }));
    }

    fn class_detail(mut json: serde_json::Value) -> ApiResult<types::ClassDetailResponse> {
        if let Some(obj) = json.as_object_mut() {
            obj.entry("courseId")
                .or_insert_with(|| serde_json::json!("course1"));
        }
        Arc::new(Ok(serde_json::from_value(json).expect("valid class JSON")))
    }

    #[test]
    fn prerequisite_directions_require_the_current_receipt_source_and_every_task() {
        let source = "a".repeat(64);
        let receipt = "00000000-0000-4000-a000-000000000001";
        let class = serde_json::json!({
            "id": "cls1", "courseId": "course1", "status": "IN_PROGRESS", "order": 1,
            "passThreshold": 0.7, "submitted": false, "prerequisiteSourceHash": source,
            "taskMaterialRevision": "d".repeat(64),
            "sections": [{ "id": "s1", "skill": "GRAMMAR", "status": "READY", "episode": null,
                "prompts": [], "writingPrompts": [], "questions": [{ "id": "q1", "order": 1,
                "question": "Преврати сообщение в вопрос.", "options": ["A", "B"] }] }]
        });
        let saved = serde_json::json!({
            "status": "READY", "nativeLang": "es", "targetLang": "ru", "receiptId": receipt,
            "acknowledged": true, "request": { "sourceHash": source, "snapshotHash": "b".repeat(64) },
            "content": { "title": "Pedir", "explanation": "Usa cortesía.", "examples": [
                { "target": "Вода", "meaning": "Agua", "explanation": "Una bebida." }
            ], "directions": { "guided": "Haz una petición.", "tasks": [
                { "sectionId": "s1", "taskId": "q1", "kind": "question", "instruction": "Formula una pregunta." }
            ] } }
        });
        let parse = |value| serde_json::from_value::<types::ClassPrerequisiteResponse>(value).unwrap();
        let detail: types::ClassDetailResponse = serde_json::from_value(class.clone()).unwrap();
        let languages = ("es".to_string(), "ru".to_string());
        let check = |saved: serde_json::Value| super::class::validate_class_directions(&detail, &parse(saved), "cls1", receipt, &source, &languages);
        let directions = check(saved.clone()).unwrap();
        assert!(super::class::validate_class_directions(&detail, &parse(saved.clone()), "different-class", receipt, &source, &languages).is_err());
        assert_eq!(directions.tasks.get(&("s1".into(), "question".into(), "q1".into())).map(String::as_str), Some("Formula una pregunta."));
        let mut app = test_app();
        app.view = View::ClassPrelude { course: course("A"), class_id: "cls1".into(),
            value: None, in_flight: true, error: None, scroll: 0, polls: 0, retained_work: Vec::new() };
        let material = crate::api::ClassPreludeMaterial { detail: detail.clone(), directions: Some(directions.clone()) };
        app.on_class_prelude_material_loaded(app.request_gen, Arc::new(Ok(material)));
        assert!(matches!(&app.view, View::Class { directions: Some(shown), .. } if shown == &directions));
        let mut stale = saved.clone(); stale["request"]["sourceHash"] = "c".repeat(64).into();
        assert!(check(stale).is_err());
        let mut wrong_receipt = saved.clone(); wrong_receipt["receiptId"] = "00000000-0000-4000-a000-000000000002".into();
        assert!(check(wrong_receipt).is_err());
        let mut missing = saved.clone(); missing["content"]["directions"]["tasks"] = serde_json::json!([]);
        assert!(check(missing).is_err());
        let mut foreign = saved.clone(); foreign["content"]["directions"]["tasks"][0]["taskId"] = "other".into();
        assert!(check(foreign).is_err());
        let mut duplicate = saved.clone(); let first = duplicate["content"]["directions"]["tasks"][0].clone();
        duplicate["content"]["directions"]["tasks"].as_array_mut().unwrap().push(first);
        assert!(check(duplicate).is_err());
        let old = state::class_sections(&detail).unwrap();
        let mut changed = class; changed["sections"][0]["questions"][0]["options"][1] = "Changed".into();
        let changed: types::ClassDetailResponse = serde_json::from_value(changed).unwrap();
        assert!(!super::class::same_class_tasks(&old, &state::class_sections(&changed).unwrap()));
        let mut cached = View::class_view(course("A"), "cls1".into());
        if let View::Class { sections, progress, .. } = &mut cached {
            let mut retained = old;
            if let SectionProgress::Mc { selected, .. } = &mut retained[0].progress { selected[0] = Some(1); }
            *sections = Some(retained);
            progress.dirty = true;
        }
        app.practice_cache.insert("CLASS/cls1/1".into(), cached);
        app.view = View::ClassPrelude { course: course("A"), class_id: "cls1".into(),
            value: None, in_flight: true, error: None, scroll: 0, polls: 0, retained_work: Vec::new() };
        app.on_class_prelude_material_loaded(app.request_gen, Arc::new(Ok(crate::api::ClassPreludeMaterial { detail: changed, directions: Some(directions) })));
        assert!(matches!(&app.view, View::ClassPrelude { error: Some(message), .. } if message.contains("local work remains in memory")));
        assert!(matches!(&app.view, View::ClassPrelude { retained_work, .. } if retained_work.iter().any(|line| line.contains("Your choice: B"))));
        assert!(app.practice_cache.contains_key("CLASS/cls1/1"));
        app.view = View::ClassPrelude { course: course("A"), class_id: "cls1".into(),
            value: Some(serde_json::json!({"kind": "NOT_REQUIRED"})), in_flight: true,
            error: None, scroll: 0, polls: 0, retained_work: Vec::new() };
        app.on_class_prelude_material_loaded(app.request_gen, Arc::new(Ok(crate::api::ClassPreludeMaterial { detail: detail.clone(), directions: None })));
        assert!(matches!(&app.view, View::ClassPrelude { retained_work, error: Some(_), .. } if retained_work.iter().any(|line| line.contains("Your choice: B"))));
        let earlier = app.practice_cache.remove("CLASS/cls1/1").unwrap();
        app.practice_cache.insert("CLASS/cls1/0".into(), earlier);
        app.view = View::ClassPrelude { course: course("A"), class_id: "cls1".into(),
            value: Some(serde_json::json!({"kind": "NOT_REQUIRED"})), in_flight: true,
            error: None, scroll: 0, polls: 0, retained_work: Vec::new() };
        app.on_class_prelude_material_loaded(app.request_gen, Arc::new(Ok(crate::api::ClassPreludeMaterial { detail, directions: None })));
        assert!(matches!(&app.view, View::ClassPrelude { retained_work, error: Some(_), .. } if retained_work.iter().any(|line| line.contains("Your choice: B"))));
        assert!(app.practice_cache.contains_key("CLASS/cls1/0"));
    }

    #[test]
    fn class_displays_learner_language_direction_with_the_matching_question() {
        use ratatui::{Terminal, backend::TestBackend};
        let mut app = test_app();
        app.view = class_with_sections(serde_json::json!([{
            "id": "s1", "skill": "GRAMMAR", "status": "READY", "episode": null,
            "prompts": [], "writingPrompts": [], "questions": [{ "id": "q1", "order": 1,
                "question": "Преврати сообщение в вопрос.", "options": ["A", "B"] }]
        }]));
        if let View::Class { directions, .. } = &mut app.view {
            *directions = Some(crate::api::ClassDirections {
                source_hash: "a".repeat(64),
                tasks: [(("s1".into(), "question".into(), "q1".into()), "Formula una pregunta.".into())].into(),
            });
        }
        let mut terminal = Terminal::new(TestBackend::new(100, 25)).unwrap();
        terminal.draw(|frame| { app.draw(frame).unwrap(); }).unwrap();
        let text: String = terminal.backend().buffer().content().iter().map(|cell| cell.symbol()).collect();
        assert!(text.contains("Formula una pregunta."));
        assert!(text.contains("Преврати сообщение в вопрос."));
    }

    #[tokio::test]
    async fn previous_writing_is_read_only_scrollable_and_scoped_to_the_loaded_class() {
        use ratatui::{Terminal, backend::TestBackend};
        let mut app = test_app();
        let detail = class_detail(serde_json::json!({
            "id": "cls1", "status": "IN_PROGRESS", "order": 1, "passThreshold": 0.7,
            "submitted": false, "sections": [{
                "id": "current", "skill": "GRAMMAR", "status": "READY", "episode": null,
                "prompts": [], "writingPrompts": [],
                "questions": [{"id": "q1", "order": 1, "question": "Current?", "options": ["A", "B"]}]
            }],
            "speakingHistory": [{"sectionId": "old-speaking", "attempt": 1, "prompts": [{
                "id": "speaking-prompt", "order": 1, "targetPhrase": "Hallo", "translation": "Hello",
                "recordings": [{"id": "recording", "attempt": 1, "attemptMatches": true,
                    "status": "SCORED", "transcript": "Hallo Mia", "overallScore": 0.8,
                    "rubricScores": {"accuracy": 0.8, "broken": "legacy"},
                    "phonemeScores": [{"op": "substitute", "expected": "r", "actual": "l"}, {"bad": true}],
                    "feedback": "Clear speaking",
                    "createdAt": "2026-01-01T00:00:00Z"}]
            }]}],
            "writingHistory": [{"sectionId": "old", "attempt": 2, "prompts": [{
                "id": "prompt", "order": 1, "task": "Earlier task", "savedDraft": "Saved draft",
                "responses": [{"id": "response", "attempt": 1, "attemptMatches": false,
                    "text": "Prior response", "overallScore": 0.8, "feedback": "Good work",
                    "corrections": [{"old": "a", "new": "b", "why": "Correction"}, {"bad": true}],
                    "createdAt": "2026-01-01T00:00:00Z"}]
            }]}],
            "orphanWritingDrafts": [{"id": "orphan", "text": "Recovered words"}]
        }));
        app.view = View::class_view(course("A"), "cls1".into());
        app.on_class_loaded(app.request_gen, detail);
        assert!(matches!(app.map_key(key(KeyCode::F(2))), Some(Action::ClassHistoryToggle)));
        app.class_history_toggle();
        assert!(app.map_key(key(KeyCode::Enter)).is_none());
        assert!(matches!(app.map_key(key(KeyCode::Down)), Some(Action::ClassHistoryScroll(true))));
        let mut terminal = Terminal::new(TestBackend::new(100, 45)).unwrap();
        terminal.draw(|frame| { app.draw(frame).unwrap(); }).unwrap();
        let text: String = terminal.backend().buffer().content().iter().map(|cell| cell.symbol()).collect();
        assert!(text.contains("Hallo Mia"));
        assert!(text.contains("Clear speaking"));
        assert!(text.contains("accuracy: 80%"));
        assert!(text.contains("substitute: r → l"));
        assert!(text.contains("Some speaking feedback could not be displayed."));
        assert!(text.contains("Earlier task"));
        assert!(text.contains("Saved draft"));
        assert!(text.contains("Prior response"));
        assert!(text.contains("Good work"));
        assert!(!text.contains("Recovered words"));
        app.class_history_scroll(true);
        assert!(matches!(&app.view, View::Class { history_scroll: 1, progress, .. } if !progress.dirty));
        let mut scrolls = 1;
        let mut found = false;
        while scrolls <= 100 {
            terminal.draw(|frame| { app.draw(frame).unwrap(); }).unwrap();
            let visible: String = terminal.backend().buffer().content().iter().map(|cell| cell.symbol()).collect();
            if visible.contains("Recovered words") { found = true; break; }
            app.class_history_scroll(true);
            scrolls += 1;
        }
        assert!(found);
        assert!(matches!(&app.view, View::Class { progress, .. } if !progress.dirty));
        for _ in 0..scrolls { app.class_history_scroll(false); }
        terminal.draw(|frame| { app.draw(frame).unwrap(); }).unwrap();
        let visible: String = terminal.backend().buffer().content().iter().map(|cell| cell.symbol()).collect();
        assert!(visible.contains("Hallo Mia"));
        app.class_history_toggle();
        assert!(matches!(&app.view, View::Class { history_open: false, progress, .. } if !progress.dirty));
        app.view = View::class_view(course("B"), "other".into());
        assert!(matches!(&app.view, View::Class { previous_work, .. } if previous_work.is_empty()));
    }

    #[tokio::test]
    async fn saved_speaking_playback_fences_selection_and_closed_history() {
        for incomplete in [false, true] {
            let mut app = test_app();
            let sections = if incomplete { serde_json::json!([]) } else { serde_json::json!([{
                "id": "current", "skill": "GRAMMAR", "status": "READY", "episode": null,
                "prompts": [], "writingPrompts": [],
                "questions": [{"id": "q1", "order": 1, "question": "Current?", "options": ["A", "B"]}]
            }]) };
            let detail = class_detail(serde_json::json!({
                "id": "cls1", "status": "IN_PROGRESS", "order": 1, "passThreshold": 0.7,
                "submitted": false, "sections": sections,
                "speakingHistory": [{"sectionId": "old", "attempt": 1, "prompts": [{
                    "id": "prompt", "order": 1, "targetPhrase": "A very long speaking phrase that must not conceal the playback status on a narrow terminal", "translation": "Hello",
                    "recordings": [
                        {"id": "first", "attempt": 1, "attemptMatches": true, "status": "SCORED",
                         "transcript": null, "overallScore": null, "rubricScores": null, "phonemeScores": null,
                         "feedback": null, "createdAt": "2026-01-01T00:00:00Z"},
                        {"id": "second", "attempt": 1, "attemptMatches": true, "status": "PENDING",
                         "transcript": null, "overallScore": null, "rubricScores": null, "phonemeScores": null,
                         "feedback": null, "createdAt": "2026-01-02T00:00:00Z"}
                    ]
                }]}],
                "speakingHistoryUnlinked": [{"id": "unlinked", "attempt": 1, "status": "PENDING",
                    "transcript": null, "overallScore": null, "rubricScores": null, "phonemeScores": null,
                    "feedback": null, "createdAt": "2026-01-01T00:00:00Z"}]
            }));
            app.view = View::class_view(course("A"), "cls1".into());
            app.on_class_loaded(app.request_gen, detail);
            app.class_history_toggle();
            assert!(matches!(app.map_key(key(KeyCode::Char(' '))), Some(Action::ClassHistoryAudioPlay)));
            assert!(matches!(app.map_key(key(KeyCode::Char(']'))), Some(Action::ClassHistoryAudioMove(true))));
            app.class_history_audio_play();
            let first = match &app.view {
                View::Class { history_audio, .. } | View::ClassRepair { history_audio, .. } => {
                    assert_eq!(history_audio.items.len(), 2);
                    history_audio.pending.unwrap()
                }
                _ => panic!("Expected class history"),
            };
            if let Some(task) = app.history_audio_task.take() { task.abort(); }
            let pending = tokio::spawn(std::future::pending::<()>());
            app.history_audio_task = Some(pending.abort_handle());
            app.class_history_audio_move(true);
            assert!(pending.await.unwrap_err().is_cancelled());
            app.class_history_audio_play();
            let second = match &app.view {
                View::Class { history_audio, .. } | View::ClassRepair { history_audio, .. } => history_audio.pending.unwrap(),
                _ => panic!("Expected class history"),
            };
            assert_ne!(first, second);
            app.on_class_history_audio_downloaded(app.request_gen, first, "cls1", "prompt", "first", Arc::new(Err("old failure".into())));
            assert!(matches!(&app.view, View::Class { history_audio, .. } | View::ClassRepair { history_audio, .. }
                if history_audio.pending == Some(second) && history_audio.note.as_deref() == Some("Loading saved recording")));
            app.class_history_toggle();
            app.class_history_toggle();
            app.on_class_history_audio_downloaded(app.request_gen, second, "cls1", "prompt", "second", Arc::new(Err("late failure".into())));
            assert!(matches!(&app.view, View::Class { history_audio, history_open: true, .. } | View::ClassRepair { history_audio, history_open: true, .. }
                if history_audio.pending.is_none() && history_audio.note.is_none()));
            app.class_history_audio_play();
            let current = match &app.view {
                View::Class { history_audio, .. } | View::ClassRepair { history_audio, .. } => history_audio.pending.unwrap(),
                _ => panic!("Expected class history"),
            };
            app.on_class_history_audio_downloaded(app.request_gen, current, "cls1", "prompt", "second", Arc::new(Err("offline".into())));
            assert!(matches!(&app.view, View::Class { history_audio, .. } | View::ClassRepair { history_audio, .. }
                if history_audio.pending.is_none() && history_audio.note.as_deref() == Some("Recording unavailable: offline")));
            let mut terminal = ratatui::Terminal::new(ratatui::backend::TestBackend::new(40, 10)).unwrap();
            terminal.draw(|frame| { app.draw(frame).unwrap(); }).unwrap();
            let rendered: String = terminal.backend().buffer().content().iter().map(|cell| cell.symbol()).collect();
            assert!(rendered.contains("A very long speaking"), "{rendered:?}");
            assert!(rendered.contains("Recording unavailable"), "{rendered:?}");
            app.class_history_audio_play();
            let stale = match &app.view {
                View::Class { history_audio, .. } | View::ClassRepair { history_audio, .. } => history_audio.pending.unwrap(),
                _ => panic!("Expected class history"),
            };
            let old_generation = app.request_gen;
            app.config.upsert_profile("other", crate::config::Profile {
                server_url: "stub://other".into(), api_key: "other-key".into(), name: None,
            });
            app.accounts.open = true;
            app.accounts.cursor = 1;
            app.on_switch_account();
            assert!(app.request_gen > old_generation);
            app.on_class_history_audio_downloaded(old_generation, stale, "cls1", "prompt", "second", Arc::new(Err("old account".into())));
            assert!(matches!(app.view, View::Loading));
        }
    }

    #[tokio::test]
    async fn previous_quiz_work_is_read_only_and_keeps_unlinked_answers() {
        use ratatui::{Terminal, backend::TestBackend};
        let mut app = test_app();
        app.view = View::class_view(course("A"), "cls1".into());
        app.on_class_loaded(app.request_gen, class_detail(serde_json::json!({
            "id": "cls1", "status": "IN_PROGRESS", "order": 1, "passThreshold": 0.7,
            "submitted": false, "sections": [{
                "id": "current", "skill": "GRAMMAR", "status": "READY", "episode": null,
                "prompts": [], "writingPrompts": [],
                "questions": [{"id": "q1", "order": 1, "question": "Current?", "options": ["A", "B"]}]
            }],
            "quizHistory": [{"sectionId": "old", "skill": "GRAMMAR", "attempt": 1, "questions": [{
                "id": "q-old", "order": 1, "question": "Earlier question", "passageText": null,
                "options": ["Hola", "Adios"], "savedChoice": 0,
                "submissions": [{"attempt": 1, "submittedAt": null, "selectedIndex": 1, "isCorrect": false},
                    {"attempt": null, "submittedAt": null, "selectedIndex": 0, "isCorrect": null},
                    {"attempt": 2, "submittedAt": null, "selectedIndex": null, "isCorrect": true}]
            }]}],
            "orphanQuizAnswers": [{"sectionId": null, "questionId": "missing", "savedChoice": 5, "submissions": []}],
            "quizSubmissionReceipts": [{"attempt": 3, "submittedAt": null, "passed": false, "overallScore": 0.4,
                "answersUnavailable": true, "passedSections": 1, "totalSections": 2,
                "sections": [{"id": "speaking", "skill": "SPEAKING", "score": 0.8, "passed": true},
                    {"id": null, "skill": "READING", "score": 0.7, "passed": null}], "summaryIncomplete": true}],
            "quizHistoryUnreadable": true
        })));
        app.class_history_toggle();
        let mut terminal = Terminal::new(TestBackend::new(100, 60)).unwrap();
        terminal.draw(|frame| { app.draw(frame).unwrap(); }).unwrap();
        let text: String = terminal.backend().buffer().content().iter().map(|cell| cell.symbol()).collect();
        assert!(text.contains("Previous work"));
        assert!(text.contains("Earlier question"));
        assert!(text.contains("Saved choice: 1. Hola"));
        assert!(text.contains("2. Adios · Incorrect"));
        assert!(text.contains("1. Hola · Outcome unavailable"));
        assert!(text.contains("Choice unavailable · Correct"));
        assert!(text.contains("Choice index 5 (text unavailable)"));
        assert!(text.contains("Some previous quiz records could not be displayed."));
        assert!(text.contains("SPEAKING · Score: 80% · Passed"));
        assert!(text.contains("READING · Score: 70% · Outcome unavailable"));
        assert!(app.map_key(key(KeyCode::Enter)).is_none());
        assert!(matches!(&app.view, View::Class { progress, .. } if !progress.dirty));
    }

    #[tokio::test]
    async fn quiz_only_history_can_be_opened_before_incomplete_class_repair() {
        let mut app = test_app();
        app.view = View::class_view(course("A"), "cls1".into());
        app.on_class_loaded(app.request_gen, class_detail(serde_json::json!({
            "id": "cls1", "status": "IN_PROGRESS", "order": 1, "passThreshold": 0.7,
            "submitted": false, "sections": [], "orphanQuizAnswers": [{
                "sectionId": null, "questionId": "lost", "savedChoice": 0, "submissions": []
            }]
        })));
        assert!(matches!(&app.view, View::ClassRepair { previous_work, .. } if previous_work.iter().any(|line| line.contains("Choice index 0"))));
        assert!(matches!(app.map_key(key(KeyCode::F(2))), Some(Action::ClassHistoryToggle)));
        app.class_history_toggle();
        assert!(matches!(&app.view, View::ClassRepair { history_open: true, .. }));
    }

    #[tokio::test]
    async fn previous_writing_remains_available_before_incomplete_class_repair() {
        let mut app = test_app();
        app.view = View::class_view(course("A"), "cls1".into());
        app.on_class_loaded(app.request_gen, class_detail(serde_json::json!({
            "id": "cls1", "status": "IN_PROGRESS", "order": 1, "passThreshold": 0.7,
            "submitted": false, "sections": [],
            "orphanWritingDrafts": [{"id": "old", "text": "Saved words"}]
        })));
        assert!(matches!(&app.view, View::ClassRepair { previous_work, .. } if previous_work.iter().any(|text| text.contains("Saved words"))));
        assert!(matches!(app.map_key(key(KeyCode::F(2))), Some(Action::ClassHistoryToggle)));
        app.class_history_toggle();
        assert!(matches!(&app.view, View::ClassRepair { history_open: true, .. }));
        app.class_history_toggle();
        assert!(matches!(&app.view, View::ClassRepair { history_open: false, .. }));
    }

    #[tokio::test]
    async fn clearing_history_during_refresh_never_traps_the_class_view() {
        let mut app = test_app();
        let base = serde_json::json!({
            "id": "cls1", "status": "IN_PROGRESS", "order": 1, "passThreshold": 0.7,
            "submitted": false, "sections": [{
                "id": "current", "skill": "GRAMMAR", "status": "READY", "episode": null,
                "prompts": [], "writingPrompts": [],
                "questions": [{"id": "q1", "order": 1, "question": "Current?", "options": ["A", "B"]}]
            }]
        });
        let mut with_history = base.clone();
        with_history["orphanWritingDrafts"] = serde_json::json!([{"id": "old", "text": "Saved"}]);
        app.view = View::class_view(course("A"), "cls1".into());
        app.on_class_loaded(app.request_gen, class_detail(with_history));
        app.class_history_toggle();
        app.class_history_scroll(true);
        app.on_class_loaded(app.request_gen, class_detail(base));
        assert!(matches!(&app.view, View::Class { history_open: false, history_scroll: 0, .. }));
        assert!(!matches!(app.map_key(key(KeyCode::Esc)), Some(Action::ClassHistoryToggle)));
    }

    #[test]
    fn long_task_directions_scroll_without_replacing_the_exercise() {
        use ratatui::{Terminal, backend::TestBackend};
        let mut app = test_app();
        app.view = class_with_sections(serde_json::json!([{
            "id": "s1", "skill": "GRAMMAR", "status": "READY", "episode": null,
            "prompts": [], "writingPrompts": [], "questions": [{ "id": "q1", "order": 1,
                "question": "Elige A.", "options": ["A", "B"] }]
        }]));
        if let View::Class { directions, .. } = &mut app.view {
            *directions = Some(crate::api::ClassDirections {
                source_hash: "a".repeat(64),
                tasks: [(("s1".into(), "question".into(), "q1".into()), format!("{} FIN DE INSTRUCCION", "palabra ".repeat(80)))].into(),
            });
        }
        for _ in 0..9 { app.class_direction_scroll(true); }
        let mut terminal = Terminal::new(TestBackend::new(60, 20)).unwrap();
        terminal.draw(|frame| { app.draw(frame).unwrap(); }).unwrap();
        let text: String = terminal.backend().buffer().content().iter().map(|cell| cell.symbol()).collect();
        assert!(text.contains("FIN DE INSTRUCCION"));
        assert!(text.contains("Elige A."));
    }

    #[test]
    fn retained_work_includes_the_current_unsaved_writing_draft() {
        let mut view = class_with_sections(serde_json::json!([{
            "id": "writing", "skill": "WRITING", "status": "READY", "episode": null,
            "questions": [], "prompts": [], "writingPrompts": [{ "id": "w0", "order": 1, "task": "Saluda a Ana." }]
        }]));
        let View::Class { sections: Some(sections), .. } = &mut view else { panic!("class sections missing") };
        if let SectionProgress::Writing { input, .. } = &mut sections[0].progress {
            *input = state::WritingInput::from_text("Hola, Ana.");
        }
        let retained = super::class::retained_class_work(sections);
        assert!(retained.iter().any(|text| text.contains("Hola, Ana.")));
    }

    #[tokio::test]
    async fn changed_source_during_refresh_returns_to_prelude_and_preserves_work() {
        let mut app = test_app();
        let sections = serde_json::json!([{
            "id": "s1", "skill": "GRAMMAR", "status": "READY", "episode": null,
            "prompts": [], "writingPrompts": [], "questions": [{ "id": "q1", "order": 1,
                "question": "Elige A.", "options": ["A", "B"] }]
        }]);
        app.view = class_with_sections(sections.clone());
        if let View::Class { material_source, progress, sections: Some(items), .. } = &mut app.view {
            *material_source = Some("a".repeat(64));
            progress.dirty = true;
            if let SectionProgress::Mc { selected, .. } = &mut items[0].progress { selected[0] = Some(1); }
        }
        app.on_class_loaded(app.request_gen, class_detail(serde_json::json!({
            "id": "cls1", "status": "IN_PROGRESS", "order": 1, "passThreshold": 0.7,
            "submitted": false, "attempt": 1, "taskMaterialRevision": "b".repeat(64), "sections": sections
        })));
        assert!(matches!(app.view, View::ClassPrelude { .. }));
        assert!(app.practice_cache.contains_key("CLASS/cls1/1"));
    }

    #[tokio::test]
    async fn material_revision_controls_dirty_work_restoration_on_direct_detail_load() {
        let sections = serde_json::json!([{
            "id": "s1", "skill": "GRAMMAR", "status": "READY", "episode": null,
            "prompts": [], "writingPrompts": [], "questions": [{ "id": "q1", "order": 1,
                "question": "Elige A.", "options": ["A", "B"] }]
        }]);
        for (fresh_revision, should_restore) in [("a", true), ("b", false)] {
            let mut app = test_app();
            let mut cached = class_with_sections(sections.clone());
            if let View::Class { material_source, progress, sections: Some(items), .. } = &mut cached {
                *material_source = Some("a".repeat(64));
                progress.dirty = true;
                if let SectionProgress::Mc { selected, .. } = &mut items[0].progress { selected[0] = Some(1); }
            }
            app.practice_cache.insert("CLASS/cls1/1".into(), cached);
            app.view = View::class_view(course("A"), "cls1".into());
            app.on_class_loaded(app.request_gen, class_detail(serde_json::json!({
                "id": "cls1", "status": "IN_PROGRESS", "order": 1, "passThreshold": 0.7,
                "submitted": false, "attempt": 1, "taskMaterialRevision": fresh_revision.repeat(64), "sections": sections
            })));
            if should_restore {
                assert!(matches!(&app.view, View::Class { sections: Some(items), .. }
                    if matches!(&items[0].progress, SectionProgress::Mc { selected, .. } if selected[0] == Some(1))));
            } else {
                assert!(matches!(&app.view, View::ClassPrelude { retained_work, .. }
                    if retained_work.iter().any(|line| line.contains("Your choice: B"))));
                assert!(app.practice_cache.contains_key("CLASS/cls1/1"));
            }
        }
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
        assert!(matches!(app.view, View::ClassPrelude { .. }));
        accept_no_prelude(&mut app);
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
    async fn class_without_prelude_loads_only_after_the_material_response() {
        let mut app = test_app();
        app.enter_course_home(course("A"));
        app.on_next_class();
        let request = app.request_gen;
        app.on_next_class_resolved(request, next_outcome(NextClassOutcome::Created { class_id: "cls1".into() }));
        let prelude = serde_json::from_value(serde_json::json!({"kind": "NOT_REQUIRED"})).unwrap();
        app.on_class_prelude_loaded(app.request_gen, Arc::new(Ok(prelude)));
        assert!(matches!(app.view, View::ClassPrelude { in_flight: true, .. }));
        let detail: types::ClassDetailResponse = serde_json::from_value(serde_json::json!({
            "id": "cls1", "courseId": "course1", "status": "IN_PROGRESS", "order": 1,
            "passThreshold": 0.7, "submitted": false, "sections": [{ "id": "s1",
                "skill": "GRAMMAR", "status": "READY", "episode": null, "prompts": [],
                "writingPrompts": [], "questions": [{ "id": "q1", "order": 1, "question": "?", "options": ["A", "B"] }] }]
        })).unwrap();
        app.on_class_prelude_material_loaded(app.request_gen, Arc::new(Ok(crate::api::ClassPreludeMaterial { detail, directions: None })));
        assert!(matches!(app.view, View::Class { sections: Some(_), directions: None, .. }));
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
            directions: None,
            material_source: None,
            direction_scroll: Default::default(),
            previous_work: Vec::new(),
            history_open: false,
            history_scroll: 0,
            history_audio: Default::default(),
            sections: Some(built),
            cursor: 0,
            submitting: false,
        }
    }

    #[test]
    fn class_response_for_another_id_does_not_replace_saved_work() {
        let mut app = test_app();
        app.view = class_with_sections(serde_json::json!([
            { "id": "original", "skill": "GRAMMAR", "status": "READY", "episode": null,
              "prompts": [], "writingPrompts": [],
              "questions": [{ "id": "q1", "order": 0, "question": "Original?", "options": ["a", "b"] }] }
        ]));
        let other = class_detail(serde_json::json!({
            "id": "other", "status": "IN_PROGRESS", "order": 1, "passThreshold": 0.7,
            "submitted": false, "sections": []
        }));
        app.on_class_loaded(app.request_gen, other);
        assert!(matches!(&app.view, View::Class { class_id, sections: Some(sections), .. }
            if class_id == "cls1" && sections.len() == 1 && sections[0].id == "original"));
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
