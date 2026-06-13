use color_eyre::Result;
use crossterm::event::{KeyCode, KeyModifiers};
use ratatui::{
    Frame,
    layout::{Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Paragraph},
};
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};

use crate::action::Action;
use crate::components::Component;
use crate::components::status_bar::StatusBar;
use crate::config::Config;
use crate::event::Event;
use crate::tui::Tui;

const AULA_BLUE: Color = Color::Rgb(0x3F, 0x4F, 0xB0);
const INK_MUTED: Color = Color::Rgb(0x56, 0x5B, 0x68);

/// The Phase 3 application: owns the session [`Config`], the status bar, and a
/// placeholder home pane. Real screens (courses, practice, listening) land in
/// later phases via the gitpane-style event/action loop.
pub(crate) struct App {
    config: Config,
    should_quit: bool,
    status_bar: StatusBar,
    action_tx: UnboundedSender<Action>,
    action_rx: UnboundedReceiver<Action>,
}

impl App {
    pub fn new(config: Config) -> Self {
        let (action_tx, action_rx) = mpsc::unbounded_channel();
        let server = config.server_url.clone();
        let status_bar = StatusBar::new(server, "(owner)".to_string());
        Self {
            config,
            should_quit: false,
            status_bar,
            action_tx,
            action_rx,
        }
    }

    pub async fn run(&mut self) -> Result<()> {
        let mut tui = Tui::new()?;
        tui.enter()?;

        // Initial paint.
        self.action_tx.send(Action::Render)?;

        while !self.should_quit {
            if let Some(event) = tui.event_rx.recv().await {
                self.handle_event(event)?;
            }

            while let Ok(action) = self.action_rx.try_recv() {
                match action {
                    Action::Quit => self.should_quit = true,
                    Action::Render => {
                        tui.terminal.draw(|frame| {
                            let _ = self.draw(frame);
                        })?;
                    }
                    Action::Resize(w, h) => {
                        tui.terminal.resize(Rect::new(0, 0, w, h))?;
                    }
                    Action::Tick => {
                        if self.status_bar.clear_expired() {
                            self.action_tx.send(Action::Render)?;
                        }
                    }
                    Action::Error(message) => {
                        self.status_bar.set_error(message);
                        self.action_tx.send(Action::Render)?;
                    }
                }
            }
        }

        tui.exit()?;
        Ok(())
    }

    fn handle_event(&mut self, event: Event) -> Result<()> {
        match event {
            Event::Init => {
                self.action_tx.send(Action::Render)?;
            }
            Event::Render => self.action_tx.send(Action::Render)?,
            Event::Tick => self.action_tx.send(Action::Tick)?,
            Event::Resize(w, h) => self.action_tx.send(Action::Resize(w, h))?,
            Event::Key(key) => {
                let quit = matches!(key.code, KeyCode::Char('q'))
                    || (key.modifiers.contains(KeyModifiers::CONTROL)
                        && matches!(key.code, KeyCode::Char('c')));
                if quit {
                    self.action_tx.send(Action::Quit)?;
                }
            }
            Event::Mouse(_) | Event::FocusGained | Event::FocusLost => {}
        }
        Ok(())
    }

    fn draw(&mut self, frame: &mut Frame) -> Result<()> {
        let chunks =
            Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(frame.area());
        self.draw_home(frame, chunks[0]);
        self.status_bar.draw(frame, chunks[1])?;
        Ok(())
    }

    fn draw_home(&self, frame: &mut Frame, area: Rect) {
        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(AULA_BLUE))
            .title(Span::styled(
                " Sotto ",
                Style::default().fg(AULA_BLUE).add_modifier(Modifier::BOLD),
            ));
        let inner = block.inner(area);
        frame.render_widget(block, area);

        let body = Text::from(vec![
            Line::default(),
            Line::from(Span::styled(
                "Sotto — your course in the terminal.",
                Style::default().fg(AULA_BLUE).add_modifier(Modifier::BOLD),
            )),
            Line::default(),
            Line::from(Span::styled(
                format!("Connected to {}", self.config.server_url),
                Style::default().fg(INK_MUTED),
            )),
            Line::default(),
            Line::from(Span::styled("(q) quit", Style::default().fg(INK_MUTED))),
        ]);
        let paragraph = Paragraph::new(body).centered();
        frame.render_widget(paragraph, inner);
    }
}
