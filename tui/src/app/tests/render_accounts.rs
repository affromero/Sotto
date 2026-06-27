    // --- Responsive: tiny-size render smoke --------------------------------

    use ratatui::Terminal;
    use ratatui::backend::TestBackend;

    /// Render `app` into a `w`×`h` test backend; returns Ok if no panic.
    fn render_at(app: &mut App, w: u16, h: u16) {
        let backend = TestBackend::new(w, h);
        let mut terminal = Terminal::new(backend).expect("test terminal");
        terminal
            .draw(|frame| {
                let _ = app.draw(frame);
            })
            .expect("draw must not fail");
    }

    #[test]
    fn every_main_screen_renders_at_tiny_sizes_without_panicking() {
        // 40x15 (just above the floor), 40x10 (the floor), and 20x6 (below the
        // floor -> the "too small" notice). None may panic.
        for view in representative_views() {
            let mut app = test_app();
            app.view = view;
            render_at(&mut app, 40, 15);
            render_at(&mut app, 40, 10);
            render_at(&mut app, 20, 6);
            // And with each overlay open, at a tiny size.
            app.theme_picker = overlay::ThemePicker::opened();
            render_at(&mut app, 40, 12);
            app.theme_picker = overlay::ThemePicker::closed();
            app.help_open = true;
            render_at(&mut app, 40, 12);
        }
    }

    #[test]
    fn below_floor_shows_the_too_small_notice_only() {
        let mut app = test_app();
        app.view = View::courses(&[course_summary("c0")]);
        let backend = TestBackend::new(20, 6);
        let mut terminal = Terminal::new(backend).expect("test terminal");
        terminal
            .draw(|frame| {
                let _ = app.draw(frame);
            })
            .expect("draw");
        let buf = terminal.backend().buffer().clone();
        let rendered: String = buf.content().iter().map(|c| c.symbol()).collect();
        assert!(
            rendered.contains("too small") || rendered.contains("small"),
            "below the floor the notice must be shown",
        );
    }

    #[test]
    fn the_active_theme_actually_reaches_the_rendered_buffer() {
        use ratatui::style::Color;

        let bg_of = |app: &mut App| -> Color {
            let backend = TestBackend::new(60, 20);
            let mut terminal = Terminal::new(backend).expect("test terminal");
            terminal
                .draw(|frame| {
                    let _ = app.draw(frame);
                })
                .expect("draw");
            // The top-left cell's background is the themed window background.
            terminal.backend().buffer()[(0, 0)].bg
        };

        let mut app = test_app();
        app.view = View::courses(&[course_summary("c0")]);
        // Light (default) paints the aula paper background...
        assert_eq!(bg_of(&mut app), Color::Rgb(0xF5, 0xF4, 0xF0));

        // ...switching to dark repaints with the terminal background, proving the
        // theme is applied end-to-end (not merely stored).
        app.theme.mode = crate::theme::Mode::Dark;
        assert_eq!(bg_of(&mut app), Color::Rgb(0x12, 0x13, 0x10));
    }

    // --- P9: account management --------------------------------------------

    /// An app with two profiles (active = "home") around a recording factory, so
    /// a switch test can assert which profile the client was rebuilt for.
    fn two_profile_app() -> (App, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
        let mut config = stub_config();
        // stub_config sets a single "default" profile; replace with home+work.
        config.profiles.clear();
        config.upsert_profile(
            "home",
            crate::config::Profile {
                server_url: "stub://home".into(),
                api_key: "sk_home".into(),
                name: Some("Home Learner".into()),
            },
        );
        config.upsert_profile(
            "work",
            crate::config::Profile {
                server_url: "stub://work".into(),
                api_key: "sk_work".into(),
                name: Some("Work Learner".into()),
            },
        );
        config.active = "home".into();
        let (factory, built) = recording_factory();
        let app = App::with_factory_at(config, factory, None).expect("two-profile app builds");
        (app, built)
    }

    #[test]
    fn a_opens_the_account_switcher_and_a_closes_it() {
        let mut app = test_app();
        app.view = View::courses(&[]);
        assert!(!app.accounts.open);

        // `A` (shift+a) opens it; lowercase `a` does NOT (no audio screen here).
        assert!(matches!(
            app.map_key(key(KeyCode::Char('A'))),
            Some(Action::ToggleAccounts)
        ));
        app.on_toggle_accounts();
        assert!(app.accounts.open);

        app.on_toggle_accounts();
        assert!(!app.accounts.open);
    }

    #[test]
    fn switcher_is_modal_and_swallows_screen_keys() {
        let (mut app, _) = two_profile_app();
        app.view = View::courses(&[course_summary("c0")]);
        app.on_toggle_accounts();

        // Enter switches; arrows move; a number key is swallowed (no Choose leaks).
        assert!(matches!(
            app.map_key(key(KeyCode::Enter)),
            Some(Action::SwitchAccount)
        ));
        assert!(matches!(app.map_key(key(KeyCode::Up)), Some(Action::Up)));
        assert!(app.map_key(key(KeyCode::Char('2'))).is_none());
        // Still on Courses; nothing navigated behind the overlay.
        assert!(matches!(app.view, View::Courses { .. }));
    }

    #[tokio::test]
    async fn switching_account_rebuilds_the_client_for_the_new_profile_and_reloads() {
        let (mut app, built) = two_profile_app();
        // The factory built the initial client for the active "home" profile.
        assert_eq!(*built.lock().unwrap(), vec!["stub://home".to_string()]);

        // Open the switcher; cursor starts on the active profile ("home", index 0
        // since BTreeMap orders home<work). Move to "work" and switch.
        app.on_toggle_accounts();
        app.on_down(); // -> work (index 1)
        let gen_before = app.request_gen;
        app.on_switch_account();

        // Active profile changed, overlay closed, gen bumped (reload dispatched).
        assert_eq!(app.config.active, "work");
        assert!(!app.accounts.open);
        assert!(app.request_gen > gen_before, "switch reloads (bumps gen)");
        // The client was rebuilt for the new profile's server.
        assert_eq!(
            *built.lock().unwrap(),
            vec!["stub://home".to_string(), "stub://work".to_string()],
            "the client is rebuilt for the switched-to profile",
        );
    }

    #[test]
    fn switching_to_the_already_active_profile_is_a_noop_switch() {
        let (mut app, built) = two_profile_app();
        app.on_toggle_accounts();
        // Cursor is on the active "home"; Enter should not rebuild or reload.
        let gen_before = app.request_gen;
        app.on_switch_account();
        assert_eq!(app.config.active, "home");
        assert_eq!(app.request_gen, gen_before, "no reload for a no-op switch");
        assert_eq!(
            built.lock().unwrap().len(),
            1,
            "no client rebuild for the active profile",
        );
    }

    /// A two-profile app whose factory FAILS to build a client for the profile
    /// at `fail_server`. The "home" profile (active, built at startup) succeeds.
    fn app_with_failing_factory_for(
        fail_server: &'static str,
    ) -> (App, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
        let mut config = stub_config();
        config.profiles.clear();
        config.upsert_profile(
            "home",
            crate::config::Profile {
                server_url: "stub://home".into(),
                api_key: "sk_home".into(),
                name: Some("Home Learner".into()),
            },
        );
        config.upsert_profile(
            "work",
            crate::config::Profile {
                server_url: "stub://work".into(),
                api_key: "sk_work".into(),
                name: Some("Work Learner".into()),
            },
        );
        config.active = "home".into();

        let built = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = std::sync::Arc::clone(&built);
        let factory: ClientFactory = Arc::new(move |profile: &crate::config::Profile| {
            sink.lock().unwrap().push(profile.server_url.clone());
            if profile.server_url == fail_server {
                Err(color_eyre::eyre::eyre!(
                    "bad key for {}",
                    profile.server_url
                ))
            } else {
                Ok(Arc::new(StubApi) as Arc<dyn Api>)
            }
        });
        let app = App::with_factory_at(config, factory, None).expect("home profile builds");
        (app, built)
    }

    #[tokio::test]
    async fn switching_to_a_profile_with_an_unbuildable_client_changes_nothing() {
        // "work" cannot build a client. Switching to it must NOT set active, must
        // NOT dispatch a fetch (which would load home's data under work), and must
        // surface the error while leaving "home" active and its view intact.
        let (mut app, built) = app_with_failing_factory_for("stub://work");
        // Put the app in a recognizable home state (not Loading).
        app.view = View::courses(&[course_summary("home-course")]);
        let gen_before = app.request_gen;

        app.on_toggle_accounts();
        app.on_down(); // cursor -> "work" (the bad profile)
        app.on_switch_account();

        // The switch was rejected: active stays "home".
        assert_eq!(
            app.config.active, "home",
            "a failed client build must not change the active profile",
        );
        // No fetch was dispatched: the generation did not advance and the view is
        // NOT reset to Loading (so no old-account data loads under a new profile).
        assert_eq!(
            app.request_gen, gen_before,
            "no courses fetch is dispatched when the new client cannot be built",
        );
        match &app.view {
            View::Courses { courses, .. } => {
                assert_eq!(courses.len(), 1, "the home view is left intact");
            }
            other => panic!("expected the home Courses view to remain, got {other:?}"),
        }
        // The factory was asked to build "work" (and it failed); the live client
        // is still home's (built once at startup). Builds: home (startup), work (failed).
        assert_eq!(
            *built.lock().unwrap(),
            vec!["stub://home".to_string(), "stub://work".to_string()],
        );
        // The overlay is closed and an error is shown.
        assert!(!app.accounts.open);
    }

    #[tokio::test]
    async fn whoami_reads_the_live_identity_through_the_api_seam() {
        // `sotto whoami` prefers a live `me()` call; the StubApi returns a known
        // identity, proving the contract + Api method are wired end-to-end.
        let api: Arc<dyn Api> = Arc::new(StubApi);
        let me = api.me().await.expect("stub me");
        assert_eq!(me.id, "u_stub");
        assert_eq!(me.name.as_deref(), Some("Stub Learner"));
    }

    #[test]
    fn opening_accounts_dismisses_the_other_modals() {
        let mut app = test_app();
        app.view = View::courses(&[]);
        app.on_toggle_help();
        assert!(app.help_open);
        app.on_toggle_accounts();
        assert!(app.accounts.open && !app.help_open);
        // Opening the theme picker dismisses accounts.
        app.on_toggle_theme_picker();
        assert!(app.theme_picker.open && !app.accounts.open);
    }

    fn course_summary(id: &str) -> types::CourseSummary {
        serde_json::from_value(serde_json::json!({
            "id": id, "nativeLang": "en", "targetLang": "es",
            "currentLevel": "A1", "startLevel": "A1", "placementSource": null,
            "activeClassId": null,
            "curriculum": { "title": format!("Course {id}") },
            "placement": null
        }))
        .expect("valid course summary")
    }

    /// One representative instance of each main screen for the render + keymap
    /// smoke tests.
    fn representative_views() -> Vec<View> {
        vec![
            View::Loading,
            View::Error {
                message: "boom".into(),
                retry: state::RetryKind::Courses,
            },
            View::courses(&[course_summary("c0")]),
            View::CourseHome {
                course: course("A"),
                due: DueCounts {
                    vocab: 3,
                    grammar: 1,
                    total_vocab: 20,
                },
                menu_cursor: 0,
                notice: None,
                starting: false,
            },
            View::start_items(
                course("A"),
                state::ReviewKind::Vocab,
                "s".into(),
                vec![state::VocabItem {
                    id: "v".into(),
                    prompt: "casa".into(),
                    options: vec!["house".into(), "dog".into()],
                }],
            ),
            View::start_listening(
                course("A"),
                "s".into(),
                "ep".into(),
                vec![state::VocabItem {
                    id: "v".into(),
                    prompt: "q".into(),
                    options: vec!["a".into(), "b".into()],
                }],
            ),
            View::start_speaking(
                course("A"),
                "s".into(),
                vec![state::SpeakingPrompt {
                    id: "p".into(),
                    target_phrase: "hola".into(),
                    translation: "hi".into(),
                }],
            ),
            class_with_sections(serde_json::json!([
                { "id": "sec", "skill": "GRAMMAR", "status": "READY", "episode": null,
                  "prompts": [], "writingPrompts": [],
                  "questions": [{ "id": "q", "order": 0, "question": "?", "options": ["a","b"], "passageRef": null, "passageText": null }] }
            ])),
            exam_app_with_section("LISTENING").view,
            View::placement_lang(),
            View::placement_review(
                "en".into(),
                "es".into(),
                vec![state::PlacementQuestion {
                    id: "pq".into(),
                    prompt: "?".into(),
                    options: vec!["a".into(), "b".into()],
                }],
            ),
            View::Memory {
                course: course("A"),
                items: Some(vec![]),
                scroll: 0,
            },
            View::Settings { config: None },
        ]
    }
