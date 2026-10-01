    fn class_response(mut json: serde_json::Value) -> types::ClassDetailResponse {
        if let Some(obj) = json.as_object_mut() {
            obj.entry("courseId")
                .or_insert_with(|| serde_json::json!("course1"));
        }
        serde_json::from_value(json).expect("valid ClassDetailResponse JSON")
    }

    /// A class with one section of each kind, in a fixed order, for walk tests.
    fn mixed_class() -> types::ClassDetailResponse {
        class_response(serde_json::json!({
            "id": "cls1",
            "status": "IN_PROGRESS",
            "order": 1,
            "passThreshold": 0.7,
            "submitted": false,
            "sections": [
                {
                    "id": "sec-g", "skill": "GRAMMAR", "status": "READY",
                    "episode": null, "prompts": [], "writingPrompts": [],
                    "questions": [
                        { "id": "g0", "order": 0, "question": "Article?", "options": ["el", "la"], "passageRef": null, "passageText": null }
                    ]
                },
                {
                    "id": "sec-r", "skill": "READING", "status": "READY",
                    "episode": null, "prompts": [], "writingPrompts": [],
                    "questions": [
                        { "id": "r0", "order": 0, "question": "What?", "options": ["a", "b"], "passageRef": null, "passageText": "Long passage here." }
                    ]
                },
                {
                    "id": "sec-l", "skill": "LISTENING", "status": "READY",
                    "episode": { "id": "ep1", "audioUrl": "https://cdn/ep1.mp3", "title": "Cafe", "references": [] },
                    "prompts": [], "writingPrompts": [],
                    "questions": [
                        { "id": "l0", "order": 0, "question": "Heard?", "options": ["x", "y"], "passageRef": null, "passageText": null }
                    ]
                },
                {
                    "id": "sec-s", "skill": "SPEAKING", "status": "READY",
                    "episode": null, "questions": [], "writingPrompts": [],
                    "prompts": [
                        { "id": "s0", "order": 0, "targetPhrase": "Hola", "translation": "Hi", "ipa": null, "referenceTtsUrl": null }
                    ]
                },
                {
                    "id": "sec-w", "skill": "WRITING", "status": "READY",
                    "episode": null, "questions": [], "prompts": [],
                    "writingPrompts": [
                        { "id": "w0", "order": 0, "task": "Describe", "guidance": null, "response": null }
                    ]
                }
            ]
        }))
    }

    #[test]
    fn class_sections_walk_in_route_order_with_kind_routing() {
        let sections = class_sections(&mixed_class()).expect("well-formed class");
        assert_eq!(sections.len(), 5);
        // Order preserved.
        let ids: Vec<&str> = sections.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["sec-g", "sec-r", "sec-l", "sec-s", "sec-w"]);
        // Each section routed to the right progress variant by skill.
        assert!(matches!(sections[0].progress, SectionProgress::Mc { .. }));
        assert!(matches!(sections[1].progress, SectionProgress::Mc { .. }));
        assert!(matches!(
            sections[2].progress,
            SectionProgress::Listening { .. }
        ));
        assert!(matches!(
            sections[3].progress,
            SectionProgress::Speaking { .. }
        ));
        assert!(matches!(
            sections[4].progress,
            SectionProgress::Writing { .. }
        ));
    }

    #[test]
    fn reading_section_prepends_the_passage_to_the_prompt() {
        let sections = class_sections(&mixed_class()).expect("well-formed");
        if let SectionProgress::Mc { questions, .. } = &sections[1].progress {
            assert!(questions[0].prompt.contains("Long passage here."));
            assert!(questions[0].prompt.contains("What?"));
        } else {
            panic!("reading section should be Mc");
        }
    }

    #[test]
    fn class_resume_restores_choices_drafts_corrections_and_pending_recording() {
        let mut value = serde_json::to_value(mixed_class()).unwrap();
        value["learnerAnswers"] = serde_json::json!({ "g0": 1, "r0": 0, "l0": 1 });
        value["writingDrafts"] = serde_json::json!({ "w0": "Hola.\n" });
        value["sections"][3]["prompts"][0]["latestRecording"] = serde_json::json!({
            "id": "recording-saved", "status": "GRADING"
        });
        value["sections"][4]["writingPrompts"][0]["response"] = serde_json::json!({
            "text": "Hola.", "overallScore": 0.8, "feedback": "A clear greeting.",
            "corrections": [{ "old": "Hola", "new": "Buenos días", "why": "Use a formal greeting." }]
        });
        let cls = class_response(value);
        let sections = class_sections(&cls).unwrap();
        assert_eq!(collect_class_answers(&sections).len(), 3);
        assert!(matches!(&sections[0].progress, SectionProgress::Mc { selected, .. } if selected == &[Some(1)]));
        assert!(matches!(&sections[3].progress, SectionProgress::Speaking {
            phase: SpeakingPhase::Polling { recording_id }, .. } if recording_id == "recording-saved"));
        assert!(matches!(&sections[4].progress, SectionProgress::Writing {
            input, phase: WritingPhase::Graded { score: 80, feedback }, .. }
            if input.text().ends_with('\n') && feedback.contains("Use a formal greeting.")));
        assert!(!class_ready_to_submit(&sections));
    }

    #[test]
    fn class_resume_keeps_an_edited_draft_ungraded() {
        let mut value = serde_json::to_value(mixed_class()).unwrap();
        value["writingDrafts"] = serde_json::json!({ "w0": "My new answer." });
        value["sections"][4]["writingPrompts"][0]["response"] = serde_json::json!({
            "text": "An earlier answer.", "overallScore": 0.9, "feedback": "Earlier feedback.", "corrections": []
        });
        let sections = class_sections(&class_response(value)).unwrap();
        assert!(matches!(&sections[4].progress, SectionProgress::Writing { input, phase: WritingPhase::Editing, .. }
            if input.text() == "My new answer."));
    }

    #[test]
    fn empty_class_is_malformed() {
        let cls = class_response(serde_json::json!({
            "id": "c", "status": "IN_PROGRESS", "order": 1, "passThreshold": 0.7,
            "submitted": false, "sections": []
        }));
        assert!(class_sections(&cls).is_none());
    }

    #[test]
    fn class_with_a_zero_option_question_is_malformed() {
        let cls = class_response(serde_json::json!({
            "id": "c", "status": "IN_PROGRESS", "order": 1, "passThreshold": 0.7,
            "submitted": false,
            "sections": [{
                "id": "sec-g", "skill": "GRAMMAR", "status": "READY",
                "episode": null, "prompts": [], "writingPrompts": [],
                "questions": [
                    { "id": "g0", "order": 0, "question": "ok", "options": ["a", "b"], "passageRef": null, "passageText": null },
                    { "id": "g1", "order": 1, "question": "broken", "options": [], "passageRef": null, "passageText": null }
                ]
            }]
        }));
        assert!(class_sections(&cls).is_none());
    }

    /// A one-section class with the given skill and content overrides, for
    /// per-skill emptiness checks.
    fn single_section_class(section: serde_json::Value) -> types::ClassDetailResponse {
        class_response(serde_json::json!({
            "id": "c", "status": "IN_PROGRESS", "order": 1, "passThreshold": 0.7,
            "submitted": false, "sections": [section]
        }))
    }

    #[test]
    fn empty_grammar_section_is_malformed() {
        let cls = single_section_class(serde_json::json!({
            "id": "sec-g", "skill": "GRAMMAR", "status": "READY",
            "episode": null, "prompts": [], "writingPrompts": [], "questions": []
        }));
        assert!(class_sections(&cls).is_none());
    }

    #[test]
    fn empty_reading_section_is_malformed() {
        let cls = single_section_class(serde_json::json!({
            "id": "sec-r", "skill": "READING", "status": "READY",
            "episode": null, "prompts": [], "writingPrompts": [], "questions": []
        }));
        assert!(class_sections(&cls).is_none());
    }

    #[test]
    fn listening_section_without_an_episode_is_malformed() {
        let cls = single_section_class(serde_json::json!({
            "id": "sec-l", "skill": "LISTENING", "status": "READY",
            "episode": null, "prompts": [], "writingPrompts": [], "questions": []
        }));
        assert!(class_sections(&cls).is_none());
    }

    #[test]
    fn listening_section_with_episode_and_no_questions_is_valid_transcript_only() {
        let cls = single_section_class(serde_json::json!({
            "id": "sec-l", "skill": "LISTENING", "status": "READY",
            "episode": { "id": "ep1", "audioUrl": "https://cdn/ep1.mp3", "title": "Cafe", "references": [] },
            "prompts": [], "writingPrompts": [], "questions": []
        }));
        let sections = class_sections(&cls).expect("transcript-only listening is valid");
        assert!(matches!(
            sections[0].progress,
            SectionProgress::Listening { .. }
        ));
    }

    #[test]
    fn empty_speaking_section_is_malformed() {
        let cls = single_section_class(serde_json::json!({
            "id": "sec-s", "skill": "SPEAKING", "status": "READY",
            "episode": null, "questions": [], "writingPrompts": [], "prompts": []
        }));
        assert!(class_sections(&cls).is_none());
    }

    #[test]
    fn empty_writing_section_is_malformed() {
        let cls = single_section_class(serde_json::json!({
            "id": "sec-w", "skill": "WRITING", "status": "READY",
            "episode": null, "questions": [], "prompts": [], "writingPrompts": []
        }));
        assert!(class_sections(&cls).is_none());
    }

    #[test]
    fn collect_class_answers_aggregates_answered_mc_across_sections() {
        let mut sections = class_sections(&mixed_class()).expect("well-formed");
        // Answer the grammar (g0 -> 1), reading (r0 -> 0), and listening (l0 -> 1)
        // MC questions; speaking/writing contribute nothing to the MC payload.
        for s in sections.iter_mut() {
            match &mut s.progress {
                SectionProgress::Mc { selected, .. }
                | SectionProgress::Listening { selected, .. } => {
                    selected[0] = Some(if s.id == "sec-r" { 0 } else { 1 });
                }
                _ => {}
            }
        }
        let answers = collect_class_answers(&sections);
        assert_eq!(answers.len(), 3);
        let by_id: std::collections::HashMap<_, _> = answers
            .iter()
            .map(|a| (a.question_id.clone(), a.selected_index))
            .collect();
        assert_eq!(by_id.get("g0"), Some(&1));
        assert_eq!(by_id.get("r0"), Some(&0));
        assert_eq!(by_id.get("l0"), Some(&1));
    }

    /// Answer every MC/listening question in `sections` (drive them to complete).
    fn answer_all_mc(sections: &mut [ClassSection]) {
        for s in sections.iter_mut() {
            match &mut s.progress {
                SectionProgress::Mc { selected, .. }
                | SectionProgress::Listening { selected, .. } => {
                    for slot in selected.iter_mut() {
                        *slot = Some(0);
                    }
                }
                _ => {}
            }
        }
    }


    fn grade_all_productive(sections: &mut [ClassSection]) {
        for section in sections {
            match &mut section.progress {
                SectionProgress::Speaking { prompts, phase, .. } => {
                    *phase = SpeakingPhase::Graded { score: Some(80), transcript: Some("Answer".into()), feedback: Some("Clear".into()) };
                    for prompt in prompts { section.work.insert(prompt.id.clone(), ProductiveWork::Speaking(phase.clone())); }
                }
                SectionProgress::Writing { prompts, phase, input, .. } => {
                    *input = WritingInput::from_text("My response");
                    *phase = WritingPhase::Graded { score: 75, feedback: "Review verb agreement".into() };
                    for prompt in prompts { section.work.insert(prompt.id.clone(), ProductiveWork::Writing { text: input.text(), phase: phase.clone() }); }
                }
                _ => {},
            }
        }
    }

    #[test]
    fn class_completion_requires_answers_and_every_productive_grade() {
        let mut sections = class_sections(&mixed_class()).expect("well-formed");
        assert!(!class_ready_to_submit(&sections));
        answer_all_mc(&mut sections);
        assert!(!class_ready_to_submit(&sections));
        grade_all_productive(&mut sections);
        assert!(class_ready_to_submit(&sections));
        let speaking = sections.iter_mut().find(|section| section.skill == types::SkillType::Speaking).unwrap();
        if let SectionProgress::Speaking { phase, .. } = &mut speaking.progress { *phase = SpeakingPhase::Idle; }
        assert!(!class_ready_to_submit(&sections), "every productive grade remains required");
    }

    #[test]
    fn speaking_failures_and_missing_scores_cannot_finish_a_class() {
        let mut sections = class_sections(&mixed_class()).expect("well-formed");
        answer_all_mc(&mut sections);
        grade_all_productive(&mut sections);
        for phase in [
            SpeakingPhase::Idle, SpeakingPhase::Recording, SpeakingPhase::Uploading,
            SpeakingPhase::Polling { recording_id: "r".into() },
            SpeakingPhase::Failed { message: "Provider unavailable".into() },
            SpeakingPhase::Graded { score: None, transcript: None, feedback: None },
        ] {
            for section in &mut sections { if let SectionProgress::Speaking { phase: current, .. } = &mut section.progress { *current = phase.clone(); } }
            assert!(!class_ready_to_submit(&sections), "{phase:?}");
        }
    }

    #[test]
    fn writing_errors_and_empty_responses_cannot_finish_a_class() {
        let mut sections = class_sections(&mixed_class()).expect("well-formed");
        answer_all_mc(&mut sections);
        grade_all_productive(&mut sections);
        for phase in [WritingPhase::Editing, WritingPhase::Submitting, WritingPhase::Failed { message: "Provider unavailable".into() }] {
            for section in &mut sections { if let SectionProgress::Writing { phase: current, .. } = &mut section.progress { *current = phase.clone(); } }
            assert!(!class_ready_to_submit(&sections), "{phase:?}");
        }
        grade_all_productive(&mut sections);
        for section in &mut sections { if let SectionProgress::Writing { input, .. } = &mut section.progress { *input = WritingInput::new(); } }
        assert!(!class_ready_to_submit(&sections), "a grade must apply to actual response text");
    }

    #[test]
    fn answer_current_choice_records_and_flags_the_last_question() {
        // Two questions: answering index 0 is not the last; index 1 is.
        let mut selected = vec![None, None];
        assert!(!answer_current_choice(2, &mut selected, 0, 1));
        assert_eq!(selected, vec![Some(1), None]);
        assert!(answer_current_choice(2, &mut selected, 1, 0));
        assert_eq!(selected, vec![Some(1), Some(0)]);
    }

    #[test]
    fn class_result_converts_score_to_percent() {
        let resp: types::SubmitClassResponse = serde_json::from_value(serde_json::json!({
            "passed": true, "overallScore": 0.8, "passedSections": 4, "totalSections": 5,
            "sections": []
        }))
        .expect("valid");
        let result = ClassResult::from(&resp);
        assert!(result.passed);
        assert_eq!(result.overall_score, 80);
        assert_eq!(result.passed_sections, 4);
        assert_eq!(result.total_sections, 5);
    }

    #[test]
    fn writing_input_captures_lines_and_backspace() {
        let mut input = WritingInput::new();
        for c in "hola".chars() {
            input.push_char(c);
        }
        input.newline();
        for c in "mundo".chars() {
            input.push_char(c);
        }
        assert_eq!(input.text(), "hola\nmundo");
        assert!(!input.is_empty());
        // Backspace within a line, then across the line boundary.
        input.backspace(); // mund
        assert_eq!(input.text(), "hola\nmund");
        for _ in 0..4 {
            input.backspace();
        }
        // The now-empty second line is removed on the next backspace.
        input.backspace();
        assert_eq!(input.text(), "hola");
    }

    #[test]
    fn empty_writing_input_is_empty() {
        let input = WritingInput::new();
        assert!(input.is_empty());
        assert_eq!(input.text(), "");
    }

    // --- P6c: exams --------------------------------------------------------

    fn exam_response(json: serde_json::Value) -> types::ExamDetailResponse {
        serde_json::from_value(json).expect("valid ExamDetailResponse JSON")
    }

    /// An exam with one section of each kind, in a fixed order.
    fn mixed_exam() -> types::ExamDetailResponse {
        exam_response(serde_json::json!({
            "id": "exam1", "institution": "CEFR_GENERIC", "institutionLabel": "CEFR",
            "level": "B1", "status": "IN_PROGRESS", "examName": "Mock B1", "result": null,
            "sections": [
                { "id": "ex-g", "skill": "GRAMMAR", "part": "P1", "order": 0, "format": "mc", "weight": 0.25, "status": "READY", "score": null,
                  "episode": null, "speakingPrompts": [], "writingPrompts": [],
                  "questions": [{ "id": "g0", "order": 0, "question": "Article?", "options": ["el","la"], "passageRef": null, "passageText": null }] },
                { "id": "ex-r", "skill": "READING", "part": "P2", "order": 1, "format": "mc", "weight": 0.25, "status": "READY", "score": null,
                  "episode": null, "speakingPrompts": [], "writingPrompts": [],
                  "questions": [{ "id": "r0", "order": 0, "question": "What?", "options": ["a","b"], "passageRef": null, "passageText": "Passage." }] },
                { "id": "ex-l", "skill": "LISTENING", "part": "P3", "order": 2, "format": "mc", "weight": 0.2, "status": "READY", "score": null,
                  "episode": { "id": "ep1", "audioUrl": "https://cdn/ep1.mp3", "status": "READY" },
                  "speakingPrompts": [], "writingPrompts": [],
                  "questions": [{ "id": "l0", "order": 0, "question": "Heard?", "options": ["x","y"], "passageRef": null, "passageText": null }] },
                { "id": "ex-s", "skill": "SPEAKING", "part": "P4", "order": 3, "format": "oral", "weight": 0.15, "status": "READY", "score": null,
                  "episode": null, "questions": [], "writingPrompts": [],
                  "speakingPrompts": [{ "id": "s0", "order": 0, "targetPhrase": "Hola", "translation": "Hi", "referenceTtsUrl": null }] },
                { "id": "ex-w", "skill": "WRITING", "part": "P5", "order": 4, "format": "essay", "weight": 0.15, "status": "READY", "score": null,
                  "episode": null, "questions": [], "speakingPrompts": [],
                  "writingPrompts": [{ "id": "w0", "order": 0, "task": "Describe", "guidance": null }] }
            ]
        }))
    }

    #[test]
    fn exam_sections_walk_in_order_with_kind_routing() {
        let sections = exam_sections(&mixed_exam()).expect("well-formed exam");
        assert_eq!(sections.len(), 5);
        let ids: Vec<&str> = sections.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["ex-g", "ex-r", "ex-l", "ex-s", "ex-w"]);
        assert!(matches!(sections[0].progress, SectionProgress::Mc { .. }));
        assert!(matches!(sections[1].progress, SectionProgress::Mc { .. }));
        assert!(matches!(
            sections[2].progress,
            SectionProgress::Listening { .. }
        ));
        assert!(matches!(
            sections[3].progress,
            SectionProgress::Speaking { .. }
        ));
        assert!(matches!(
            sections[4].progress,
            SectionProgress::Writing { .. }
        ));
    }

    #[test]
    fn empty_exam_is_malformed() {
        let exam = exam_response(serde_json::json!({
            "id": "e", "institution": "CEFR_GENERIC", "institutionLabel": "CEFR",
            "level": "B1", "status": "IN_PROGRESS", "examName": "M", "result": null, "sections": []
        }));
        assert!(exam_sections(&exam).is_none());
    }

    #[test]
    fn exam_section_with_a_zero_option_question_is_malformed() {
        let exam = exam_response(serde_json::json!({
            "id": "e", "institution": "CEFR_GENERIC", "institutionLabel": "CEFR",
            "level": "B1", "status": "IN_PROGRESS", "examName": "M", "result": null,
            "sections": [{
                "id": "ex-g", "skill": "GRAMMAR", "part": "P1", "order": 0, "format": "mc", "weight": 1.0, "status": "READY", "score": null,
                "episode": null, "speakingPrompts": [], "writingPrompts": [],
                "questions": [{ "id": "g0", "order": 0, "question": "broken", "options": [], "passageRef": null, "passageText": null }]
            }]
        }));
        assert!(exam_sections(&exam).is_none());
    }

    #[test]
    fn empty_speaking_exam_section_is_malformed() {
        let exam = exam_response(serde_json::json!({
            "id": "e", "institution": "CEFR_GENERIC", "institutionLabel": "CEFR",
            "level": "B1", "status": "IN_PROGRESS", "examName": "M", "result": null,
            "sections": [{
                "id": "ex-s", "skill": "SPEAKING", "part": "P4", "order": 0, "format": "oral", "weight": 1.0, "status": "READY", "score": null,
                "episode": null, "questions": [], "writingPrompts": [], "speakingPrompts": []
            }]
        }));
        assert!(exam_sections(&exam).is_none());
    }

    #[test]
    fn collect_exam_answers_aggregates_answered_mc_across_sections() {
        let mut sections = exam_sections(&mixed_exam()).expect("well-formed");
        for s in sections.iter_mut() {
            match &mut s.progress {
                SectionProgress::Mc { selected, .. }
                | SectionProgress::Listening { selected, .. } => {
                    selected[0] = Some(if s.id == "ex-r" { 1 } else { 0 });
                }
                _ => {}
            }
        }
        let answers = collect_exam_answers(&sections).expect("valid ids");
        assert_eq!(answers.len(), 3);
        let by_id: std::collections::HashMap<_, _> = answers
            .iter()
            .map(|a| ((*a.question_id).clone(), a.selected_index))
            .collect();
        assert_eq!(by_id.get("g0"), Some(&0));
        assert_eq!(by_id.get("r0"), Some(&1));
        assert_eq!(by_id.get("l0"), Some(&0));
    }

    #[test]
    fn exam_result_converts_band_and_percent() {
        let resp: types::SubmitExamResponse = serde_json::from_value(serde_json::json!({
            "overallScore": 0.72, "band": "B2", "feedback": "Solid.",
            "sections": [
                { "sectionId": "ex-g", "skill": "GRAMMAR", "weight": 0.5, "score": 0.8 },
                { "sectionId": "ex-r", "skill": "READING", "weight": 0.5, "score": 0.6 }
            ]
        }))
        .expect("valid");
        let result = ExamResult::from(&resp);
        assert_eq!(result.overall_score, 72);
        assert_eq!(result.band, "B2");
        assert_eq!(result.feedback, "Solid.");
        assert_eq!(result.sections.len(), 2);
        assert_eq!(result.sections[0].skill, "GRAMMAR");
        assert_eq!(result.sections[0].score, 80);
        assert_eq!(result.sections[1].score, 60);
    }

    // --- P6d: placement / memory / settings --------------------------------
