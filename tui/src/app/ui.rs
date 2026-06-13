//! Rendering for the practice screens. Pure draw functions: they take the
//! current [`View`] and paint it, with no side effects on app state.

use ratatui::{
    Frame,
    layout::{Alignment, Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Wrap},
};

use crate::config::Config;

use super::state::{
    ClassResult, ClassSection, Course, DueCounts, PracticeResult, ReviewKind, SectionProgress,
    SkillChoice, SpeakingPhase, Unavailable, View, WritingPhase, can_review_vocab,
};
use crate::api::types::SkillType;

// aula palette, matching components/status_bar.rs.
const AULA_BLUE: Color = Color::Rgb(0x3F, 0x4F, 0xB0);
const INK_SLATE: Color = Color::Rgb(0x2A, 0x35, 0x50);
const INK: Color = Color::Rgb(0x1E, 0x21, 0x28);
const INK_MUTED: Color = Color::Rgb(0x56, 0x5B, 0x68);
const PINK: Color = Color::Rgb(0xFF, 0x8F, 0xB1);

/// Draw the active screen into `area`.
pub(super) fn draw_view(frame: &mut Frame, area: Rect, view: &View, config: &Config) {
    match view {
        View::Loading => draw_loading(frame, area, config),
        View::Error { message, .. } => draw_error(frame, area, message),
        View::Courses { courses, cursor } => draw_courses(frame, area, courses, *cursor),
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
                );
            }
        }
        View::ListeningReview { .. } => draw_listening_review(frame, area, view),
        View::SpeakingReview { .. } => draw_speaking_review(frame, area, view),
        View::Result { course, result } => draw_result(frame, area, course, result),
        View::Class { .. } => draw_class(frame, area, view),
        View::ClassOutcome { course, result } => draw_class_result(frame, area, course, result),
        View::ClassDone { course } => draw_class_done(frame, area, course),
    }
}

/// Outer titled panel shared by every screen. Returns the inner content area.
fn panel(frame: &mut Frame, area: Rect, title: &str) -> Rect {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(AULA_BLUE))
        .title(Span::styled(
            format!(" {title} "),
            Style::default().fg(AULA_BLUE).add_modifier(Modifier::BOLD),
        ));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    inner
}

fn hint_line(hints: &[&str]) -> Line<'static> {
    let mut spans: Vec<Span<'static>> = Vec::new();
    for (i, hint) in hints.iter().enumerate() {
        if i > 0 {
            spans.push(Span::styled("   ", Style::default().fg(INK_MUTED)));
        }
        spans.push(Span::styled(
            hint.to_string(),
            Style::default().fg(INK_MUTED),
        ));
    }
    Line::from(spans)
}

fn draw_loading(frame: &mut Frame, area: Rect, config: &Config) {
    let inner = panel(frame, area, "Sotto");
    let body = Text::from(vec![
        Line::default(),
        Line::from(Span::styled(
            "Loading your courses…",
            Style::default().fg(AULA_BLUE).add_modifier(Modifier::BOLD),
        )),
        Line::default(),
        Line::from(Span::styled(
            format!("Connected to {}", config.server_url),
            Style::default().fg(INK_MUTED),
        )),
    ]);
    frame.render_widget(Paragraph::new(body).alignment(Alignment::Center), inner);
}

fn draw_error(frame: &mut Frame, area: Rect, message: &str) {
    let inner = panel(frame, area, "Sotto");
    let chunks = Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(inner);

    let body = Text::from(vec![
        Line::default(),
        Line::from(Span::styled(
            "Could not load your courses",
            Style::default().fg(PINK).add_modifier(Modifier::BOLD),
        )),
        Line::default(),
        Line::from(Span::styled(
            message.to_string(),
            Style::default().fg(INK_MUTED),
        )),
    ]);
    frame.render_widget(
        Paragraph::new(body)
            .alignment(Alignment::Center)
            .wrap(Wrap { trim: true }),
        chunks[0],
    );

    frame.render_widget(Paragraph::new(hint_line(&["r retry", "q quit"])), chunks[1]);
}

fn draw_courses(frame: &mut Frame, area: Rect, courses: &[Course], cursor: usize) {
    let inner = panel(frame, area, "Courses");
    let chunks = Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(inner);

    if courses.is_empty() {
        let body = Paragraph::new(Text::from(vec![
            Line::default(),
            Line::from(Span::styled("No courses yet.", Style::default().fg(INK))),
            Line::from(Span::styled(
                "Create one in the web app, then come back.",
                Style::default().fg(INK_MUTED),
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
                    Span::styled(format!("{}. ", i + 1), Style::default().fg(INK_MUTED)),
                    Span::styled(
                        course.title.clone(),
                        Style::default().fg(INK).add_modifier(Modifier::BOLD),
                    ),
                ]);
                let sub = Line::from(Span::styled(
                    format!(
                        "   {} → {} · {}",
                        course.native_lang, course.target_lang, course.current_level
                    ),
                    Style::default().fg(INK_MUTED),
                ));
                ListItem::new(vec![head, sub])
            })
            .collect();

        let list = List::new(items)
            .highlight_style(Style::default().fg(AULA_BLUE).add_modifier(Modifier::BOLD))
            .highlight_symbol("▌ ");
        let mut list_state = ListState::default();
        list_state.select(Some(cursor.min(courses.len().saturating_sub(1))));
        frame.render_stateful_widget(list, chunks[0], &mut list_state);
    }

    frame.render_widget(
        Paragraph::new(hint_line(&["↑/↓ move", "1-9 jump", "enter open", "q quit"])),
        chunks[1],
    );
}

fn draw_course_home(
    frame: &mut Frame,
    area: Rect,
    course: &Course,
    due: &DueCounts,
    menu_cursor: usize,
    notice: Option<&Unavailable>,
    starting: bool,
) {
    let inner = panel(frame, area, &course.title);
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
                Style::default().fg(INK).add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!("   level {}", course.current_level),
                Style::default().fg(INK_MUTED),
            ),
        ]),
        Line::from(vec![
            Span::styled("Due  ", Style::default().fg(INK_MUTED)),
            Span::styled(
                format!("{} vocab", due.vocab),
                Style::default().fg(AULA_BLUE).add_modifier(Modifier::BOLD),
            ),
            Span::styled("   ", Style::default().fg(INK_MUTED)),
            Span::styled(
                format!("{} grammar", due.grammar),
                Style::default().fg(INK_SLATE),
            ),
            Span::styled(
                format!("   {} words tracked", due.total_vocab),
                Style::default().fg(INK_MUTED),
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
                Style::default().fg(INK_MUTED)
            } else {
                Style::default().fg(INK).add_modifier(Modifier::BOLD)
            };
            let suffix = if disabled { "  (nothing due)" } else { "" };
            ListItem::new(Line::from(Span::styled(
                format!("{}{}", skill.label(), suffix),
                style,
            )))
        })
        .collect();
    let list = List::new(items)
        .highlight_style(Style::default().fg(AULA_BLUE).add_modifier(Modifier::BOLD))
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
                .fg(INK_MUTED)
                .add_modifier(Modifier::ITALIC),
        )));
    }
    if let Some(reason) = notice {
        footer.push(Line::from(Span::styled(
            reason.message(),
            Style::default().fg(PINK).add_modifier(Modifier::BOLD),
        )));
    }
    frame.render_widget(
        Paragraph::new(Text::from(footer)).wrap(Wrap { trim: true }),
        chunks[2],
    );

    let hints: &[&str] = if starting {
        &["q back"]
    } else {
        &["↑/↓ skill", "enter start", "q back"]
    };
    frame.render_widget(Paragraph::new(hint_line(hints)), chunks[3]);
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
fn draw_item_review(frame: &mut Frame, area: Rect, v: ItemReviewView) {
    let title = format!(
        "{} · {} {}/{}",
        v.course.title,
        v.kind.label(),
        v.index + 1,
        v.total
    );
    let inner = panel(frame, area, &title);
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
        Style::default().fg(INK).add_modifier(Modifier::BOLD),
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
                Span::styled(format!("{}. ", i + 1), Style::default().fg(INK_MUTED)),
                Span::styled(option.clone(), Style::default().fg(INK)),
            ]))
        })
        .collect();

    let list = List::new(items)
        .highlight_style(Style::default().fg(AULA_BLUE).add_modifier(Modifier::BOLD))
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
    frame.render_widget(Paragraph::new(hint_line(hints)), chunks[2]);
}

fn draw_result(frame: &mut Frame, area: Rect, course: &Course, result: &PracticeResult) {
    let inner = panel(frame, area, &format!("{} · results", course.title));
    let chunks = Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(inner);

    let body = Text::from(vec![
        Line::default(),
        Line::from(Span::styled(
            "Review complete",
            Style::default().fg(AULA_BLUE).add_modifier(Modifier::BOLD),
        )),
        Line::default(),
        Line::from(Span::styled(
            format!("{}%", result.score),
            Style::default().fg(PINK).add_modifier(Modifier::BOLD),
        )),
        Line::from(Span::styled(
            format!("{} of {} correct", result.correct, result.total),
            Style::default().fg(INK_MUTED),
        )),
    ]);
    frame.render_widget(Paragraph::new(body).alignment(Alignment::Center), chunks[0]);

    frame.render_widget(
        Paragraph::new(hint_line(&["enter continue", "q back"])),
        chunks[1],
    );
}

fn draw_listening_review(frame: &mut Frame, area: Rect, view: &View) {
    let View::ListeningReview {
        course,
        episode,
        items,
        index,
        cursor,
        submitting,
        audio_note,
        ..
    } = view
    else {
        return;
    };

    let title = match episode {
        Some(ep) => format!("{} · listening — {}", course.title, ep.title),
        None => format!("{} · listening", course.title),
    };
    let inner = panel(frame, area, &title);
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
            Style::default().fg(AULA_BLUE),
        ))),
        chunks[0],
    );

    // Middle: either the current comprehension item, or the transcript.
    if let Some(item) = items.get(*index) {
        // Comprehension question with selectable options.
        let body = Layout::vertical([Constraint::Length(2), Constraint::Fill(1)]).split(chunks[1]);
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                format!("Q{}/{}: {}", index + 1, items.len(), item.prompt),
                Style::default().fg(INK).add_modifier(Modifier::BOLD),
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
                    Span::styled(format!("{}. ", i + 1), Style::default().fg(INK_MUTED)),
                    Span::styled(option.clone(), Style::default().fg(INK)),
                ]))
            })
            .collect();
        let list = List::new(opts)
            .highlight_style(Style::default().fg(AULA_BLUE).add_modifier(Modifier::BOLD))
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
                            Style::default().fg(INK_MUTED).add_modifier(Modifier::BOLD),
                        ),
                        Span::styled(seg.text.clone(), Style::default().fg(INK)),
                    ])
                })
                .collect(),
            None => vec![Line::from(Span::styled(
                "Loading transcript…",
                Style::default().fg(INK_MUTED),
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
        &["space play/pause", "q back"]
    } else {
        &["space play/pause", "↑/↓ choose", "enter answer", "q back"]
    };
    frame.render_widget(Paragraph::new(hint_line(hints)), chunks[2]);
}

fn draw_speaking_review(frame: &mut Frame, area: Rect, view: &View) {
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
    let inner = panel(frame, area, &title);
    let chunks = Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(inner);

    let mut lines: Vec<Line> = Vec::new();
    if let Some(prompt) = prompts.get(*index) {
        lines.push(Line::default());
        lines.push(Line::from(Span::styled(
            "Say this aloud:",
            Style::default().fg(INK_MUTED),
        )));
        lines.push(Line::from(Span::styled(
            prompt.target_phrase.clone(),
            Style::default().fg(AULA_BLUE).add_modifier(Modifier::BOLD),
        )));
        lines.push(Line::from(Span::styled(
            prompt.translation.clone(),
            Style::default().fg(INK_MUTED),
        )));
        lines.push(Line::default());
    }

    match phase {
        SpeakingPhase::Idle => lines.push(Line::from(Span::styled(
            "Press r to record.",
            Style::default().fg(INK),
        ))),
        SpeakingPhase::Recording => lines.push(Line::from(Span::styled(
            "● Recording — press r to stop.",
            Style::default().fg(PINK).add_modifier(Modifier::BOLD),
        ))),
        SpeakingPhase::Uploading => lines.push(Line::from(Span::styled(
            "Uploading…",
            Style::default()
                .fg(INK_MUTED)
                .add_modifier(Modifier::ITALIC),
        ))),
        SpeakingPhase::Polling { .. } => lines.push(Line::from(Span::styled(
            "Grading…",
            Style::default()
                .fg(INK_MUTED)
                .add_modifier(Modifier::ITALIC),
        ))),
        SpeakingPhase::Graded {
            score,
            transcript,
            feedback,
        } => {
            lines.push(Line::from(vec![
                Span::styled("Score: ", Style::default().fg(INK_MUTED)),
                Span::styled(
                    score.map_or_else(|| "—".to_string(), |s| format!("{s}%")),
                    Style::default().fg(PINK).add_modifier(Modifier::BOLD),
                ),
            ]));
            if let Some(t) = transcript {
                lines.push(Line::from(Span::styled(
                    format!("Heard: {t}"),
                    Style::default().fg(INK),
                )));
            }
            if let Some(f) = feedback {
                lines.push(Line::from(Span::styled(
                    f.clone(),
                    Style::default().fg(INK_MUTED),
                )));
            }
        }
        SpeakingPhase::Failed { message } => lines.push(Line::from(Span::styled(
            message.clone(),
            Style::default().fg(PINK),
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
    frame.render_widget(Paragraph::new(hint_line(hints)), chunks[1]);
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

fn draw_class(frame: &mut Frame, area: Rect, view: &View) {
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
        let inner = panel(frame, area, &format!("{} · class", course.title));
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                "Loading class…",
                Style::default().fg(AULA_BLUE).add_modifier(Modifier::BOLD),
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
    let inner = panel(frame, area, &title);

    if *submitting {
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                "Submitting class…",
                Style::default()
                    .fg(INK_MUTED)
                    .add_modifier(Modifier::ITALIC),
            )))
            .alignment(Alignment::Center),
            inner,
        );
        return;
    }

    draw_section(frame, inner, section);
}

fn draw_section(frame: &mut Frame, area: Rect, section: &ClassSection) {
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
                );
            }
        }
        SectionProgress::Listening {
            questions,
            index,
            cursor,
            episode,
            audio_note,
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
                    Style::default().fg(AULA_BLUE),
                ))),
                chunks[0],
            );
            if let Some(q) = questions.get(*index) {
                draw_choice_section(
                    frame,
                    chunks[1],
                    index + 1,
                    questions.len(),
                    &q.prompt,
                    &q.options,
                    *cursor,
                    0,
                    &["space play", "↑/↓ choose", "enter answer", "q back"],
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
                                    Style::default().fg(INK_MUTED).add_modifier(Modifier::BOLD),
                                ),
                                Span::styled(s.text.clone(), Style::default().fg(INK)),
                            ])
                        })
                        .collect(),
                    None => vec![Line::from(Span::styled(
                        "Loading transcript…",
                        Style::default().fg(INK_MUTED),
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
            if let Some(p) = prompts.get(*index) {
                lines.push(Line::from(Span::styled(
                    format!("Prompt {}/{}", index + 1, prompts.len()),
                    Style::default().fg(INK_MUTED),
                )));
                lines.push(Line::from(Span::styled(
                    p.target_phrase.clone(),
                    Style::default().fg(AULA_BLUE).add_modifier(Modifier::BOLD),
                )));
                lines.push(Line::from(Span::styled(
                    p.translation.clone(),
                    Style::default().fg(INK_MUTED),
                )));
                lines.push(Line::default());
            }
            lines.push(speaking_phase_line(phase));
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
            frame.render_widget(Paragraph::new(hint_line(hints)), chunks[1]);
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
            if let Some(p) = prompts.get(*index) {
                head.push(Line::from(Span::styled(
                    format!("Writing {}/{}: {}", index + 1, prompts.len(), p.task),
                    Style::default().fg(INK).add_modifier(Modifier::BOLD),
                )));
                if let Some(g) = &p.guidance {
                    head.push(Line::from(Span::styled(
                        g.clone(),
                        Style::default().fg(INK_MUTED),
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
                        .map(|l| Line::from(Span::styled(l.clone(), Style::default().fg(INK))))
                        .collect();
                    frame.render_widget(
                        Paragraph::new(Text::from(text))
                            .wrap(Wrap { trim: false })
                            .block(
                                Block::default()
                                    .borders(Borders::ALL)
                                    .border_style(Style::default().fg(INK_MUTED)),
                            ),
                        chunks[1],
                    );
                }
                WritingPhase::Graded { score, feedback } => {
                    frame.render_widget(
                        Paragraph::new(Text::from(vec![
                            Line::from(Span::styled(
                                format!("Score: {score}%"),
                                Style::default().fg(PINK).add_modifier(Modifier::BOLD),
                            )),
                            Line::from(Span::styled(feedback.clone(), Style::default().fg(INK))),
                        ]))
                        .wrap(Wrap { trim: true }),
                        chunks[1],
                    );
                }
                WritingPhase::Failed { message } => {
                    frame.render_widget(
                        Paragraph::new(Line::from(Span::styled(
                            message.clone(),
                            Style::default().fg(PINK),
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
            frame.render_widget(Paragraph::new(hint_line(hints)), chunks[2]);
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
            Style::default().fg(INK).add_modifier(Modifier::BOLD),
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
                Span::styled(format!("{}. ", i + 1), Style::default().fg(INK_MUTED)),
                Span::styled(option.clone(), Style::default().fg(INK)),
            ]))
        })
        .collect();
    let list = List::new(items)
        .highlight_style(Style::default().fg(AULA_BLUE).add_modifier(Modifier::BOLD))
        .highlight_symbol("▌ ");
    let mut list_state = ListState::default();
    if !options.is_empty() {
        list_state.select(Some(cursor.min(options.len() - 1)));
    }
    frame.render_stateful_widget(list, chunks[1], &mut list_state);
    frame.render_widget(Paragraph::new(hint_line(hints)), chunks[2]);
}

fn speaking_phase_line(phase: &SpeakingPhase) -> Line<'static> {
    match phase {
        SpeakingPhase::Idle => {
            Line::from(Span::styled("Press r to record.", Style::default().fg(INK)))
        }
        SpeakingPhase::Recording => Line::from(Span::styled(
            "● Recording — press r to stop.",
            Style::default().fg(PINK).add_modifier(Modifier::BOLD),
        )),
        SpeakingPhase::Uploading => Line::from(Span::styled(
            "Uploading…",
            Style::default()
                .fg(INK_MUTED)
                .add_modifier(Modifier::ITALIC),
        )),
        SpeakingPhase::Polling { .. } => Line::from(Span::styled(
            "Grading…",
            Style::default()
                .fg(INK_MUTED)
                .add_modifier(Modifier::ITALIC),
        )),
        SpeakingPhase::Graded { score, .. } => Line::from(Span::styled(
            format!(
                "Score: {}",
                score.map_or_else(|| "—".to_string(), |s| format!("{s}%"))
            ),
            Style::default().fg(PINK).add_modifier(Modifier::BOLD),
        )),
        SpeakingPhase::Failed { message } => {
            Line::from(Span::styled(message.clone(), Style::default().fg(PINK)))
        }
    }
}

fn draw_class_result(frame: &mut Frame, area: Rect, course: &Course, result: &ClassResult) {
    let inner = panel(frame, area, &format!("{} · class result", course.title));
    let chunks = Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(inner);

    let (verdict, color) = if result.passed {
        ("Passed — gate released", AULA_BLUE)
    } else {
        ("Not passed yet", PINK)
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
            Style::default().fg(PINK).add_modifier(Modifier::BOLD),
        )),
        Line::from(Span::styled(
            format!(
                "{} of {} sections passed",
                result.passed_sections, result.total_sections
            ),
            Style::default().fg(INK_MUTED),
        )),
    ]);
    frame.render_widget(Paragraph::new(body).alignment(Alignment::Center), chunks[0]);

    let hints: &[&str] = if result.passed {
        &["n next class", "q back"]
    } else {
        &["n retry / continue", "q back"]
    };
    frame.render_widget(Paragraph::new(hint_line(hints)), chunks[1]);
}

fn draw_class_done(frame: &mut Frame, area: Rect, course: &Course) {
    let inner = panel(frame, area, &format!("{} · complete", course.title));
    let chunks = Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(inner);
    frame.render_widget(
        Paragraph::new(Text::from(vec![
            Line::default(),
            Line::from(Span::styled(
                "You've completed the course curriculum.",
                Style::default().fg(AULA_BLUE).add_modifier(Modifier::BOLD),
            )),
        ]))
        .alignment(Alignment::Center),
        chunks[0],
    );
    frame.render_widget(Paragraph::new(hint_line(&["q back"])), chunks[1]);
}
