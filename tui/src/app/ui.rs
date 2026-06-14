//! Rendering for the practice screens. Pure draw functions: they take the
//! current [`View`] and paint it, with no side effects on app state.

use ratatui::{
    Frame,
    layout::{Alignment, Constraint, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Wrap},
};

use crate::config::Config;
use crate::theme::Palette;

use super::state::{
    AskPhase, AskState, ClassResult, ClassSection, ConfigView, Course, DueCounts, ExamResult,
    LANGUAGES, LangColumn, MemoryItem, PlacementOutcome, PracticeResult, ReviewKind,
    SectionProgress, SkillChoice, SpeakingPhase, Unavailable, View, WritingPhase, can_review_vocab,
};
use crate::api::types::SkillType;

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
