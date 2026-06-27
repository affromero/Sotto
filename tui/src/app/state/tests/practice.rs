    use super::*;

    fn item(id: &str, options: &[&str]) -> VocabItem {
        VocabItem {
            id: id.to_string(),
            prompt: format!("prompt for {id}"),
            options: options.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn course() -> Course {
        Course {
            id: "c1".into(),
            title: "Spanish".into(),
            native_lang: "en".into(),
            target_lang: "es".into(),
            current_level: "A2".into(),
            placement_source: None,
        }
    }

    fn course_home() -> View {
        View::CourseHome {
            course: course(),
            due: DueCounts {
                vocab: 4,
                grammar: 0,
                total_vocab: 12,
            },
            menu_cursor: 0,
            notice: None,
            starting: false,
        }
    }

    /// Deserialize a `StartPracticeResponse` from JSON. The generated type is a
    /// `status`-discriminated union, so this exercises the real decoder rather
    /// than hand-constructing variants.
    fn start_response(json: serde_json::Value) -> types::StartPracticeResponse {
        serde_json::from_value(json).expect("valid StartPracticeResponse JSON")
    }

    #[test]
    fn answering_a_non_final_item_advances() {
        let items = vec![item("v1", &["a", "b"]), item("v2", &["c", "d"])];
        let mut selected = vec![None; items.len()];

        let step = answer_current(&items, &mut selected, 0, 1);

        assert!(matches!(step, AnswerStep::Advanced));
        assert_eq!(selected, vec![Some(1), None]);
    }

    #[test]
    fn answering_the_final_item_yields_a_submit_payload() {
        let items = vec![item("v1", &["a", "b"]), item("v2", &["c", "d"])];
        let mut selected = vec![Some(0), None];

        let step = answer_current(&items, &mut selected, 1, 1);

        match step {
            AnswerStep::Submit(Ok(answers)) => {
                assert_eq!(answers.len(), 2);
                assert_eq!(&*answers[0].item_id, "v1");
                assert_eq!(answers[0].selected_index, 0);
                assert_eq!(&*answers[1].item_id, "v2");
                assert_eq!(answers[1].selected_index, 1);
            }
            other => panic!("expected Submit(Ok), got {other:?}"),
        }
    }

    #[test]
    fn build_answers_skips_unanswered_items() {
        let items = vec![
            item("v1", &["a", "b"]),
            item("v2", &["c", "d"]),
            item("v3", &["e", "f"]),
        ];
        // Only the first and third items were answered.
        let selected = vec![Some(1), None, Some(0)];

        let answers = build_answers(&items, &selected).expect("valid ids");

        assert_eq!(answers.len(), 2);
        assert_eq!(&*answers[0].item_id, "v1");
        assert_eq!(answers[0].selected_index, 1);
        assert_eq!(&*answers[1].item_id, "v3");
        assert_eq!(answers[1].selected_index, 0);
    }

    #[test]
    fn build_answers_errors_on_an_answered_item_with_an_invalid_id() {
        // The id newtype rejects empty strings (minLength: 1). An *answered*
        // item with such an id must error, not be silently dropped.
        let items = vec![item("v1", &["a", "b"]), item("", &["c", "d"])];
        let selected = vec![Some(0), Some(1)];

        let result = build_answers(&items, &selected);

        assert!(result.is_err(), "expected an error, got {result:?}");
    }

    #[test]
    fn start_items_seeds_one_selection_slot_per_item() {
        let items = vec![item("v1", &["a", "b"]), item("v2", &["c", "d"])];

        let view = View::start_items(course(), ReviewKind::Vocab, "sess-1".into(), items.clone());

        match view {
            View::ItemReview {
                kind,
                index,
                cursor,
                prompt_scroll,
                selected,
                items: view_items,
                session_id,
                ..
            } => {
                assert_eq!(kind, ReviewKind::Vocab);
                assert_eq!(index, 0);
                assert_eq!(cursor, 0);
                assert_eq!(prompt_scroll, 0);
                assert_eq!(session_id, "sess-1");
                assert_eq!(view_items, items);
                assert_eq!(selected, vec![None, None]);
            }
            other => panic!("expected ItemReview, got {other:?}"),
        }
    }

    #[test]
    fn can_review_vocab_requires_due_or_tracked_vocab() {
        assert!(!can_review_vocab(&DueCounts::default()));
        assert!(can_review_vocab(&DueCounts {
            vocab: 3,
            grammar: 0,
            total_vocab: 0,
        }));
        assert!(can_review_vocab(&DueCounts {
            vocab: 0,
            grammar: 0,
            total_vocab: 10,
        }));
        // Grammar-only due does not enable the vocab review.
        assert!(!can_review_vocab(&DueCounts {
            vocab: 0,
            grammar: 5,
            total_vocab: 0,
        }));
    }

    #[test]
    fn unavailable_maps_reason_to_a_clear_message() {
        let cases = [
            (
                types::StartPracticeUnavailableReason::NotEnoughVocab,
                Unavailable::NotEnoughVocab,
            ),
            (
                types::StartPracticeUnavailableReason::NothingDue,
                Unavailable::NothingDue,
            ),
            (
                types::StartPracticeUnavailableReason::NoContent,
                Unavailable::NoContent,
            ),
        ];
        for (reason, expected) in cases {
            let mapped = Unavailable::from(reason);
            assert_eq!(mapped, expected);
            assert!(!mapped.message().is_empty());
        }
    }

    #[test]
    fn option_cursor_clamps_at_bounds() {
        assert_eq!(cursor_up(0), 0);
        assert_eq!(cursor_up(2), 1);
        assert_eq!(cursor_down(0, 3), 1);
        assert_eq!(cursor_down(2, 3), 2); // already at last option
        assert_eq!(cursor_down(0, 0), 0); // no options
    }

    #[test]
    fn list_cursor_clamps_at_bounds() {
        assert_eq!(list_up(0), 0);
        assert_eq!(list_up(2), 1);
        assert_eq!(list_down(0, 3), 1);
        assert_eq!(list_down(2, 3), 2);
        assert_eq!(list_down(0, 0), 0);
    }

    #[test]
    fn ready_start_response_enters_vocab_review() {
        let resp = start_response(serde_json::json!({
            "status": "ready",
            "sessionId": "sess-42",
            "kind": "VOCAB",
            "items": [
                { "id": "v1", "prompt": "casa", "options": ["house", "dog"] },
                { "id": "v2", "prompt": "perro", "options": ["cat", "dog"] }
            ]
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::ItemReview {
                kind,
                session_id,
                items,
                index,
                cursor,
                selected,
                ..
            } => {
                assert_eq!(kind, ReviewKind::Vocab);
                assert_eq!(session_id, "sess-42");
                assert_eq!(items.len(), 2);
                assert_eq!(items[0].prompt, "casa");
                assert_eq!(index, 0);
                assert_eq!(cursor, 0);
                assert_eq!(selected, vec![None, None]);
            }
            other => panic!("expected ItemReview, got {other:?}"),
        }
    }

    #[test]
    fn unavailable_start_response_stays_on_course_home_with_reason() {
        let resp = start_response(serde_json::json!({
            "status": "unavailable",
            "reason": "nothing_due"
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::CourseHome { notice, due, .. } => {
                assert_eq!(notice, Some(Unavailable::NothingDue));
                // Due counts are preserved across the failed start.
                assert_eq!(due.vocab, 4);
                assert_eq!(due.total_vocab, 12);
            }
            other => panic!("expected CourseHome, got {other:?}"),
        }
    }

    #[test]
    fn empty_ready_start_response_is_treated_as_malformed() {
        let resp = start_response(serde_json::json!({
            "status": "ready",
            "sessionId": "sess-empty",
            "kind": "VOCAB",
            "items": []
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::CourseHome { notice, .. } => {
                assert_eq!(notice, Some(Unavailable::Malformed));
            }
            other => panic!("expected CourseHome, got {other:?}"),
        }
    }

    #[test]
    fn ready_with_a_zero_option_item_is_rejected_as_malformed() {
        // A zero-option item would let Enter fabricate an answer; reject it at
        // ingestion instead of entering the review.
        let resp = start_response(serde_json::json!({
            "status": "ready",
            "sessionId": "sess-bad",
            "kind": "VOCAB",
            "items": [
                { "id": "v1", "prompt": "casa", "options": ["house", "dog"] },
                { "id": "v2", "prompt": "perro", "options": [] }
            ]
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::CourseHome { notice, .. } => {
                assert_eq!(notice, Some(Unavailable::Malformed));
            }
            other => panic!("expected CourseHome (malformed), got {other:?}"),
        }
    }

    #[test]
    fn unhandled_ready_kind_routes_to_not_in_terminal_notice_not_review() {
        // VOCAB/GRAMMAR/READING -> ItemReview and LISTENING -> ListeningReview;
        // any other kind arriving as a plain `ready` (defensive — WRITING comes
        // via ready_writing) stays on CourseHome with a clear notice rather than
        // entering a review.
        let resp = start_response(serde_json::json!({
            "status": "ready",
            "sessionId": "sess-writing",
            "kind": "WRITING",
            "items": []
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::CourseHome { notice, .. } => match notice {
                Some(Unavailable::NotInTerminal(skill)) => assert_eq!(skill, "Writing"),
                other => panic!("expected NotInTerminal notice, got {other:?}"),
            },
            other => panic!("expected CourseHome, got {other:?}"),
        }
    }

    #[test]
    fn start_response_is_ignored_when_not_on_course_home() {
        // The learner navigated to the course list before the response landed.
        let view = View::courses(&[]);
        let resp = start_response(serde_json::json!({
            "status": "unavailable",
            "reason": "no_content"
        }));

        let next = reduce_start(view.clone(), &resp);

        assert_eq!(next, view);
    }

    fn poll_response(json: serde_json::Value) -> types::SpeakingPollResponse {
        serde_json::from_value(json).expect("valid SpeakingPollResponse JSON")
    }

    #[test]
    fn listening_ready_enters_listening_review_with_episode_id() {
        let resp = start_response(serde_json::json!({
            "status": "ready",
            "sessionId": "sess-listen",
            "kind": "LISTENING",
            "episodeId": "ep-1",
            "items": [
                { "id": "q1", "prompt": "What did they order?", "options": ["café", "té"] }
            ]
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::ListeningReview {
                session_id,
                episode_id,
                episode,
                items,
                selected,
                ..
            } => {
                assert_eq!(session_id, "sess-listen");
                assert_eq!(episode_id, "ep-1");
                assert!(episode.is_none(), "episode loads separately");
                assert_eq!(items.len(), 1);
                assert_eq!(selected, vec![None]);
            }
            other => panic!("expected ListeningReview, got {other:?}"),
        }
    }

    #[test]
    fn listening_ready_with_no_episode_id_is_malformed() {
        let resp = start_response(serde_json::json!({
            "status": "ready",
            "sessionId": "sess-listen",
            "kind": "LISTENING",
            "items": []
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::CourseHome { notice, .. } => {
                assert_eq!(notice, Some(Unavailable::Malformed));
            }
            other => panic!("expected CourseHome (malformed), got {other:?}"),
        }
    }

    #[test]
    fn listening_transcript_only_with_no_items_is_allowed() {
        let resp = start_response(serde_json::json!({
            "status": "ready",
            "sessionId": "sess-listen",
            "kind": "LISTENING",
            "episodeId": "ep-2",
            "items": []
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::ListeningReview { items, .. } => assert!(items.is_empty()),
            other => panic!("expected ListeningReview, got {other:?}"),
        }
    }

    #[test]
    fn speaking_ready_enters_speaking_review_idle() {
        let resp = start_response(serde_json::json!({
            "status": "ready_speaking",
            "sessionId": "sess-speak",
            "prompts": [
                {
                    "id": "p1",
                    "targetPhrase": "Buenos días",
                    "translation": "Good morning",
                    "referenceTtsUrl": null
                }
            ]
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::SpeakingReview {
                session_id,
                prompts,
                index,
                phase,
                ..
            } => {
                assert_eq!(session_id, "sess-speak");
                assert_eq!(prompts.len(), 1);
                assert_eq!(prompts[0].target_phrase, "Buenos días");
                assert_eq!(index, 0);
                assert_eq!(phase, SpeakingPhase::Idle);
            }
            other => panic!("expected SpeakingReview, got {other:?}"),
        }
    }

    #[test]
    fn empty_speaking_ready_is_malformed() {
        let resp = start_response(serde_json::json!({
            "status": "ready_speaking",
            "sessionId": "sess-speak",
            "prompts": []
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::CourseHome { notice, .. } => {
                assert_eq!(notice, Some(Unavailable::Malformed));
            }
            other => panic!("expected CourseHome (malformed), got {other:?}"),
        }
    }

    #[test]
    fn writing_ready_routes_to_not_in_terminal() {
        let resp = start_response(serde_json::json!({
            "status": "ready_writing",
            "sessionId": "sess-write",
            "prompts": [{ "id": "w1", "task": "Describe your day", "guidance": null }]
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::CourseHome { notice, .. } => match notice {
                Some(Unavailable::NotInTerminal(skill)) => assert_eq!(skill, "Writing"),
                other => panic!("expected NotInTerminal, got {other:?}"),
            },
            other => panic!("expected CourseHome, got {other:?}"),
        }
    }

    #[test]
    fn speaking_poll_pending_stays_polling() {
        let resp = poll_response(serde_json::json!({
            "status": "PENDING",
            "overallScore": null,
            "transcript": null,
            "feedback": null
        }));

        let phase = reduce_speaking_poll("rec-1", &resp);

        assert_eq!(
            phase,
            SpeakingPhase::Polling {
                recording_id: "rec-1".into()
            }
        );
        assert!(!poll_is_terminal(&phase));
    }

    #[test]
    fn speaking_poll_scored_becomes_graded_percent() {
        let resp = poll_response(serde_json::json!({
            "status": "SCORED",
            "overallScore": 0.834,
            "transcript": "Buenos días",
            "feedback": "Nice rhythm."
        }));

        let phase = reduce_speaking_poll("rec-1", &resp);

        match &phase {
            SpeakingPhase::Graded {
                score,
                transcript,
                feedback,
            } => {
                assert_eq!(*score, Some(83), "0.834 -> 83%");
                assert_eq!(transcript.as_deref(), Some("Buenos días"));
                assert_eq!(feedback.as_deref(), Some("Nice rhythm."));
            }
            other => panic!("expected Graded, got {other:?}"),
        }
        assert!(poll_is_terminal(&phase));
    }

    #[test]
    fn speaking_poll_failed_becomes_failed() {
        let resp = poll_response(serde_json::json!({
            "status": "FAILED",
            "overallScore": null,
            "transcript": null,
            "feedback": null
        }));

        let phase = reduce_speaking_poll("rec-1", &resp);

        assert!(matches!(phase, SpeakingPhase::Failed { .. }));
        assert!(poll_is_terminal(&phase));
    }

    // --- P6a: grammar + reading multiple-choice review --------------------

    #[test]
    fn grammar_ready_enters_item_review_with_grammar_kind() {
        let resp = start_response(serde_json::json!({
            "status": "ready",
            "sessionId": "sess-gram",
            "kind": "GRAMMAR",
            "items": [
                { "id": "q0", "prompt": "Choose the correct article", "options": ["el", "la"] }
            ]
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::ItemReview {
                kind,
                session_id,
                items,
                prompt_scroll,
                ..
            } => {
                assert_eq!(kind, ReviewKind::Grammar);
                assert_eq!(session_id, "sess-gram");
                assert_eq!(items.len(), 1);
                assert_eq!(prompt_scroll, 0);
            }
            other => panic!("expected ItemReview, got {other:?}"),
        }
    }

    #[test]
    fn reading_ready_enters_item_review_and_keeps_the_passage_prompt() {
        // READING folds the passage into each question's prompt (the route does
        // not surface a separate passage field); the long prompt must survive.
        let passage = "El gato se sentó en la alfombra. ".repeat(20);
        let prompt = format!("{passage}\n\nWhat sat on the rug?");
        let resp = start_response(serde_json::json!({
            "status": "ready",
            "sessionId": "sess-read",
            "kind": "READING",
            "items": [
                { "id": "q0", "prompt": prompt, "options": ["el gato", "el perro"] }
            ]
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::ItemReview { kind, items, .. } => {
                assert_eq!(kind, ReviewKind::Reading);
                // The full passage text is preserved in the item prompt.
                assert!(items[0].prompt.contains("alfombra"));
                assert!(items[0].prompt.contains("What sat on the rug?"));
            }
            other => panic!("expected ItemReview, got {other:?}"),
        }
    }

    #[test]
    fn grammar_ready_with_a_zero_option_item_is_malformed() {
        let resp = start_response(serde_json::json!({
            "status": "ready",
            "sessionId": "sess-gram",
            "kind": "GRAMMAR",
            "items": [
                { "id": "q0", "prompt": "ok", "options": ["a", "b"] },
                { "id": "q1", "prompt": "broken", "options": [] }
            ]
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::CourseHome { notice, .. } => assert_eq!(notice, Some(Unavailable::Malformed)),
            other => panic!("expected CourseHome (malformed), got {other:?}"),
        }
    }

    #[test]
    fn empty_grammar_ready_is_malformed() {
        let resp = start_response(serde_json::json!({
            "status": "ready",
            "sessionId": "sess-gram",
            "kind": "GRAMMAR",
            "items": []
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::CourseHome { notice, .. } => assert_eq!(notice, Some(Unavailable::Malformed)),
            other => panic!("expected CourseHome (malformed), got {other:?}"),
        }
    }

    #[test]
    fn submitting_a_reading_session_builds_the_answer_payload() {
        // A grammar/reading session submits via the same answer flow as vocab:
        // answering the last item yields the submit payload from selections.
        let items = vec![item("q0", &["a", "b"]), item("q1", &["c", "d"])];
        let mut selected = vec![Some(0), None];

        let step = answer_current(&items, &mut selected, 1, 1);

        match step {
            AnswerStep::Submit(Ok(answers)) => {
                assert_eq!(answers.len(), 2);
                assert_eq!(&*answers[0].item_id, "q0");
                assert_eq!(answers[0].selected_index, 0);
                assert_eq!(&*answers[1].item_id, "q1");
                assert_eq!(answers[1].selected_index, 1);
            }
            other => panic!("expected Submit(Ok), got {other:?}"),
        }
    }

    #[test]
    fn skill_choice_kinds_map_to_practice_kinds() {
        assert_eq!(SkillChoice::Grammar.kind(), types::PracticeKind::Grammar);
        assert_eq!(SkillChoice::Reading.kind(), types::PracticeKind::Reading);
        // Grammar + Reading are now wired into the menu (5 entries).
        assert_eq!(SkillChoice::MENU.len(), 5);
        assert!(SkillChoice::MENU.contains(&SkillChoice::Grammar));
        assert!(SkillChoice::MENU.contains(&SkillChoice::Reading));
    }

    // --- P6b: classes ------------------------------------------------------
