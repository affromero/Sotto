fn draw_memory(frame: &mut Frame, area: Rect, view: &View, p: &Palette) {
    let View::Memory {
        course,
        items,
        scroll,
    } = view
    else {
        return;
    };
    let inner = panel(frame, area, &format!("{} · memory", course.title), p);
    let chunks = Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(inner);

    let Some(items) = items else {
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                "Loading memory…",
                Style::default().fg(p.primary).add_modifier(Modifier::BOLD),
            )))
            .alignment(Alignment::Center),
            chunks[0],
        );
        return;
    };

    if items.is_empty() {
        frame.render_widget(
            Paragraph::new(Text::from(vec![
                Line::default(),
                Line::from(Span::styled(
                    "No vocabulary or grammar tracked yet.",
                    Style::default().fg(p.ink_soft),
                )),
                Line::from(Span::styled(
                    "Work through some practice to build your memory graph.",
                    Style::default().fg(p.ink_soft),
                )),
            ]))
            .alignment(Alignment::Center),
            chunks[0],
        );
    } else {
        let rows: Vec<ListItem> = items.iter().map(|item| memory_row(item, p)).collect();
        let mut state = ListState::default();
        state.select(Some((*scroll).min(items.len().saturating_sub(1))));
        let list = List::new(rows)
            .highlight_style(Style::default().fg(p.primary).add_modifier(Modifier::BOLD))
            .highlight_symbol("▌ ");
        frame.render_stateful_widget(list, chunks[0], &mut state);
    }

    frame.render_widget(
        Paragraph::new(hint_line(&["↑/↓ scroll", "q back"], p)),
        chunks[1],
    );
}

fn memory_row(item: &MemoryItem, p: &Palette) -> ListItem<'static> {
    let kind_tag = if item.kind == "vocab" { "V" } else { "G" };
    let term = match &item.translation {
        Some(t) if !t.is_empty() => format!("{} — {}", item.label, t),
        _ => item.label.clone(),
    };
    let due = if item.due { " · due" } else { "" };
    ListItem::new(Line::from(vec![
        Span::styled(format!("[{kind_tag}] "), Style::default().fg(p.ink_soft)),
        Span::styled(term, Style::default().fg(p.ink)),
        Span::styled(
            format!("  {}%{}", item.mastery, due),
            Style::default().fg(if item.due { p.pink } else { p.ink_soft }),
        ),
    ]))
}

fn draw_settings(frame: &mut Frame, area: Rect, config: Option<&ConfigView>, p: &Palette) {
    let inner = panel(frame, area, "Settings", p);
    let chunks = Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(inner);

    let Some(config) = config else {
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                "Loading config…",
                Style::default().fg(p.primary).add_modifier(Modifier::BOLD),
            )))
            .alignment(Alignment::Center),
            chunks[0],
        );
        return;
    };

    let on_off = |b: bool| if b { "yes" } else { "no" };
    let mut lines = vec![
        Line::default(),
        Line::from(vec![
            Span::styled("Self-hosted  ", Style::default().fg(p.ink_soft)),
            Span::styled(on_off(config.self_hosted), Style::default().fg(p.ink)),
        ]),
        Line::from(vec![
            Span::styled("Owner        ", Style::default().fg(p.ink_soft)),
            Span::styled(on_off(config.is_owner), Style::default().fg(p.ink)),
        ]),
        Line::default(),
    ];
    match &config.infra {
        Some(infra) => {
            let field = |label: &str, v: &Option<String>| {
                let value = v.clone().unwrap_or_else(|| "—".to_string());
                Line::from(vec![
                    Span::styled(format!("{label:<10}"), Style::default().fg(p.ink_soft)),
                    Span::styled(value, Style::default().fg(p.ink)),
                ])
            };
            lines.push(Line::from(Span::styled(
                "Providers",
                Style::default().fg(p.primary).add_modifier(Modifier::BOLD),
            )));
            lines.push(field("AI", &infra.ai_provider));
            lines.push(field("AI model", &infra.ai_model));
            lines.push(field("STT", &infra.stt_provider));
            lines.push(field("TTS", &infra.tts_provider));
            lines.push(field("Storage", &infra.storage_provider));
        }
        None => {
            lines.push(Line::from(Span::styled(
                "Provider config is owner-only.",
                Style::default().fg(p.ink_soft),
            )));
        }
    }
    lines.push(Line::default());
    lines.push(Line::from(Span::styled(
        "Edit providers and BYOK keys in the web app's /settings.",
        Style::default()
            .fg(p.ink_soft)
            .add_modifier(Modifier::ITALIC),
    )));
    frame.render_widget(
        Paragraph::new(Text::from(lines)).wrap(Wrap { trim: true }),
        chunks[0],
    );
    frame.render_widget(Paragraph::new(hint_line(&["q back"], p)), chunks[1]);
}

// --- Adaptive-listening Q&A overlay (P6e) -----------------------------------

fn draw_ask_overlay(frame: &mut Frame, area: Rect, ask: &AskState, p: &Palette) {
    let mut lines: Vec<Line> = vec![Line::from(Span::styled(
        "Ask about this lesson",
        Style::default().fg(p.primary).add_modifier(Modifier::BOLD),
    ))];

    match &ask.phase {
        AskPhase::Editing => {
            lines.push(Line::default());
            // The typed question, line by line (cursor implied at the end).
            for l in ask.input.lines() {
                lines.push(Line::from(Span::styled(
                    l.clone(),
                    Style::default().fg(p.ink),
                )));
            }
            if ask.input.is_empty() {
                lines.push(Line::from(Span::styled(
                    "Type your question…",
                    Style::default()
                        .fg(p.ink_soft)
                        .add_modifier(Modifier::ITALIC),
                )));
            }
        }
        AskPhase::Asking => {
            lines.push(Line::default());
            lines.push(Line::from(Span::styled(
                "Sending…",
                Style::default()
                    .fg(p.ink_soft)
                    .add_modifier(Modifier::ITALIC),
            )));
        }
        AskPhase::Polling { .. } => {
            lines.push(Line::default());
            lines.push(Line::from(Span::styled(
                "Thinking…",
                Style::default()
                    .fg(p.ink_soft)
                    .add_modifier(Modifier::ITALIC),
            )));
        }
        AskPhase::Answered {
            answer,
            answer_audio,
        } => {
            lines.push(Line::default());
            lines.push(Line::from(Span::styled(
                "Answer",
                Style::default().fg(p.ink_soft),
            )));
            for paragraph in answer.split('\n') {
                lines.push(Line::from(Span::styled(
                    paragraph.to_string(),
                    Style::default().fg(p.ink),
                )));
            }
            if answer_audio.is_some() {
                lines.push(Line::default());
                lines.push(Line::from(Span::styled(
                    "♪ Playing spoken clarification…",
                    Style::default().fg(p.primary),
                )));
            }
        }
        AskPhase::Failed { message } => {
            lines.push(Line::default());
            lines.push(Line::from(Span::styled(
                message.clone(),
                Style::default().fg(p.pink),
            )));
        }
    }

    frame.render_widget(
        Paragraph::new(Text::from(lines)).wrap(Wrap { trim: true }),
        area,
    );
}

fn ask_hints(ask: &AskState) -> &'static [&'static str] {
    match &ask.phase {
        AskPhase::Editing => &["type question", "enter newline", "Ctrl-D ask", "esc close"],
        AskPhase::Asking | AskPhase::Polling { .. } => &["esc close"],
        AskPhase::Answered { .. } => &["a ask again", "enter / esc close"],
        AskPhase::Failed { .. } => &["r / Ctrl-D retry", "esc close"],
    }
}
