    fn key(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::NONE)
    }

    /// Apply whatever `map_key` produced, restricted to the actions that could
    /// possibly mutate the underlying listening/class flow. The overlay is modal,
    /// so this must collapse to a no-op (ToggleAsk/None) for non-overlay keys.
    fn apply_mapped(app: &mut App, action: Option<Action>) {
        match action {
            Some(Action::Select) => app.on_select(),
            Some(Action::Choose(n)) => app.on_choose(n),
            Some(Action::Up) => app.on_up(),
            Some(Action::Down) => app.on_down(),
            // ToggleAsk / Input* / None and friends do not touch the underlying
            // listening state; nothing to apply for this assertion.
            _ => {}
        }
    }

    #[tokio::test]
    async fn modal_ask_overlay_swallows_keys_in_standalone_listening() {
        let mut app = listening_app();
        type_question(&mut app, "what does casa mean?");
        app.on_ask_submit();
        // Drive to the ANSWERED (terminal, non-editing) phase.
        let ask_gen = app.request_gen;
        app.on_interaction_asked(
            ask_gen,
            interaction(serde_json::json!({
                "id": "int-9", "question": "?", "timestamp": 0,
                "status": "PENDING", "answer": null, "helpful": null, "segmentOrder": null
            })),
        );
        app.on_interaction_polled(
            ask_gen,
            interaction(serde_json::json!({
                "id": "int-9", "question": "?", "timestamp": 0,
                "status": "ANSWERED", "answer": "It means house.", "helpful": true, "segmentOrder": 1
            })),
        );
        assert!(matches!(
            current_ask_phase(&app),
            state::AskPhase::Answered { .. }
        ));

        let gen_before = app.request_gen;
        // Enter and number keys would normally answer the hidden comprehension
        // item; while the overlay is open they must not reach the keymap.
        for code in [KeyCode::Enter, KeyCode::Char('1'), KeyCode::Char('2')] {
            let mapped = app.map_key(key(code));
            assert!(
                !matches!(mapped, Some(Action::Select) | Some(Action::Choose(_))),
                "{code:?} must not answer a hidden item while the overlay is open",
            );
            apply_mapped(&mut app, mapped);
        }

        match &app.view {
            View::ListeningReview { selected, .. } => assert!(
                selected.iter().all(Option::is_none),
                "no comprehension item may be answered behind the overlay",
            ),
            other => panic!("expected ListeningReview, got {other:?}"),
        }
        assert_eq!(
            app.request_gen, gen_before,
            "swallowed keys must not dispatch any underlying flow",
        );
    }

    #[tokio::test]
    async fn modal_ask_overlay_swallows_keys_in_class_listening() {
        // A single-question listening section: answering it would advance/submit.
        let mut app = test_app();
        app.view = class_with_sections(serde_json::json!([
            { "id": "sec-l", "skill": "LISTENING", "status": "READY",
              "episode": { "id": "epL", "audioUrl": null, "title": "L", "references": [] },
              "prompts": [], "writingPrompts": [],
              "questions": [{ "id": "q0", "order": 0, "question": "?", "options": ["a","b"], "passageRef": null, "passageText": null }] }
        ]));

        // Open the overlay over the listening section and put it in flight (Polling).
        app.on_toggle_ask();
        for c in "explain?".chars() {
            app.ask_input_char(c);
        }
        app.on_ask_submit();
        let ask_gen = app.request_gen;
        app.on_interaction_asked(
            ask_gen,
            interaction(serde_json::json!({
                "id": "int-c", "question": "?", "timestamp": 0,
                "status": "PENDING", "answer": null, "helpful": null, "segmentOrder": null
            })),
        );
        assert!(matches!(
            current_ask_phase_section(&app),
            state::AskPhase::Polling { .. }
        ));

        let gen_before = app.request_gen;
        let cursor_before = match &app.view {
            View::Class { cursor, .. } => *cursor,
            other => panic!("expected Class, got {other:?}"),
        };

        // Enter / number would answer q0 and advance + submit the class. Modal.
        for code in [KeyCode::Enter, KeyCode::Char('1')] {
            let mapped = app.map_key(key(code));
            assert!(
                !matches!(mapped, Some(Action::Select) | Some(Action::Choose(_))),
                "{code:?} must not advance the class behind the overlay",
            );
            apply_mapped(&mut app, mapped);
        }

        match app.current_section().map(|s| &s.progress) {
            Some(SectionProgress::Listening { selected, .. }) => assert!(
                selected.iter().all(Option::is_none),
                "no listening question may be answered behind the overlay",
            ),
            other => panic!("expected a current Listening section, got {other:?}"),
        }
        match &app.view {
            View::Class { cursor, .. } => assert_eq!(
                *cursor, cursor_before,
                "the section must not advance behind the overlay",
            ),
            other => panic!("expected Class, got {other:?}"),
        }
        assert_eq!(
            app.request_gen, gen_before,
            "swallowed keys must not dispatch the class flow",
        );
    }

    /// The ask phase of the current in-class/in-exam listening section.
    fn current_ask_phase_section(app: &App) -> state::AskPhase {
        match app.current_section().map(|s| &s.progress) {
            Some(SectionProgress::Listening { ask, .. }) => ask.phase.clone(),
            _ => panic!("expected a current Listening section with an ask state"),
        }
    }

    // --- P7: theme picker, help overlay, responsive ------------------------

    use crate::theme::{LightPalette, Mode};

    #[test]
    fn t_opens_the_theme_picker_and_t_closes_it() {
        let mut app = test_app();
        app.view = View::courses(&[]);
        assert!(!app.theme_picker.open);

        assert!(matches!(
            app.map_key(key(KeyCode::Char('t'))),
            Some(Action::ToggleThemePicker)
        ));
        app.on_toggle_theme_picker();
        assert!(app.theme_picker.open);

        app.on_toggle_theme_picker();
        assert!(!app.theme_picker.open);
    }

    #[test]
    fn picker_cycles_each_row_and_applies_live() {
        let mut app = test_app();
        app.on_toggle_theme_picker();
        // Row 0 = Mode. Cycling flips light -> dark on the live theme.
        assert_eq!(app.theme.mode, Mode::Light);
        app.on_cycle_theme_value();
        assert_eq!(app.theme.mode, Mode::Dark, "mode applies live");

        // Move to the light-palette row and cycle.
        app.on_down();
        assert_eq!(app.theme.light_palette, LightPalette::AulaCool);
        app.on_cycle_theme_value();
        assert_eq!(app.theme.light_palette, LightPalette::PaperWarm);

        // Move to the accent row and cycle to the next swatch.
        app.on_down();
        let before = app.theme.accent;
        app.on_cycle_theme_value();
        assert_ne!(app.theme.accent, before, "accent cycles to a new swatch");
    }

    #[test]
    fn closing_the_picker_persists_the_choice_to_config() {
        let mut app = test_app();
        app.on_toggle_theme_picker();
        app.on_cycle_theme_value(); // mode -> dark
        // The persisted config still reflects the default until the picker closes.
        assert_eq!(app.config.theme, crate::config::ThemeChoice::default());

        app.on_toggle_theme_picker(); // close -> persist
        assert_eq!(app.config.theme.mode, "dark");
        // The in-memory theme and the persisted choice now agree.
        assert_eq!(app.config.theme, app.theme.to_choice());
    }

    #[test]
    fn picker_is_modal_and_swallows_screen_keys() {
        // Open the picker over Courses; a number/enter must NOT select a course.
        let mut app = test_app();
        app.view = View::courses(&[course_summary("c0"), course_summary("c1")]);
        app.on_toggle_theme_picker();

        // Enter is the picker's "cycle value", never a course selection.
        assert!(matches!(
            app.map_key(key(KeyCode::Enter)),
            Some(Action::CycleThemeValue)
        ));
        // A number key is swallowed entirely (no Choose leaks to the list).
        assert!(app.map_key(key(KeyCode::Char('2'))).is_none());
        // `a` (would open ask on a listening screen) is also swallowed.
        assert!(app.map_key(key(KeyCode::Char('a'))).is_none());

        // We are still on Courses; nothing navigated.
        assert!(matches!(app.view, View::Courses { .. }));
    }

    #[test]
    fn help_overlay_opens_modal_and_dismisses() {
        let mut app = test_app();
        app.view = View::courses(&[]);
        assert!(matches!(
            app.map_key(key(KeyCode::Char('?'))),
            Some(Action::ToggleHelp)
        ));
        app.on_toggle_help();
        assert!(app.help_open);

        // While open it is modal: arbitrary keys are swallowed, only `?`/Esc act.
        assert!(app.map_key(key(KeyCode::Char('x'))).is_none());
        assert!(app.map_key(key(KeyCode::Enter)).is_none());
        assert!(matches!(
            app.map_key(key(KeyCode::Esc)),
            Some(Action::ToggleHelp)
        ));
        app.on_toggle_help();
        assert!(!app.help_open);
    }

    #[test]
    fn opening_one_overlay_closes_the_other() {
        let mut app = test_app();
        app.view = View::courses(&[]);
        app.on_toggle_help();
        assert!(app.help_open);
        // Opening the picker dismisses help (one modal at a time).
        app.on_toggle_theme_picker();
        assert!(app.theme_picker.open && !app.help_open);
        // Opening help again dismisses the picker.
        app.on_toggle_help();
        assert!(app.help_open && !app.theme_picker.open);
    }

    #[test]
    fn help_does_not_open_while_typing_a_question() {
        // In ask-editing mode, `?` and `t` are literal characters, not openers.
        let mut app = listening_app();
        app.on_toggle_ask(); // -> Editing
        assert!(matches!(
            app.map_key(key(KeyCode::Char('?'))),
            Some(Action::Input('?'))
        ));
        assert!(matches!(
            app.map_key(key(KeyCode::Char('t'))),
            Some(Action::Input('t'))
        ));
    }

    /// Parse the leading concrete key out of a help-display token into the
    /// `KeyEvent` the keymap would receive. Multi-key tokens ("↑/↓ j/k",
    /// "1-9 / enter") probe their first concrete key — enough to catch a listed
    /// key that the keymap no longer produces an action for. Returns `None` for
    /// global tokens (`?`, `t`, `q / esc`, `Ctrl-C`), which are tested separately.
    fn probe_key_for(token: &str) -> Option<KeyEvent> {
        // Globals are validated on their own; skip here.
        if matches!(token, "?" | "t" | "q / esc" | "Ctrl-C") {
            return None;
        }
        if token.starts_with("↑/↓") {
            return Some(key(KeyCode::Up));
        }
        if token.starts_with("1-9") {
            return Some(key(KeyCode::Char('1')));
        }
        if token.starts_with("PgUp") {
            return Some(key(KeyCode::PageUp));
        }
        Some(match token {
            "enter" => key(KeyCode::Enter),
            "space" => key(KeyCode::Char(' ')),
            "tab" => key(KeyCode::Tab),
            "Ctrl-D" => KeyEvent::new(KeyCode::Char('d'), KeyModifiers::CONTROL),
            // Single-letter shortcuts: a, c, e, m, n, r, s.
            s if s.chars().count() == 1 => key(KeyCode::Char(s.chars().next().unwrap())),
            other => panic!("unhandled help token {other:?} — add it to probe_key_for"),
        })
    }

    /// True when `action` is a real keyboard SHORTCUT, not raw text capture. A
    /// writing/ask editor turns every `Char(c)` into `Input(c)`, so text-capture
    /// must NOT count as a help key being "live" — otherwise any single letter
    /// would falsely look like a valid shortcut on an editing screen.
    fn is_shortcut_action(action: &Action) -> bool {
        !matches!(
            action,
            Action::Input(_) | Action::InputNewline | Action::InputBackspace
        )
    }

    /// Probe `key` against `app` and return true iff it yields a real shortcut
    /// action (not text capture, not a dead key).
    fn maps_to_shortcut(app: &App, k: KeyEvent) -> bool {
        app.map_key(k).as_ref().is_some_and(is_shortcut_action)
    }

    /// Assert every key listed in `help_rows(app.view)` actually produces a
    /// shortcut action via `map_key` for that view (so the help can't list a
    /// dead key). Used for single-mode screens, where every listed key is live
    /// on the view itself.
    fn assert_help_keys_live(app: &App) {
        for (token, _desc) in overlay::help_rows(&app.view) {
            if let Some(k) = probe_key_for(token) {
                assert!(
                    maps_to_shortcut(app, k),
                    "help lists {token:?} on {:?}, but the keymap produces no shortcut for it",
                    std::mem::discriminant(&app.view),
                );
            }
        }
    }

    /// The five section-type flows a Class/Exam help line can apply to. Each
    /// representative parks the flow on a single section of that skill, so the
    /// section's keys are live there.
    const SECTION_SKILLS: [&str; 4] = ["LISTENING", "SPEAKING", "GRAMMAR", "WRITING"];

    /// Assert every key listed in a Class/Exam's `help_rows` is live on AT LEAST
    /// ONE section type — so no listed key (space/r/↑↓/1-9/a/Ctrl-D) is dead.
    /// `make` builds the flow (class or exam) parked on the given section skill.
    fn assert_section_walk_help_keys_live(make: impl Fn(&str) -> App, label: &str) {
        // Help rows are identical across section skills (keyed on the View
        // discriminant), so read them from any representative.
        let sample = make("LISTENING");
        for (token, _desc) in overlay::help_rows(&sample.view) {
            let Some(k) = probe_key_for(token) else {
                continue; // globals are validated separately
            };
            // A key counts only if SOME section type makes it a real shortcut —
            // text capture on a writing/ask editor does not qualify.
            let live_on_some = SECTION_SKILLS
                .iter()
                .any(|skill| maps_to_shortcut(&make(skill), k));
            assert!(
                live_on_some,
                "{label} help lists {token:?}, but no section type makes it a shortcut",
            );
        }
    }

    /// The help overlay lists the REAL screen keys: every key it shows for a
    /// screen must map to a live action. This keeps the hand-maintained help
    /// source from drifting from `map_key`. Covers EVERY view (single-mode views
    /// directly; Class/Exam via their section-type representatives).
    #[test]
    fn help_rows_match_the_real_keymap_for_each_screen() {
        for view in representative_views() {
            // Help stays concise on every screen.
            let rows = overlay::help_rows(&view);
            assert!(rows.len() <= 8, "help stays concise: {} rows", rows.len());

            // Class/Exam span section types: every listed key must be live on at
            // least one section type (not necessarily the parked one). Single-mode
            // views must have every listed key live on the view itself.
            match &view {
                View::Class { .. } => {
                    assert_section_walk_help_keys_live(class_app_with_section, "Class");
                }
                View::Exam { .. } => {
                    assert_section_walk_help_keys_live(exam_app_with_section, "Exam");
                }
                _ => {
                    let mut app = test_app();
                    app.view = view;
                    assert_help_keys_live(&app);
                }
            }
        }
    }

    /// Spot-check the canonical section-type keys are live on BOTH class and exam
    /// (a direct, readable assertion alongside the exhaustive coverage above).
    #[test]
    fn class_and_exam_section_keys_are_live_on_their_section_type() {
        for make in [
            class_app_with_section as fn(&str) -> App,
            exam_app_with_section as fn(&str) -> App,
        ] {
            // Listening: space (play) + `a` (ask).
            assert!(make("LISTENING").map_key(key(KeyCode::Char(' '))).is_some());
            assert!(make("LISTENING").map_key(key(KeyCode::Char('a'))).is_some());
            // Speaking: `r` (record).
            assert!(make("SPEAKING").map_key(key(KeyCode::Char('r'))).is_some());
            // MC/grammar: ↑/↓ + 1-9.
            assert!(make("GRAMMAR").map_key(key(KeyCode::Up)).is_some());
            assert!(make("GRAMMAR").map_key(key(KeyCode::Char('1'))).is_some());
            // Writing (editing phase): Ctrl-D submits.
            assert!(
                make("WRITING")
                    .map_key(KeyEvent::new(KeyCode::Char('d'), KeyModifiers::CONTROL))
                    .is_some(),
                "Ctrl-D must submit on a writing section",
            );
        }
    }

    /// Every key listed in `global_rows` maps to a real action on a normal
    /// screen — no global help entry is dead.
    #[test]
    fn every_global_help_key_is_live() {
        let mut app = test_app();
        app.view = View::courses(&[course_summary("c0")]);
        for (token, _desc) in overlay::global_rows() {
            for k in global_probe_keys(token) {
                assert!(
                    app.map_key(k).is_some(),
                    "global help lists {token:?} ({k:?}), but the keymap is silent for it",
                );
            }
        }
    }

    /// Parse a GLOBAL help token into the concrete key events it advertises. The
    /// per-screen [`probe_key_for`] returns `None` for these (they are validated
    /// here): `?`, `t`, `q / esc` (two keys), `Ctrl-C`.
    fn global_probe_keys(token: &str) -> Vec<KeyEvent> {
        match token {
            "?" => vec![key(KeyCode::Char('?'))],
            "t" => vec![key(KeyCode::Char('t'))],
            "A" => vec![key(KeyCode::Char('A'))],
            "q / esc" => vec![key(KeyCode::Char('q')), key(KeyCode::Esc)],
            "Ctrl-C" => vec![KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL)],
            other => panic!("unhandled global token {other:?} — add it to global_probe_keys"),
        }
    }

    /// A `Class` parked on a single section of the given skill, with that section
    /// the current one — so the section's keys are live.
    fn class_app_with_section(skill: &str) -> App {
        let mut app = test_app();
        app.view = class_with_sections(section_json(skill));
        app
    }

    /// An `Exam` parked on a single section of the given skill.
    fn exam_app_with_section(skill: &str) -> App {
        let mut app = test_app();
        let exam: types::ExamDetailResponse = serde_json::from_value(serde_json::json!({
            "id": "exam1", "institution": "CEFR_GENERIC", "institutionLabel": "CEFR",
            "level": "B1", "status": "IN_PROGRESS", "examName": "Mock B1", "result": null,
            "sections": exam_section_json(skill)
        }))
        .expect("valid exam");
        let sections = state::exam_sections(&exam).expect("well-formed exam sections");
        app.view = View::Exam {
            course: course("A"),
            exam_id: Some("exam1".into()),
            sections: Some(sections),
            cursor: 0,
            submitting: false,
        };
        app
    }

    /// One CLASS section of the given skill, as the class-route JSON the section
    /// builder parses (speaking uses `prompts`).
    fn section_json(skill: &str) -> serde_json::Value {
        let episode = if skill == "LISTENING" {
            serde_json::json!({ "id": "ep", "audioUrl": null, "title": "L", "references": [] })
        } else {
            serde_json::Value::Null
        };
        let questions = if skill == "GRAMMAR" {
            serde_json::json!([{ "id": "q", "order": 0, "question": "?", "options": ["a","b"], "passageRef": null, "passageText": null }])
        } else {
            serde_json::json!([])
        };
        let prompts = if skill == "SPEAKING" {
            serde_json::json!([{ "id": "p", "order": 0, "targetPhrase": "hola", "translation": "hi", "ipa": null, "referenceTtsUrl": null }])
        } else {
            serde_json::json!([])
        };
        let writing = if skill == "WRITING" {
            serde_json::json!([{ "id": "w", "order": 0, "task": "Write", "guidance": null, "response": null }])
        } else {
            serde_json::json!([])
        };
        serde_json::json!([
            { "id": "sec", "skill": skill, "status": "READY", "episode": episode,
              "prompts": prompts, "writingPrompts": writing, "questions": questions }
        ])
    }

    /// One EXAM section of the given skill, as the exam-route JSON the exam
    /// section builder parses (speaking uses `speakingPrompts`; extra metadata).
    fn exam_section_json(skill: &str) -> serde_json::Value {
        let episode = if skill == "LISTENING" {
            serde_json::json!({ "id": "ep", "audioUrl": null, "status": "READY" })
        } else {
            serde_json::Value::Null
        };
        let questions = if skill == "GRAMMAR" {
            serde_json::json!([{ "id": "q", "order": 0, "question": "?", "options": ["a","b"], "passageRef": null, "passageText": null }])
        } else {
            serde_json::json!([])
        };
        let speaking = if skill == "SPEAKING" {
            serde_json::json!([{ "id": "p", "order": 0, "targetPhrase": "hola", "translation": "hi", "referenceTtsUrl": null }])
        } else {
            serde_json::json!([])
        };
        let writing = if skill == "WRITING" {
            serde_json::json!([{ "id": "w", "order": 0, "task": "Write", "guidance": null }])
        } else {
            serde_json::json!([])
        };
        serde_json::json!([
            { "id": "sec", "skill": skill, "part": "P1", "order": 0, "format": "mc",
              "weight": 1.0, "status": "READY", "score": null, "episode": episode,
              "speakingPrompts": speaking, "writingPrompts": writing, "questions": questions }
        ])
    }
