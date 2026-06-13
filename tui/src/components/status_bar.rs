use color_eyre::Result;
use ratatui::{
    Frame,
    layout::{Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::Paragraph,
};
use std::time::Instant;

use crate::components::Component;

/// aula blue — the SottoDesign primary.
const AULA_BLUE: Color = Color::Rgb(0x3F, 0x4F, 0xB0);
const INK_MUTED: Color = Color::Rgb(0x56, 0x5B, 0x68);

/// Bottom status bar: shows the connected server, the logged-in learner, and
/// key hints. Also surfaces transient error messages for a few seconds.
pub(crate) struct StatusBar {
    server: String,
    user: String,
    error: Option<(String, Instant)>,
}

impl StatusBar {
    pub fn new(server: String, user: String) -> Self {
        Self {
            server,
            user,
            error: None,
        }
    }

    /// Show a transient error in the bar for a few seconds.
    #[allow(dead_code)]
    pub fn set_error(&mut self, message: String) {
        self.error = Some((message, Instant::now()));
    }

    /// Clear an expired error message. Returns true if state changed.
    pub fn clear_expired(&mut self) -> bool {
        if let Some((_, when)) = &self.error
            && when.elapsed().as_secs() >= 5
        {
            self.error = None;
            return true;
        }
        false
    }
}

impl Component for StatusBar {
    fn draw(&mut self, frame: &mut Frame, area: Rect) -> Result<()> {
        if let Some((msg, when)) = &self.error
            && when.elapsed().as_secs() < 5
        {
            let bar = Paragraph::new(Line::from(vec![
                Span::styled(
                    " ERROR ",
                    Style::default()
                        .fg(Color::White)
                        .bg(Color::Red)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(format!(" {msg}"), Style::default().fg(Color::Red)),
            ]));
            frame.render_widget(bar, area);
            return Ok(());
        }

        // Left: session context. Right: key hints.
        let chunks = Layout::horizontal([Constraint::Fill(1), Constraint::Length(14)]).split(area);

        let session = Paragraph::new(Line::from(vec![
            Span::styled(
                " sotto ",
                Style::default()
                    .fg(Color::White)
                    .bg(AULA_BLUE)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("  "),
            Span::styled(self.server.clone(), Style::default().fg(AULA_BLUE)),
            Span::styled("  •  ", Style::default().fg(INK_MUTED)),
            Span::styled(self.user.clone(), Style::default().fg(INK_MUTED)),
        ]));
        frame.render_widget(session, chunks[0]);

        let hints = Paragraph::new(Line::from(vec![
            key_span("q"),
            Span::styled(" quit", Style::default().fg(INK_MUTED)),
        ]))
        .right_aligned();
        frame.render_widget(hints, chunks[1]);

        Ok(())
    }
}

fn key_span(key: &str) -> Span<'static> {
    Span::styled(
        format!(" {key} "),
        Style::default()
            .fg(Color::White)
            .bg(AULA_BLUE)
            .add_modifier(Modifier::BOLD),
    )
}
