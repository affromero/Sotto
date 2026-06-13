//! Rendering for the vocabulary review screens. Pure draw functions: they take
//! the current [`View`] and paint it, with no side effects on app state.

use ratatui::{
    Frame,
    layout::{Alignment, Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Wrap},
};

use crate::config::Config;

use super::state::{Course, DueCounts, PracticeResult, Unavailable, View, can_review_vocab};

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
            notice,
            starting,
        } => draw_course_home(frame, area, course, due, notice.as_ref(), *starting),
        View::VocabReview {
            course,
            items,
            index,
            cursor,
            submitting,
            ..
        } => {
            // Items is guaranteed non-empty when this view is constructed.
            if let Some(item) = items.get(*index) {
                draw_vocab_review(
                    frame,
                    area,
                    course,
                    *index,
                    items.len(),
                    &item.prompt,
                    &item.options,
                    *cursor,
                    *submitting,
                );
            }
        }
        View::Result { course, result } => draw_result(frame, area, course, result),
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
    notice: Option<&Unavailable>,
    starting: bool,
) {
    let inner = panel(frame, area, &course.title);
    let chunks = Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(inner);

    let can_review = can_review_vocab(due);
    let mut lines = vec![
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
        Line::default(),
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
        ]),
        Line::from(Span::styled(
            format!("{} words tracked", due.total_vocab),
            Style::default().fg(INK_MUTED),
        )),
        Line::default(),
    ];

    if starting {
        lines.push(Line::from(Span::styled(
            "Starting review…",
            Style::default()
                .fg(INK_MUTED)
                .add_modifier(Modifier::ITALIC),
        )));
    } else if can_review {
        lines.push(Line::from(Span::styled(
            "▶ Start vocab review",
            Style::default().fg(AULA_BLUE).add_modifier(Modifier::BOLD),
        )));
    } else {
        lines.push(Line::from(Span::styled(
            "No vocabulary to review yet.",
            Style::default().fg(INK_MUTED),
        )));
    }

    if let Some(reason) = notice {
        lines.push(Line::default());
        lines.push(Line::from(Span::styled(
            reason.message(),
            Style::default().fg(PINK).add_modifier(Modifier::BOLD),
        )));
    }

    frame.render_widget(
        Paragraph::new(Text::from(lines)).wrap(Wrap { trim: true }),
        chunks[0],
    );

    let hints: &[&str] = if starting {
        &["q back"]
    } else if can_review {
        &["enter start review", "q back"]
    } else {
        &["q back"]
    };
    frame.render_widget(Paragraph::new(hint_line(hints)), chunks[1]);
}

#[allow(clippy::too_many_arguments)]
fn draw_vocab_review(
    frame: &mut Frame,
    area: Rect,
    course: &Course,
    index: usize,
    total: usize,
    prompt: &str,
    options: &[String],
    cursor: usize,
    submitting: bool,
) {
    let title = format!("{} · vocab {}/{}", course.title, index + 1, total);
    let inner = panel(frame, area, &title);
    let chunks = Layout::vertical([
        Constraint::Length(3),
        Constraint::Fill(1),
        Constraint::Length(1),
    ])
    .split(inner);

    let prompt_para = Paragraph::new(Line::from(Span::styled(
        prompt.to_string(),
        Style::default().fg(INK).add_modifier(Modifier::BOLD),
    )))
    .wrap(Wrap { trim: true });
    frame.render_widget(prompt_para, chunks[0]);

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

    let hints: &[&str] = if submitting {
        &["submitting…", "q back"]
    } else {
        &["↑/↓ choose", "1-9 pick", "enter answer", "q back"]
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
