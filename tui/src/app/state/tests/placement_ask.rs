    fn placement_response(json: serde_json::Value) -> types::GeneratePlacementResponse {
        serde_json::from_value(json).expect("valid placement JSON")
    }

    #[test]
    fn placement_questions_convert_with_cefr_and_skill_in_the_prompt() {
        let resp = placement_response(serde_json::json!({
            "native": "en", "target": "es",
            "questions": [
                { "id": "pq_0", "cefr": "A2", "skill": "grammar", "prompt": "Choose", "options": ["el","la"] }
            ]
        }));
        let qs = placement_questions(&resp).expect("well-formed");
        assert_eq!(qs.len(), 1);
        assert_eq!(qs[0].id, "pq_0");
        assert!(qs[0].prompt.contains("A2"));
        assert!(qs[0].prompt.contains("grammar"));
        assert!(qs[0].prompt.contains("Choose"));
    }

    #[test]
    fn empty_placement_batch_is_malformed() {
        let resp = placement_response(serde_json::json!({
            "native": "en", "target": "es", "questions": []
        }));
        assert!(placement_questions(&resp).is_none());
    }

    #[test]
    fn placement_question_with_no_options_is_malformed() {
        let resp = placement_response(serde_json::json!({
            "native": "en", "target": "es",
            "questions": [{ "id": "pq_0", "cefr": "A1", "skill": "vocab", "prompt": "?", "options": [] }]
        }));
        assert!(placement_questions(&resp).is_none());
    }

    #[test]
    fn placement_answer_can_select_the_idk_option() {
        // The server appends a native-language "I don't know" as a 5th option
        // (index 4); the count-driven submit must carry that selection unchanged.
        let resp = placement_response(serde_json::json!({
            "native": "en", "target": "es",
            "questions": [
                { "id": "pq_0", "cefr": "A1", "skill": "grammar", "prompt": "?",
                  "options": ["a", "b", "c", "d", "No lo sé"] }
            ]
        }));
        let questions = placement_questions(&resp).expect("well-formed");
        assert_eq!(questions[0].options.len(), 5);

        let answers = build_placement_answers(&questions, &[Some(4)]).expect("valid");
        assert_eq!(answers.len(), 1);
        assert_eq!(answers[0].selected_index, 4);
    }

    #[test]
    fn build_placement_answers_omits_unanswered_questions() {
        let qs = vec![
            PlacementQuestion {
                id: "pq_0".into(),
                prompt: "a".into(),
                options: vec!["x".into(), "y".into()],
            },
            PlacementQuestion {
                id: "pq_1".into(),
                prompt: "b".into(),
                options: vec!["x".into(), "y".into()],
            },
        ];
        let selected = vec![Some(1), None];
        let answers = build_placement_answers(&qs, &selected).expect("valid");
        assert_eq!(answers.len(), 1);
        assert_eq!(answers[0].id, "pq_0");
        assert_eq!(answers[0].selected_index, 1);
    }

    #[test]
    fn placement_outcome_converts_level_and_sorted_skill_percentages() {
        let resp: types::SubmitPlacementResponse = serde_json::from_value(serde_json::json!({
            "courseId": "c-new", "level": "B1",
            "scoreBySkill": { "vocab": 0.4, "grammar": 0.8, "reading": 0.6 }
        }))
        .expect("valid");
        let outcome = PlacementOutcome::from_response(&resp, "en".into(), "es".into());
        assert_eq!(outcome.course_id, "c-new");
        assert_eq!(outcome.level, "B1");
        // The submitted languages are carried onto the outcome.
        assert_eq!(outcome.native, "en");
        assert_eq!(outcome.target, "es");
        // Sorted by skill name: grammar, reading, vocab.
        assert_eq!(
            outcome.score_by_skill,
            vec![
                ("grammar".to_string(), 80),
                ("reading".to_string(), 60),
                ("vocab".to_string(), 40),
            ]
        );
    }

    #[test]
    fn course_title_from_codes_is_human_readable_with_fallbacks() {
        assert_eq!(course_title("en", "es"), "English → Spanish");
        // An unknown code falls back to its uppercase form.
        assert_eq!(course_title("en", "xx"), "English → XX");
        // Missing codes fall back to a generic title (never blank).
        assert_eq!(course_title("", "es"), "Your course");
    }

    #[test]
    fn memory_items_sort_vocab_first_then_due_then_mastery() {
        let graph: types::MemoryGraphResponse = serde_json::from_value(serde_json::json!({
            "nodes": [
                { "id": "g0", "kind": "grammar", "label": "Past tense", "strength": 0.5, "due": false },
                { "id": "v0", "kind": "vocab", "label": "casa", "translation": "house", "strength": 0.9, "due": false },
                { "id": "v1", "kind": "vocab", "label": "perro", "translation": "dog", "strength": 0.3, "due": true }
            ],
            "edges": []
        }))
        .expect("valid");
        let items = memory_items(&graph);
        assert_eq!(items.len(), 3);
        // Vocab before grammar; within vocab, due (perro) before not-due (casa).
        assert_eq!(items[0].kind, "vocab");
        assert_eq!(items[0].label, "perro");
        assert!(items[0].due);
        assert_eq!(items[0].mastery, 30);
        assert_eq!(items[1].label, "casa");
        assert_eq!(items[1].translation.as_deref(), Some("house"));
        assert_eq!(items[2].kind, "grammar");
    }

    #[test]
    fn config_view_maps_self_hosted_owner_and_infra() {
        let resp: types::OnboardingConfigResponse = serde_json::from_value(serde_json::json!({
            "selfHosted": true, "isOwner": true,
            "infra": {
                "aiProvider": "openai", "aiModel": "gpt-5", "aiBaseUrl": null,
                "sttProvider": "whisper", "sttBaseUrl": null, "sttModel": null,
                "ttsProvider": "elevenlabs", "ttsBaseUrl": null,
                "storageProvider": "r2", "s3Bucket": "sotto", "s3Region": "auto"
            }
        }))
        .expect("valid");
        let view = ConfigView::from(&resp);
        assert!(view.self_hosted);
        assert!(view.is_owner);
        let infra = view.infra.expect("infra present for owner");
        assert_eq!(infra.ai_provider.as_deref(), Some("openai"));
        assert_eq!(infra.tts_provider.as_deref(), Some("elevenlabs"));
        assert_eq!(infra.storage_provider.as_deref(), Some("r2"));
    }

    #[test]
    fn config_view_has_no_infra_when_not_owner() {
        let resp: types::OnboardingConfigResponse = serde_json::from_value(serde_json::json!({
            "selfHosted": true, "isOwner": false, "infra": null
        }))
        .expect("valid");
        let view = ConfigView::from(&resp);
        assert!(view.infra.is_none());
    }

    // --- P6e: adaptive-listening Q&A ---------------------------------------

    fn interaction(json: serde_json::Value) -> types::InteractionResponse {
        serde_json::from_value(json).expect("valid InteractionResponse JSON")
    }

    #[test]
    fn pending_interaction_keeps_polling() {
        let resp = interaction(serde_json::json!({
            "id": "i0", "question": "?", "timestamp": 0,
            "status": "PENDING", "answer": null, "helpful": null, "segmentOrder": null
        }));
        let phase = reduce_interaction_poll("i0", &resp);
        assert_eq!(
            phase,
            AskPhase::Polling {
                interaction_id: "i0".into()
            }
        );
        assert!(!ask_is_terminal(&phase));
    }

    #[test]
    fn answering_interaction_keeps_polling() {
        // ANSWERING (mid-generation) is not terminal.
        let resp = interaction(serde_json::json!({
            "id": "i0", "question": "?", "timestamp": 0,
            "status": "ANSWERING", "answer": null, "helpful": null, "segmentOrder": null
        }));
        let phase = reduce_interaction_poll("i0", &resp);
        assert!(matches!(phase, AskPhase::Polling { .. }));
    }

    #[test]
    fn answered_interaction_yields_the_answer_text() {
        let resp = interaction(serde_json::json!({
            "id": "i0", "question": "What is 'casa'?", "timestamp": 12.5,
            "status": "ANSWERED", "answer": "It means house.", "helpful": null, "segmentOrder": 2
        }));
        let phase = reduce_interaction_poll("i0", &resp);
        match &phase {
            AskPhase::Answered {
                answer,
                answer_audio,
            } => {
                assert_eq!(answer, "It means house.");
                // The episode-interact route is text-only.
                assert!(answer_audio.is_none());
            }
            other => panic!("expected Answered, got {other:?}"),
        }
        assert!(ask_is_terminal(&phase));
    }

    #[test]
    fn answered_without_answer_text_is_treated_as_failed() {
        // A terminal status with no answer text -> Failed (defensive).
        let resp = interaction(serde_json::json!({
            "id": "i0", "question": "?", "timestamp": 0,
            "status": "ANSWERED", "answer": null, "helpful": null, "segmentOrder": null
        }));
        let phase = reduce_interaction_poll("i0", &resp);
        assert!(matches!(phase, AskPhase::Failed { .. }));
        assert!(ask_is_terminal(&phase));
    }

    #[test]
    fn ask_state_open_close_resets_the_question() {
        let mut ask = AskState::opened();
        assert!(ask.open);
        for c in "hola".chars() {
            ask.input.push_char(c);
        }
        assert_eq!(ask.input.text(), "hola");
        // Re-opening starts a fresh, empty question (each ask is independent).
        ask = AskState::opened();
        assert!(ask.input.is_empty());
        assert_eq!(ask.phase, AskPhase::Editing);
        ask = AskState::closed();
        assert!(!ask.open);
    }
