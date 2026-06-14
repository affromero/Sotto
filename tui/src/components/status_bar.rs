use color_eyre::Result;
use ratatui::{
    Frame,
    layout::{Constraint, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::Paragraph,
};
use std::time::Instant;

use crate::components::Component;
use crate::theme::{Palette, Theme};

/// Bottom status bar: shows the connected server, the logged-in learner, and
/// key hints. Also surfaces transient error messages for a few seconds. Colors
/// come from the active [`Palette`], refreshed each frame via [`Self::set_palette`].
pub(crate) struct StatusBar {
    server: String,
    user: String,
    error: Option<(String, Instant)>,
    palette: Palette,
}

impl StatusBar {
    pub fn new(server: String, user: String) -> Self {
        Self {
            server,
            user,
            error: None,
            // Resolved before the first draw; the default keeps a sane palette.
            palette: Theme::default().palette(),
        }
    }

    /// Update the palette used on the next draw (called once per frame by the
    /// app so a live theme switch reflows the bar).
    pub fn set_palette(&mut self, palette: Palette) {
        self.palette = palette;
    }

    /// Update the displayed server + learner after an account switch.
    pub fn set_session(&mut self, server: String, user: String) {
        self.server = server;
        self.user = user;
    }

    /// Show a transient error in the bar for a few seconds.
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
        let p = self.palette;
        if let Some((msg, when)) = &self.error
            && when.elapsed().as_secs() < 5
        {
            let bar = Paragraph::new(Line::from(vec![
                Span::styled(
                    " ERROR ",
                    Style::default()
                        .fg(p.on_primary)
                        .bg(p.error)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(format!(" {msg}"), Style::default().fg(p.error)),
            ]));
            frame.render_widget(bar, area);
            return Ok(());
        }

        // Left: session context. Right: key hints.
        let chunks = Layout::horizontal([Constraint::Fill(1), Constraint::Length(20)]).split(area);

        let session = Paragraph::new(Line::from(vec![
            Span::styled(
                " sotto ",
                Style::default()
                    .fg(p.on_primary)
                    .bg(p.primary)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("  "),
            Span::styled(self.server.clone(), Style::default().fg(p.primary)),
            Span::styled("  •  ", Style::default().fg(p.ink_soft)),
            Span::styled(self.user.clone(), Style::default().fg(p.ink_soft)),
        ]));
        frame.render_widget(session, chunks[0]);

        let hints = Paragraph::new(Line::from(vec![
            key_span("?", &p),
            Span::styled(" keys", Style::default().fg(p.ink_soft)),
        ]))
        .right_aligned();
        frame.render_widget(hints, chunks[1]);

        Ok(())
    }
}

fn key_span(key: &str, p: &Palette) -> Span<'static> {
    Span::styled(
        format!(" {key} "),
        Style::default()
            .fg(p.on_primary)
            .bg(p.primary)
            .add_modifier(Modifier::BOLD),
    )
}
