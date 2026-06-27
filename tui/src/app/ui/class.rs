fn draw_class(frame: &mut Frame, area: Rect, view: &View, p: &Palette) {
    let View::Class {
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
        // Class is still loading its sections.
        let inner = panel(frame, area, &format!("{} · class", course.title), p);
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                "Loading class…",
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
        "{} · class — section {}/{} ({})",
        course.title,
        cursor + 1,
        sections.len(),
        skill_label(section.skill)
    );
    let inner = panel(frame, area, &title, p);

    if *submitting {
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                "Submitting class…",
                Style::default()
                    .fg(p.ink_soft)
                    .add_modifier(Modifier::ITALIC),
            )))
            .alignment(Alignment::Center),
            inner,
        );
        return;
    }

    draw_section(frame, inner, section, p);
}

fn draw_section(frame: &mut Frame, area: Rect, section: &ClassSection, p: &Palette) {
    match &section.progress {
        SectionProgress::Mc {
            questions,
            index,
            cursor,
            prompt_scroll,
            ..
        } => {
            if let Some(q) = questions.get(*index) {
                draw_choice_section(
                    frame,
                    area,
                    index + 1,
                    questions.len(),
                    &q.prompt,
                    &q.options,
                    *cursor,
                    *prompt_scroll,
                    &[
                        "↑/↓ choose",
                        "1-9 pick",
                        "PgUp/PgDn scroll",
                        "enter answer",
                        "q back",
                    ],
                    p,
                );
            }
        }
        SectionProgress::Listening {
            questions,
            index,
            cursor,
            episode,
            audio_note,
            ask,
            ..
        } => {
            let chunks = Layout::vertical([Constraint::Length(1), Constraint::Fill(1)]).split(area);
            let status = audio_note.clone().unwrap_or_else(|| match episode {
                Some(_) => "Press space to play the episode.".to_string(),
                None => "Loading episode…".to_string(),
            });
            frame.render_widget(
                Paragraph::new(Line::from(Span::styled(
                    status,
                    Style::default().fg(p.primary),
                ))),
                chunks[0],
            );
            if ask.open {
                // The Q&A overlay takes over the body + its own hint line.
                let body =
                    Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(chunks[1]);
                draw_ask_overlay(frame, body[0], ask, p);
                frame.render_widget(Paragraph::new(hint_line(ask_hints(ask), p)), body[1]);
            } else if let Some(q) = questions.get(*index) {
                draw_choice_section(
                    frame,
                    chunks[1],
                    index + 1,
                    questions.len(),
                    &q.prompt,
                    &q.options,
                    *cursor,
                    0,
                    &[
                        "space play",
                        "a ask",
                        "↑/↓ choose",
                        "enter answer",
                        "q back",
                    ],
                    p,
                );
            } else {
                // No comprehension questions: transcript only.
                let lines: Vec<Line> = match episode {
                    Some(ep) => ep
                        .segments
                        .iter()
                        .map(|s| {
                            Line::from(vec![
                                Span::styled(
                                    format!("{}: ", s.speaker),
                                    Style::default().fg(p.ink_soft).add_modifier(Modifier::BOLD),
                                ),
                                Span::styled(s.text.clone(), Style::default().fg(p.ink)),
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
        }
        SectionProgress::Speaking {
            prompts,
            index,
            phase,
        } => {
            let chunks = Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(area);
            let mut lines: Vec<Line> = Vec::new();
            if let Some(prompt) = prompts.get(*index) {
                lines.push(Line::from(Span::styled(
                    format!("Prompt {}/{}", index + 1, prompts.len()),
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
            lines.push(speaking_phase_line(phase, p));
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
        SectionProgress::Writing {
            prompts,
            index,
            input,
            phase,
        } => {
            let chunks = Layout::vertical([
                Constraint::Length(4),
                Constraint::Fill(1),
                Constraint::Length(1),
            ])
            .split(area);
            let mut head: Vec<Line> = Vec::new();
            if let Some(prompt) = prompts.get(*index) {
                head.push(Line::from(Span::styled(
                    format!("Writing {}/{}: {}", index + 1, prompts.len(), prompt.task),
                    Style::default().fg(p.ink).add_modifier(Modifier::BOLD),
                )));
                if let Some(g) = &prompt.guidance {
                    head.push(Line::from(Span::styled(
                        g.clone(),
                        Style::default().fg(p.ink_soft),
                    )));
                }
            }
            frame.render_widget(
                Paragraph::new(Text::from(head)).wrap(Wrap { trim: true }),
                chunks[0],
            );

            match phase {
                WritingPhase::Editing | WritingPhase::Submitting => {
                    let text: Vec<Line> = input
                        .lines()
                        .iter()
                        .map(|l| Line::from(Span::styled(l.clone(), Style::default().fg(p.ink))))
                        .collect();
                    frame.render_widget(
                        Paragraph::new(Text::from(text))
                            .wrap(Wrap { trim: false })
                            .block(
                                Block::default()
                                    .borders(Borders::ALL)
                                    .border_style(Style::default().fg(p.ink_soft)),
                            ),
                        chunks[1],
                    );
                }
                WritingPhase::Graded { score, feedback } => {
                    frame.render_widget(
                        Paragraph::new(Text::from(vec![
                            Line::from(Span::styled(
                                format!("Score: {score}%"),
                                Style::default().fg(p.pink).add_modifier(Modifier::BOLD),
                            )),
                            Line::from(Span::styled(feedback.clone(), Style::default().fg(p.ink))),
                        ]))
                        .wrap(Wrap { trim: true }),
                        chunks[1],
                    );
                }
                WritingPhase::Failed { message } => {
                    frame.render_widget(
                        Paragraph::new(Line::from(Span::styled(
                            message.clone(),
                            Style::default().fg(p.pink),
                        )))
                        .wrap(Wrap { trim: true }),
                        chunks[1],
                    );
                }
            }

            let hints: &[&str] = match phase {
                WritingPhase::Editing => {
                    &["type to write", "enter newline", "Ctrl-D submit", "q back"]
                }
                WritingPhase::Submitting => &["submitting…", "q back"],
                WritingPhase::Graded { .. } => &["enter continue", "q back"],
                WritingPhase::Failed { .. } => &["r / Ctrl-D resubmit", "q back"],
            };
            frame.render_widget(Paragraph::new(hint_line(hints, p)), chunks[2]);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn draw_choice_section(
    frame: &mut Frame,
    area: Rect,
    n: usize,
    total: usize,
    prompt: &str,
    options: &[String],
    cursor: usize,
    prompt_scroll: u16,
    hints: &[&str],
    p: &Palette,
) {
    let option_rows = (options.len() as u16).saturating_add(1).max(2);
    let chunks = Layout::vertical([
        Constraint::Fill(1),
        Constraint::Length(option_rows),
        Constraint::Length(1),
    ])
    .split(area);

    frame.render_widget(
        Paragraph::new(Span::styled(
            format!("Q{n}/{total}: {prompt}"),
            Style::default().fg(p.ink).add_modifier(Modifier::BOLD),
        ))
        .wrap(Wrap { trim: true })
        .scroll((prompt_scroll, 0)),
        chunks[0],
    );

    let items: Vec<ListItem> = options
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
    if !options.is_empty() {
        list_state.select(Some(cursor.min(options.len() - 1)));
    }
    frame.render_stateful_widget(list, chunks[1], &mut list_state);
    frame.render_widget(Paragraph::new(hint_line(hints, p)), chunks[2]);
}

fn speaking_phase_line(phase: &SpeakingPhase, p: &Palette) -> Line<'static> {
    match phase {
        SpeakingPhase::Idle => Line::from(Span::styled(
            "Press r to record.",
            Style::default().fg(p.ink),
        )),
        SpeakingPhase::Recording => Line::from(Span::styled(
            "● Recording — press r to stop.",
            Style::default().fg(p.pink).add_modifier(Modifier::BOLD),
        )),
        SpeakingPhase::Uploading => Line::from(Span::styled(
            "Uploading…",
            Style::default()
                .fg(p.ink_soft)
                .add_modifier(Modifier::ITALIC),
        )),
        SpeakingPhase::Polling { .. } => Line::from(Span::styled(
            "Grading…",
            Style::default()
                .fg(p.ink_soft)
                .add_modifier(Modifier::ITALIC),
        )),
        SpeakingPhase::Graded { score, .. } => Line::from(Span::styled(
            format!(
                "Score: {}",
                score.map_or_else(|| "—".to_string(), |s| format!("{s}%"))
            ),
            Style::default().fg(p.pink).add_modifier(Modifier::BOLD),
        )),
        SpeakingPhase::Failed { message } => {
            Line::from(Span::styled(message.clone(), Style::default().fg(p.pink)))
        }
    }
}

fn draw_class_result(
    frame: &mut Frame,
    area: Rect,
    course: &Course,
    result: &ClassResult,
    p: &Palette,
) {
    let inner = panel(frame, area, &format!("{} · class result", course.title), p);
    let chunks = Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(inner);

    let (verdict, color) = if result.passed {
        ("Passed — gate released", p.primary)
    } else {
        ("Not passed yet", p.pink)
    };
    let body = Text::from(vec![
        Line::default(),
        Line::from(Span::styled(
            verdict,
            Style::default().fg(color).add_modifier(Modifier::BOLD),
        )),
        Line::default(),
        Line::from(Span::styled(
            format!("{}%", result.overall_score),
            Style::default().fg(p.pink).add_modifier(Modifier::BOLD),
        )),
        Line::from(Span::styled(
            format!(
                "{} of {} sections passed",
                result.passed_sections, result.total_sections
            ),
            Style::default().fg(p.ink_soft),
        )),
    ]);
    frame.render_widget(Paragraph::new(body).alignment(Alignment::Center), chunks[0]);

    let hints: &[&str] = if result.passed {
        &["n next class", "q back"]
    } else {
        &["n retry / continue", "q back"]
    };
    frame.render_widget(Paragraph::new(hint_line(hints, p)), chunks[1]);
}

fn draw_class_done(frame: &mut Frame, area: Rect, course: &Course, p: &Palette) {
    let inner = panel(frame, area, &format!("{} · complete", course.title), p);
    let chunks = Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(inner);
    frame.render_widget(
        Paragraph::new(Text::from(vec![
            Line::default(),
            Line::from(Span::styled(
                "You've completed the course curriculum.",
                Style::default().fg(p.primary).add_modifier(Modifier::BOLD),
            )),
        ]))
        .alignment(Alignment::Center),
        chunks[0],
    );
    frame.render_widget(Paragraph::new(hint_line(&["q back"], p)), chunks[1]);
}

// --- Exams -----------------------------------------------------------------
