fn draw_exam(frame: &mut Frame, area: Rect, view: &View, p: &Palette) {
    let View::Exam {
        course,
        sections,
        cursor,
        submitting,
        ..
    } = view
    else {
        return;
    };

    let Some(sections) = sections else {
        // Exam is still being started / loaded.
        let inner = panel(frame, area, &format!("{} · exam", course.title), p);
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                "Preparing your mock exam…",
                Style::default().fg(p.primary).add_modifier(Modifier::BOLD),
            )))
            .alignment(Alignment::Center),
            inner,
        );
        return;
    };

    let Some(section) = sections.get(*cursor) else {
        return;
    };
    let title = format!(
        "{} · exam — section {}/{} ({})",
        course.title,
        cursor + 1,
        sections.len(),
        skill_label(section.skill)
    );
    let inner = panel(frame, area, &title, p);

    if *submitting {
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                "Scoring your exam…",
                Style::default()
                    .fg(p.ink_soft)
                    .add_modifier(Modifier::ITALIC),
            )))
            .alignment(Alignment::Center),
            inner,
        );
        return;
    }

    // Exam sections render identically to class sections (shared machinery).
    draw_section(frame, inner, section, p);
}

fn draw_exam_result(
    frame: &mut Frame,
    area: Rect,
    course: &Course,
    result: &ExamResult,
    p: &Palette,
) {
    let inner = panel(frame, area, &format!("{} · exam result", course.title), p);
    let chunks = Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(inner);

    let mut lines = vec![
        Line::default(),
        Line::from(vec![
            Span::styled("Band ", Style::default().fg(p.ink_soft)),
            Span::styled(
                result.band.clone(),
                Style::default().fg(p.primary).add_modifier(Modifier::BOLD),
            ),
        ]),
        Line::from(Span::styled(
            format!("Overall {}%", result.overall_score),
            Style::default().fg(p.pink).add_modifier(Modifier::BOLD),
        )),
        Line::default(),
    ];
    // Per-section breakdown.
    for s in &result.sections {
        lines.push(Line::from(vec![
            Span::styled(format!("{}: ", s.skill), Style::default().fg(p.ink_soft)),
            Span::styled(format!("{}%", s.score), Style::default().fg(p.ink)),
        ]));
    }
    if !result.feedback.is_empty() {
        lines.push(Line::default());
        lines.push(Line::from(Span::styled(
            result.feedback.clone(),
            Style::default().fg(p.ink_soft),
        )));
    }
    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .alignment(Alignment::Center)
            .wrap(Wrap { trim: true }),
        chunks[0],
    );
    frame.render_widget(Paragraph::new(hint_line(&["enter / q back"], p)), chunks[1]);
}

// --- Placement / memory / settings (P6d) -----------------------------------

fn draw_placement_lang(frame: &mut Frame, area: Rect, view: &View, p: &Palette) {
    let View::PlacementLang {
        native_cursor,
        target_cursor,
        column,
        loading,
    } = view
    else {
        return;
    };
    let inner = panel(frame, area, "New course · placement", p);
    let chunks = Layout::vertical([
        Constraint::Length(2),
        Constraint::Fill(1),
        Constraint::Length(1),
    ])
    .split(inner);

    frame.render_widget(
        Paragraph::new(Text::from(vec![
            Line::default(),
            Line::from(Span::styled(
                "Pick the language you speak and the one you're learning.",
                Style::default().fg(p.ink),
            )),
        ]))
        .wrap(Wrap { trim: true }),
        chunks[0],
    );

    // Two side-by-side language lists.
    let cols = Layout::horizontal([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(chunks[1]);
    draw_lang_column(
        frame,
        cols[0],
        "I speak",
        *native_cursor,
        matches!(column, LangColumn::Native),
        p,
    );
    draw_lang_column(
        frame,
        cols[1],
        "I'm learning",
        *target_cursor,
        matches!(column, LangColumn::Target),
        p,
    );

    let hints: &[&str] = if *loading {
        &["loading…", "q back"]
    } else {
        &["↑/↓ pick", "tab switch", "enter start", "q back"]
    };
    frame.render_widget(Paragraph::new(hint_line(hints, p)), chunks[2]);
}

fn draw_lang_column(
    frame: &mut Frame,
    area: Rect,
    title: &str,
    cursor: usize,
    focused: bool,
    p: &Palette,
) {
    let border = if focused { p.primary } else { p.ink_soft };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(border))
        .title(Span::styled(
            format!(" {title} "),
            Style::default().fg(border).add_modifier(Modifier::BOLD),
        ));
    let body = block.inner(area);
    frame.render_widget(block, area);

    let items: Vec<ListItem> = LANGUAGES
        .iter()
        .map(|(_, name)| {
            ListItem::new(Line::from(Span::styled(
                (*name).to_string(),
                Style::default().fg(p.ink),
            )))
        })
        .collect();
    let mut state = ListState::default();
    state.select(Some(cursor.min(LANGUAGES.len().saturating_sub(1))));
    let highlight = if focused { p.primary } else { p.ink_soft };
    let list = List::new(items)
        .highlight_style(Style::default().fg(highlight).add_modifier(Modifier::BOLD))
        .highlight_symbol("▌ ");
    frame.render_stateful_widget(list, body, &mut state);
}

fn draw_placement_review(frame: &mut Frame, area: Rect, view: &View, p: &Palette) {
    let View::PlacementReview {
        questions,
        index,
        cursor,
        prompt_scroll,
        submitting,
        ..
    } = view
    else {
        return;
    };
    let Some(q) = questions.get(*index) else {
        return;
    };
    let title = format!("Placement · {}/{}", index + 1, questions.len());
    let inner = panel(frame, area, &title, p);
    draw_choice_section(
        frame,
        inner,
        index + 1,
        questions.len(),
        &q.prompt,
        &q.options,
        *cursor,
        *prompt_scroll,
        if *submitting {
            &["submitting…", "q back"]
        } else {
            &["↑/↓ choose", "1-9 pick", "enter answer", "q back"]
        },
        p,
    );
}

fn draw_placement_result(frame: &mut Frame, area: Rect, outcome: &PlacementOutcome, p: &Palette) {
    let inner = panel(frame, area, "Placement result", p);
    let chunks = Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(inner);

    let mut lines = vec![
        Line::default(),
        Line::from(Span::styled(
            "Your assessed level",
            Style::default().fg(p.ink_soft),
        )),
        Line::from(Span::styled(
            outcome.level.clone(),
            Style::default().fg(p.primary).add_modifier(Modifier::BOLD),
        )),
        Line::default(),
    ];
    for (skill, score) in &outcome.score_by_skill {
        lines.push(Line::from(vec![
            Span::styled(format!("{skill}: "), Style::default().fg(p.ink_soft)),
            Span::styled(format!("{score}%"), Style::default().fg(p.ink)),
        ]));
    }
    lines.push(Line::default());
    lines.push(Line::from(Span::styled(
        "Your course is ready.",
        Style::default().fg(p.ink),
    )));
    frame.render_widget(
        Paragraph::new(Text::from(lines)).alignment(Alignment::Center),
        chunks[0],
    );
    frame.render_widget(
        Paragraph::new(hint_line(&["enter start course", "q back"], p)),
        chunks[1],
    );
}

fn draw_notes_placement(
    frame: &mut Frame,
    area: Rect,
    input: &str,
    phase: &NotesPhase,
    p: &Palette,
) {
    let inner = panel(frame, area, "Place me from my materials", p);
    let chunks = Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(inner);

    let (body, hints, align): (Text, &[&str], Alignment) = match phase {
        NotesPhase::Entry => {
            let mut lines = vec![
                Line::from(Span::styled(
                    "Paste notes, a lesson, or your own writing in your target language:",
                    Style::default().fg(p.ink_soft),
                )),
                Line::default(),
            ];
            for line in input.split('\n') {
                lines.push(Line::from(Span::styled(
                    line.to_string(),
                    Style::default().fg(p.ink),
                )));
            }
            // A block cursor so the editor reads as a live text field.
            lines.push(Line::from(Span::styled(
                "\u{2588}",
                Style::default().fg(p.primary),
            )));
            (
                Text::from(lines),
                &["ctrl-d find my level", "esc back"][..],
                Alignment::Left,
            )
        }
        NotesPhase::Deducing => (
            Text::from("Reading your materials..."),
            &[][..],
            Alignment::Center,
        ),
        NotesPhase::Result {
            level,
            rationale,
            confidence,
        } => {
            let lines = vec![
                Line::from(Span::styled(
                    "Estimated level",
                    Style::default().fg(p.ink_soft),
                )),
                Line::from(Span::styled(
                    level.clone(),
                    Style::default().fg(p.primary).add_modifier(Modifier::BOLD),
                )),
                Line::default(),
                Line::from(Span::styled(rationale.clone(), Style::default().fg(p.ink))),
                Line::default(),
                Line::from(Span::styled(
                    format!("Confidence: {confidence}%"),
                    Style::default().fg(p.ink_soft),
                )),
                Line::default(),
                Line::from(Span::styled(
                    "Starting here never lowers a level you have already reached.",
                    Style::default().fg(p.ink_soft),
                )),
            ];
            (
                Text::from(lines),
                &["enter start here", "t take the test", "esc back"][..],
                Alignment::Center,
            )
        }
        NotesPhase::Confirming => (
            Text::from("Setting up your course..."),
            &[][..],
            Alignment::Center,
        ),
    };

    frame.render_widget(
        Paragraph::new(body)
            .alignment(align)
            .wrap(Wrap { trim: false }),
        chunks[0],
    );
    if !hints.is_empty() {
        frame.render_widget(Paragraph::new(hint_line(hints, p)), chunks[1]);
    }
}
