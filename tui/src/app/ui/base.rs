/// Draw the active screen into `area`.
pub(super) fn draw_view(frame: &mut Frame, area: Rect, view: &View, config: &Config, p: &Palette) {
    match view {
        View::Loading => draw_loading(frame, area, config, p),
        View::Error { message, .. } => draw_error(frame, area, message, p),
        View::Courses { courses, cursor } => draw_courses(frame, area, courses, *cursor, p),
        View::CourseHome {
            course,
            due,
            menu_cursor,
            notice,
            starting,
        } => draw_course_home(
            frame,
            area,
            course,
            due,
            *menu_cursor,
            notice.as_ref(),
            *starting,
            p,
        ),
        View::ItemReview {
            course,
            kind,
            items,
            index,
            cursor,
            prompt_scroll,
            submitting,
            ..
        } => {
            // Items is guaranteed non-empty when this view is constructed.
            if let Some(item) = items.get(*index) {
                draw_item_review(
                    frame,
                    area,
                    ItemReviewView {
                        course,
                        kind: *kind,
                        index: *index,
                        total: items.len(),
                        prompt: &item.prompt,
                        options: &item.options,
                        cursor: *cursor,
                        prompt_scroll: *prompt_scroll,
                        submitting: *submitting,
                    },
                    p,
                );
            }
        }
        View::ListeningReview { .. } => draw_listening_review(frame, area, view, p),
        View::SpeakingReview { .. } => draw_speaking_review(frame, area, view, p),
        View::Result { course, result } => draw_result(frame, area, course, result, p),
        View::Class { .. } => draw_class(frame, area, view, p),
        View::ClassOutcome { course, result } => draw_class_result(frame, area, course, result, p),
        View::ClassDone { course } => draw_class_done(frame, area, course, p),
        View::Exam { .. } => draw_exam(frame, area, view, p),
        View::ExamOutcome { course, result } => draw_exam_result(frame, area, course, result, p),
        View::PlacementLang { .. } => draw_placement_lang(frame, area, view, p),
        View::PlacementReview { .. } => draw_placement_review(frame, area, view, p),
        View::PlacementResult { outcome } => draw_placement_result(frame, area, outcome, p),
        View::NotesPlacement { input, phase, .. } => {
            draw_notes_placement(frame, area, input, phase, p)
        }
        View::Memory { .. } => draw_memory(frame, area, view, p),
        View::Settings { config } => draw_settings(frame, area, config.as_ref(), p),
    }
}

/// Outer titled panel shared by every screen. Returns the inner content area.
fn panel(frame: &mut Frame, area: Rect, title: &str, p: &Palette) -> Rect {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(p.primary))
        .title(Span::styled(
            format!(" {title} "),
            Style::default().fg(p.primary).add_modifier(Modifier::BOLD),
        ));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    inner
}

fn hint_line(hints: &[&str], p: &Palette) -> Line<'static> {
    let mut spans: Vec<Span<'static>> = Vec::new();
    for (i, hint) in hints.iter().enumerate() {
        if i > 0 {
            spans.push(Span::styled("   ", Style::default().fg(p.ink_soft)));
        }
        spans.push(Span::styled(
            hint.to_string(),
            Style::default().fg(p.ink_soft),
        ));
    }
    Line::from(spans)
}

fn draw_loading(frame: &mut Frame, area: Rect, config: &Config, p: &Palette) {
    let inner = panel(frame, area, "Sotto", p);
    let body = Text::from(vec![
        Line::default(),
        Line::from(Span::styled(
            "Loading your courses…",
            Style::default().fg(p.primary).add_modifier(Modifier::BOLD),
        )),
        Line::default(),
        Line::from(Span::styled(
            format!(
                "Connected to {}",
                config
                    .active_profile()
                    .map(|prof| prof.server_url.as_str())
                    .unwrap_or("(no profile)")
            ),
            Style::default().fg(p.ink_soft),
        )),
    ]);
    frame.render_widget(Paragraph::new(body).alignment(Alignment::Center), inner);
}

fn draw_error(frame: &mut Frame, area: Rect, message: &str, p: &Palette) {
    let inner = panel(frame, area, "Sotto", p);
    let chunks = Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(inner);

    let body = Text::from(vec![
        Line::default(),
        Line::from(Span::styled(
            "Could not load your courses",
            Style::default().fg(p.pink).add_modifier(Modifier::BOLD),
        )),
        Line::default(),
        Line::from(Span::styled(
            message.to_string(),
            Style::default().fg(p.ink_soft),
        )),
    ]);
    frame.render_widget(
        Paragraph::new(body)
            .alignment(Alignment::Center)
            .wrap(Wrap { trim: true }),
        chunks[0],
    );

    frame.render_widget(
        Paragraph::new(hint_line(&["r retry", "q quit"], p)),
        chunks[1],
    );
}

fn draw_courses(frame: &mut Frame, area: Rect, courses: &[Course], cursor: usize, p: &Palette) {
    let inner = panel(frame, area, "Courses", p);
    let chunks = Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(inner);

    if courses.is_empty() {
        let body = Paragraph::new(Text::from(vec![
            Line::default(),
            Line::from(Span::styled(
                "No courses yet.",
                Style::default().fg(p.ink).add_modifier(Modifier::BOLD),
            )),
            Line::default(),
            Line::from(Span::styled(
                "Press (n) to take a placement test and create your first course.",
                Style::default().fg(p.ink_soft),
            )),
        ]))
        .alignment(Alignment::Center);
        frame.render_widget(body, chunks[0]);
    } else {
        let items: Vec<ListItem> = courses
            .iter()
            .enumerate()
            .map(|(i, course)| {
                let head = Line::from(vec![
                    Span::styled(format!("{}. ", i + 1), Style::default().fg(p.ink_soft)),
                    Span::styled(
                        course.title.clone(),
                        Style::default().fg(p.ink).add_modifier(Modifier::BOLD),
                    ),
                ]);
                let sub = Line::from(Span::styled(
                    format!(
                        "   {} → {} · {}",
                        course.native_lang, course.target_lang, course.current_level
                    ),
                    Style::default().fg(p.ink_soft),
                ));
                ListItem::new(vec![head, sub])
            })
            .collect();

        let list = List::new(items)
            .highlight_style(Style::default().fg(p.primary).add_modifier(Modifier::BOLD))
            .highlight_symbol("▌ ");
        let mut list_state = ListState::default();
        list_state.select(Some(cursor.min(courses.len().saturating_sub(1))));
        frame.render_stateful_widget(list, chunks[0], &mut list_state);
    }

    let hints: &[&str] = if courses.is_empty() {
        &["n new course", "s settings", "q quit"]
    } else {
        &[
            "↑/↓ move",
            "enter open",
            "n new course",
            "s settings",
            "q quit",
        ]
    };
    frame.render_widget(Paragraph::new(hint_line(hints, p)), chunks[1]);
}

#[allow(clippy::too_many_arguments)]
fn draw_course_home(
    frame: &mut Frame,
    area: Rect,
    course: &Course,
    due: &DueCounts,
    menu_cursor: usize,
    notice: Option<&Unavailable>,
    starting: bool,
    p: &Palette,
) {
    let inner = panel(frame, area, &course.title, p);
    // Header (course + due), the skill menu, an optional notice, and hints.
    let chunks = Layout::vertical([
        Constraint::Length(4),
        Constraint::Fill(1),
        Constraint::Length(2),
        Constraint::Length(1),
    ])
    .split(inner);

    let header = Text::from(vec![
        Line::default(),
        Line::from(vec![
            Span::styled(
                format!("{} → {}", course.native_lang, course.target_lang),
                Style::default().fg(p.ink).add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!("   level {}", course.current_level),
                Style::default().fg(p.ink_soft),
            ),
        ]),
        Line::from(vec![
            Span::styled("Due  ", Style::default().fg(p.ink_soft)),
            Span::styled(
                format!("{} vocab", due.vocab),
                Style::default().fg(p.primary).add_modifier(Modifier::BOLD),
            ),
            Span::styled("   ", Style::default().fg(p.ink_soft)),
            Span::styled(
                format!("{} grammar", due.grammar),
                Style::default().fg(p.accent),
            ),
            Span::styled(
                format!("   {} words tracked", due.total_vocab),
                Style::default().fg(p.ink_soft),
            ),
        ]),
    ]);
    frame.render_widget(Paragraph::new(header).wrap(Wrap { trim: true }), chunks[0]);

    // Skill menu.
    let can_review = can_review_vocab(due);
    let items: Vec<ListItem> = SkillChoice::MENU
        .iter()
        .map(|skill| {
            // Vocab is disabled (greyed) when there is nothing to review.
            let disabled = *skill == SkillChoice::Vocab && !can_review;
            let style = if disabled {
                Style::default().fg(p.ink_soft)
            } else {
                Style::default().fg(p.ink).add_modifier(Modifier::BOLD)
            };
            let suffix = if disabled { "  (nothing due)" } else { "" };
            ListItem::new(Line::from(Span::styled(
                format!("{}{}", skill.label(), suffix),
                style,
            )))
        })
        .collect();
    let list = List::new(items)
        .highlight_style(Style::default().fg(p.primary).add_modifier(Modifier::BOLD))
        .highlight_symbol("▌ ");
    let mut list_state = ListState::default();
    list_state.select(Some(
        menu_cursor.min(SkillChoice::MENU.len().saturating_sub(1)),
    ));
    frame.render_stateful_widget(list, chunks[1], &mut list_state);

    // Notice / starting status.
    let mut footer: Vec<Line> = Vec::new();
    if starting {
        footer.push(Line::from(Span::styled(
            "Starting…",
            Style::default()
                .fg(p.ink_soft)
                .add_modifier(Modifier::ITALIC),
        )));
    }
    if let Some(reason) = notice {
        footer.push(Line::from(Span::styled(
            reason.message(),
            Style::default().fg(p.pink).add_modifier(Modifier::BOLD),
        )));
    }
    frame.render_widget(
        Paragraph::new(Text::from(footer)).wrap(Wrap { trim: true }),
        chunks[2],
    );

    let hints: &[&str] = if starting {
        &["q back"]
    } else {
        // Mirrors the CourseHome keymap: ↑/↓ select a practice skill, enter
        // starts it, c=next class, e=mock exam, m=memory, s=settings.
        &[
            "↑/↓ skill",
            "enter practice",
            "c class",
            "e exam",
            "m memory",
            "s settings",
            "q back",
        ]
    };
    frame.render_widget(Paragraph::new(hint_line(hints, p)), chunks[3]);
}

/// Render args for the shared multiple-choice review screen.
struct ItemReviewView<'a> {
    course: &'a Course,
    kind: ReviewKind,
    index: usize,
    total: usize,
    prompt: &'a str,
    options: &'a [String],
    cursor: usize,
    prompt_scroll: u16,
    submitting: bool,
}

/// One review screen shared by VOCAB / GRAMMAR / READING: a wrapping, scrollable
/// prompt (long reading passages live here) above the selectable options.
fn draw_item_review(frame: &mut Frame, area: Rect, v: ItemReviewView, p: &Palette) {
    let title = format!(
        "{} · {} {}/{}",
        v.course.title,
        v.kind.label(),
        v.index + 1,
        v.total
    );
    let inner = panel(frame, area, &title, p);
    // Reading prompts can be long, so give the prompt a flexible block that
    // wraps and scrolls; options sit in a fixed block below.
    let option_rows = (v.options.len() as u16).saturating_add(1);
    let chunks = Layout::vertical([
        Constraint::Fill(1),
        Constraint::Length(option_rows.max(2)),
        Constraint::Length(1),
    ])
    .split(inner);

    let prompt_para = Paragraph::new(Span::styled(
        v.prompt.to_string(),
        Style::default().fg(p.ink).add_modifier(Modifier::BOLD),
    ))
    .wrap(Wrap { trim: true })
    .scroll((v.prompt_scroll, 0));
    frame.render_widget(prompt_para, chunks[0]);

    let items: Vec<ListItem> = v
        .options
        .iter()
        .enumerate()
        .map(|(i, option)| {
            ListItem::new(Line::from(vec![
                Span::styled(format!("{}. ", i + 1), Style::default().fg(p.ink_soft)),
                Span::styled(option.clone(), Style::default().fg(p.ink)),
            ]))
        })
        .collect();

    let list = List::new(items)
        .highlight_style(Style::default().fg(p.primary).add_modifier(Modifier::BOLD))
        .highlight_symbol("▌ ");
    let mut list_state = ListState::default();
    if !v.options.is_empty() {
        list_state.select(Some(v.cursor.min(v.options.len() - 1)));
    }
    frame.render_stateful_widget(list, chunks[1], &mut list_state);

    // Reading benefits from the scroll hint; keep it for all MC reviews.
    let hints: &[&str] = if v.submitting {
        &["submitting…", "q back"]
    } else {
        &[
            "↑/↓ choose",
            "1-9 pick",
            "PgUp/PgDn scroll",
            "enter answer",
            "q back",
        ]
    };
    frame.render_widget(Paragraph::new(hint_line(hints, p)), chunks[2]);
}

fn draw_result(
    frame: &mut Frame,
    area: Rect,
    course: &Course,
    result: &PracticeResult,
    p: &Palette,
) {
    let inner = panel(frame, area, &format!("{} · results", course.title), p);
    let chunks = Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(inner);

    let body = Text::from(vec![
        Line::default(),
        Line::from(Span::styled(
            "Review complete",
            Style::default().fg(p.primary).add_modifier(Modifier::BOLD),
        )),
        Line::default(),
        Line::from(Span::styled(
            format!("{}%", result.score),
            Style::default().fg(p.pink).add_modifier(Modifier::BOLD),
        )),
        Line::from(Span::styled(
            format!("{} of {} correct", result.correct, result.total),
            Style::default().fg(p.ink_soft),
        )),
    ]);
    frame.render_widget(Paragraph::new(body).alignment(Alignment::Center), chunks[0]);

    frame.render_widget(
        Paragraph::new(hint_line(&["enter continue", "q back"], p)),
        chunks[1],
    );
}

fn draw_listening_review(frame: &mut Frame, area: Rect, view: &View, p: &Palette) {
    let View::ListeningReview {
        course,
        episode,
        items,
        index,
        cursor,
        submitting,
        audio_note,
        ask,
        ..
    } = view
    else {
        return;
    };

    let title = match episode {
        Some(ep) => format!("{} · listening — {}", course.title, ep.title),
        None => format!("{} · listening", course.title),
    };
    let inner = panel(frame, area, &title, p);
    let chunks = Layout::vertical([
        Constraint::Length(1),
        Constraint::Fill(1),
        Constraint::Length(1),
    ])
    .split(inner);

    // Top: audio status line.
    let status = audio_note.clone().unwrap_or_else(|| match episode {
        Some(_) => "Press space to play the episode audio.".to_string(),
        None => "Loading episode…".to_string(),
    });
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            status,
            Style::default().fg(p.primary),
        ))),
        chunks[0],
    );

    // The Q&A overlay takes over the body + hints when open.
    if ask.open {
        draw_ask_overlay(frame, chunks[1], ask, p);
        frame.render_widget(Paragraph::new(hint_line(ask_hints(ask), p)), chunks[2]);
        return;
    }

    // Middle: either the current comprehension item, or the transcript.
    if let Some(item) = items.get(*index) {
        // Comprehension question with selectable options.
        let body = Layout::vertical([Constraint::Length(2), Constraint::Fill(1)]).split(chunks[1]);
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                format!("Q{}/{}: {}", index + 1, items.len(), item.prompt),
                Style::default().fg(p.ink).add_modifier(Modifier::BOLD),
            )))
            .wrap(Wrap { trim: true }),
            body[0],
        );
        let opts: Vec<ListItem> = item
            .options
            .iter()
            .enumerate()
            .map(|(i, option)| {
                ListItem::new(Line::from(vec![
                    Span::styled(format!("{}. ", i + 1), Style::default().fg(p.ink_soft)),
                    Span::styled(option.clone(), Style::default().fg(p.ink)),
                ]))
            })
            .collect();
        let list = List::new(opts)
            .highlight_style(Style::default().fg(p.primary).add_modifier(Modifier::BOLD))
            .highlight_symbol("▌ ");
        let mut list_state = ListState::default();
        if !item.options.is_empty() {
            list_state.select(Some((*cursor).min(item.options.len() - 1)));
        }
        frame.render_stateful_widget(list, body[1], &mut list_state);
    } else {
        // Transcript-only: list speaker + line.
        let lines: Vec<Line> = match episode {
            Some(ep) => ep
                .segments
                .iter()
                .map(|seg| {
                    Line::from(vec![
                        Span::styled(
                            format!("{}: ", seg.speaker),
                            Style::default().fg(p.ink_soft).add_modifier(Modifier::BOLD),
                        ),
                        Span::styled(seg.text.clone(), Style::default().fg(p.ink)),
                    ])
                })
                .collect(),
            None => vec![Line::from(Span::styled(
                "Loading transcript…",
                Style::default().fg(p.ink_soft),
            ))],
        };
        frame.render_widget(
            Paragraph::new(Text::from(lines)).wrap(Wrap { trim: true }),
            chunks[1],
        );
    }

    let hints: &[&str] = if *submitting {
        &["submitting…", "q back"]
    } else if items.is_empty() {
        &["space play/pause", "a ask", "q back"]
    } else {
        &[
            "space play",
            "a ask",
            "↑/↓ choose",
            "enter answer",
            "q back",
        ]
    };
    frame.render_widget(Paragraph::new(hint_line(hints, p)), chunks[2]);
}

fn draw_speaking_review(frame: &mut Frame, area: Rect, view: &View, p: &Palette) {
    let View::SpeakingReview {
        course,
        prompts,
        index,
        phase,
        ..
    } = view
    else {
        return;
    };

    let title = format!(
        "{} · speaking {}/{}",
        course.title,
        index + 1,
        prompts.len()
    );
    let inner = panel(frame, area, &title, p);
    let chunks = Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(inner);

    let mut lines: Vec<Line> = Vec::new();
    if let Some(prompt) = prompts.get(*index) {
        lines.push(Line::default());
        lines.push(Line::from(Span::styled(
            "Say this aloud:",
            Style::default().fg(p.ink_soft),
        )));
        lines.push(Line::from(Span::styled(
            prompt.target_phrase.clone(),
            Style::default().fg(p.primary).add_modifier(Modifier::BOLD),
        )));
        lines.push(Line::from(Span::styled(
            prompt.translation.clone(),
            Style::default().fg(p.ink_soft),
        )));
        lines.push(Line::default());
    }

    match phase {
        SpeakingPhase::Idle => lines.push(Line::from(Span::styled(
            "Press r to record.",
            Style::default().fg(p.ink),
        ))),
        SpeakingPhase::Recording => lines.push(Line::from(Span::styled(
            "● Recording — press r to stop.",
            Style::default().fg(p.pink).add_modifier(Modifier::BOLD),
        ))),
        SpeakingPhase::Uploading => lines.push(Line::from(Span::styled(
            "Uploading…",
            Style::default()
                .fg(p.ink_soft)
                .add_modifier(Modifier::ITALIC),
        ))),
        SpeakingPhase::Polling { .. } => lines.push(Line::from(Span::styled(
            "Grading…",
            Style::default()
                .fg(p.ink_soft)
                .add_modifier(Modifier::ITALIC),
        ))),
        SpeakingPhase::Graded {
            score,
            transcript,
            feedback,
        } => {
            lines.push(Line::from(vec![
                Span::styled("Score: ", Style::default().fg(p.ink_soft)),
                Span::styled(
                    score.map_or_else(|| "—".to_string(), |s| format!("{s}%")),
                    Style::default().fg(p.pink).add_modifier(Modifier::BOLD),
                ),
            ]));
            if let Some(t) = transcript {
                lines.push(Line::from(Span::styled(
                    format!("Heard: {t}"),
                    Style::default().fg(p.ink),
                )));
            }
            if let Some(f) = feedback {
                lines.push(Line::from(Span::styled(
                    f.clone(),
                    Style::default().fg(p.ink_soft),
                )));
            }
        }
        SpeakingPhase::Failed { message } => lines.push(Line::from(Span::styled(
            message.clone(),
            Style::default().fg(p.pink),
        ))),
    }

    frame.render_widget(
        Paragraph::new(Text::from(lines)).wrap(Wrap { trim: true }),
        chunks[0],
    );

    let hints: &[&str] = match phase {
        SpeakingPhase::Idle => &["r record", "q back"],
        SpeakingPhase::Recording => &["r stop", "q back"],
        SpeakingPhase::Uploading | SpeakingPhase::Polling { .. } => &["q back"],
        SpeakingPhase::Graded { .. } | SpeakingPhase::Failed { .. } => {
            &["enter next", "r retry", "q back"]
        }
    };
    frame.render_widget(Paragraph::new(hint_line(hints, p)), chunks[1]);
}

// --- Classes ---------------------------------------------------------------

fn skill_label(skill: SkillType) -> &'static str {
    match skill {
        SkillType::Grammar => "Grammar",
        SkillType::Reading => "Reading",
        SkillType::Listening => "Listening",
        SkillType::Speaking => "Speaking",
        SkillType::Writing => "Writing",
    }
}
