//! Two modal overlays for Phase 7 polish: the theme picker (`t`) and the
//! key-help overlay (`?`). Both are modal like the ask overlay — while open they
//! swallow every key except their own (handled in `App::map_key`).
//!
//! The help overlay's key list is sourced from [`help_rows`], keyed on the
//! current [`View`] discriminant plus a static global section, so it lists the
//! real bindings for the screen the learner is on.

use ratatui::{
    Frame,
    layout::{Alignment, Constraint, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Clear, Paragraph, Wrap},
};

use crate::theme::{Palette, Theme};

use super::state::View;

/// Which row of the theme picker is focused. The picker has three rows (mode,
/// light palette, accent); the focused row is changed with ↑/↓ and its value is
/// cycled with Enter / → / Space.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PickerRow {
    Mode,
    LightPalette,
    Accent,
}

impl PickerRow {
    const ALL: [PickerRow; 3] = [PickerRow::Mode, PickerRow::LightPalette, PickerRow::Accent];

    fn index(self) -> usize {
        match self {
            PickerRow::Mode => 0,
            PickerRow::LightPalette => 1,
            PickerRow::Accent => 2,
        }
    }
}

/// The theme picker overlay state: open flag + the focused row.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ThemePicker {
    pub open: bool,
    pub row: PickerRow,
}

impl ThemePicker {
    pub fn closed() -> Self {
        Self {
            open: false,
            row: PickerRow::Mode,
        }
    }

    pub fn opened() -> Self {
        Self {
            open: true,
            row: PickerRow::Mode,
        }
    }

    /// Move the focused row up/down (wrapping).
    pub fn move_row(&mut self, down: bool) {
        let i = self.row.index();
        let n = PickerRow::ALL.len();
        let next = if down { (i + 1) % n } else { (i + n - 1) % n };
        self.row = PickerRow::ALL[next];
    }
}

/// Cycle the value of the focused row of `theme`. Returns the mutated theme.
pub(crate) fn cycle_focused(theme: &mut Theme, row: PickerRow) {
    match row {
        PickerRow::Mode => theme.cycle_mode(),
        PickerRow::LightPalette => theme.cycle_light_palette(),
        PickerRow::Accent => theme.cycle_accent(),
    }
}

// --- Rendering --------------------------------------------------------------

/// A centered modal box sized to `w`×`h` (clamped to `area`), cleared first so
/// it floats over the screen behind it.
fn modal_area(area: Rect, w: u16, h: u16) -> Rect {
    let w = w.min(area.width);
    let h = h.min(area.height);
    let x = area.x + (area.width.saturating_sub(w)) / 2;
    let y = area.y + (area.height.saturating_sub(h)) / 2;
    Rect {
        x,
        y,
        width: w,
        height: h,
    }
}

fn modal_block(title: &str, p: &Palette) -> Block<'static> {
    Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(p.primary))
        .style(Style::default().bg(p.surface))
        .title(Span::styled(
            format!(" {title} "),
            Style::default().fg(p.primary).add_modifier(Modifier::BOLD),
        ))
}

/// Draw the theme picker modal over `area`.
pub(crate) fn draw_theme_picker(
    frame: &mut Frame,
    area: Rect,
    theme: &Theme,
    row: PickerRow,
    p: &Palette,
) {
    let rect = modal_area(area, 48, 11);
    frame.render_widget(Clear, rect);
    let block = modal_block("Theme", p);
    let inner = block.inner(rect);
    frame.render_widget(block, rect);

    let chunks = Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(inner);

    let mode_val = theme.mode.label();
    let palette_val = theme.light_palette.label();
    let accent_val = theme.accent.label;

    let line = |focused: bool, label: &str, value: Span<'static>| -> Line<'static> {
        let marker = if focused { "▌ " } else { "  " };
        let label_style = if focused {
            Style::default().fg(p.primary).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(p.ink_soft)
        };
        Line::from(vec![
            Span::styled(marker.to_string(), Style::default().fg(p.primary)),
            Span::styled(format!("{label:<14}"), label_style),
            value,
        ])
    };

    // The accent value carries a small swatch glyph in the chosen accent color.
    let accent_span = Span::styled(
        format!("● {accent_val}"),
        Style::default()
            .fg(theme.accent.color())
            .add_modifier(Modifier::BOLD),
    );

    let body = Text::from(vec![
        Line::default(),
        line(
            row == PickerRow::Mode,
            "Mode",
            Span::styled(mode_val.to_string(), Style::default().fg(p.ink)),
        ),
        line(
            row == PickerRow::LightPalette,
            "Light palette",
            // The light palette only affects light mode (matches the web, which
            // disables it in dark mode); note that when dark is active.
            if theme.is_dark() {
                Span::styled(
                    format!("{palette_val} (light mode only)"),
                    Style::default()
                        .fg(p.ink_soft)
                        .add_modifier(Modifier::ITALIC),
                )
            } else {
                Span::styled(palette_val.to_string(), Style::default().fg(p.ink))
            },
        ),
        line(row == PickerRow::Accent, "Accent", accent_span),
        Line::default(),
        Line::from(Span::styled(
            "Live preview — the screen behind updates as you change.",
            Style::default()
                .fg(p.ink_soft)
                .add_modifier(Modifier::ITALIC),
        )),
    ]);
    frame.render_widget(Paragraph::new(body).wrap(Wrap { trim: true }), chunks[0]);

    let hints = Line::from(vec![
        Span::styled(" ↑/↓ row ", Style::default().fg(p.ink_soft)),
        Span::styled("  enter/→ change ", Style::default().fg(p.ink_soft)),
        Span::styled("  t/esc close ", Style::default().fg(p.ink_soft)),
    ]);
    frame.render_widget(Paragraph::new(hints), chunks[1]);
}

/// Draw the key-help modal over `area`, listing the current screen's keys plus
/// the global keys.
pub(crate) fn draw_help(frame: &mut Frame, area: Rect, view: &View, p: &Palette) {
    let rows = help_rows(view);
    let globals = global_rows();
    // Height: title + blank + screen rows + blank + "Global" + global rows +
    // borders + hint line. Clamp to the area.
    let content_h = 2 + rows.len() as u16 + 2 + globals.len() as u16 + 1;
    let rect = modal_area(area, 50, content_h + 2);
    frame.render_widget(Clear, rect);
    let block = modal_block("Keys", p);
    let inner = block.inner(rect);
    frame.render_widget(block, rect);

    let chunks = Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(inner);

    let mut lines: Vec<Line> = vec![Line::default()];
    let key_desc = |key: &str, desc: &str| -> Line<'static> {
        Line::from(vec![
            Span::styled(
                format!("  {key:<10}"),
                Style::default().fg(p.primary).add_modifier(Modifier::BOLD),
            ),
            Span::styled(desc.to_string(), Style::default().fg(p.ink)),
        ])
    };
    for (key, desc) in &rows {
        lines.push(key_desc(key, desc));
    }
    lines.push(Line::default());
    lines.push(Line::from(Span::styled(
        "  Global",
        Style::default().fg(p.ink_soft).add_modifier(Modifier::BOLD),
    )));
    for (key, desc) in &globals {
        lines.push(key_desc(key, desc));
    }
    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .wrap(Wrap { trim: true })
            .alignment(Alignment::Left),
        chunks[0],
    );
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            " ? / esc close ",
            Style::default().fg(p.ink_soft),
        ))),
        chunks[1],
    );
}

// --- Key-help source (single source for the overlay) ------------------------

/// The global keys available on (almost) every screen.
pub(crate) fn global_rows() -> Vec<(&'static str, &'static str)> {
    vec![
        ("?", "this help"),
        ("t", "theme"),
        ("q / esc", "back / quit"),
        ("Ctrl-C", "quit"),
    ]
}

/// The screen-specific keys for `view`, keyed on the [`View`] discriminant. This
/// is the single source the help overlay renders; it mirrors the real keymap in
/// `App::map_key`.
pub(crate) fn help_rows(view: &View) -> Vec<(&'static str, &'static str)> {
    match view {
        View::Loading => vec![],
        View::Error { .. } => vec![("r", "retry")],
        View::Courses { .. } => vec![
            ("↑/↓ j/k", "move"),
            ("enter", "open course"),
            ("n", "placement (new course)"),
            ("s", "settings"),
        ],
        View::CourseHome { .. } => vec![
            ("↑/↓ j/k", "choose skill"),
            ("enter", "practice skill"),
            ("c", "next class"),
            ("e", "mock exam"),
            ("m", "memory graph"),
            ("s", "settings"),
        ],
        View::ItemReview { .. } => vec![
            ("↑/↓ j/k", "move option"),
            ("1-9", "pick option"),
            ("enter", "answer"),
            ("PgUp/PgDn", "scroll prompt"),
        ],
        View::ListeningReview { .. } => vec![
            ("space", "play / pause"),
            ("↑/↓", "move option"),
            ("1-9 / enter", "answer"),
            ("a", "ask a question"),
        ],
        View::SpeakingReview { .. } => vec![("r", "record / stop"), ("enter", "next prompt")],
        View::Result { .. } => vec![("enter", "continue")],
        View::Class { .. } => vec![
            ("space", "play / pause (listening)"),
            ("r", "record (speaking)"),
            ("↑/↓ 1-9", "answer (questions)"),
            ("a", "ask (listening)"),
            ("Ctrl-D", "submit (writing)"),
        ],
        View::ClassOutcome { .. } | View::ClassDone { .. } => vec![("n", "next class")],
        View::Exam { .. } => vec![
            ("space", "play / pause (listening)"),
            ("r", "record (speaking)"),
            ("↑/↓ 1-9", "answer (questions)"),
            ("a", "ask (listening)"),
            ("Ctrl-D", "submit (writing)"),
        ],
        View::ExamOutcome { .. } => vec![("enter", "continue")],
        View::PlacementLang { .. } => vec![
            ("↑/↓", "move"),
            ("tab", "switch column"),
            ("enter", "start placement"),
        ],
        View::PlacementReview { .. } => vec![("↑/↓ 1-9", "answer"), ("PgUp/PgDn", "scroll")],
        View::PlacementResult { .. } => vec![("enter", "start course")],
        View::Memory { .. } => vec![("↑/↓", "scroll")],
        View::Settings { .. } => vec![],
    }
}
