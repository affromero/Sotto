use super::*;

impl App {
    // --- Rendering ---------------------------------------------------------

    pub(super) fn render(&self) {
        let _ = self.action_tx.send(Action::Render);
    }

    /// Hard floor below which no screen can render legibly; show a minimal
    /// notice instead of clipping content. Chosen so every screen's fixed-height
    /// header/footer splits still leave a usable body.
    const MIN_COLS: u16 = 40;
    const MIN_ROWS: u16 = 10;

    pub(super) fn draw(&mut self, frame: &mut Frame) -> Result<()> {
        let palette = self.theme.palette();
        let area = frame.area();

        // Paint the themed background across the whole frame first.
        frame.render_widget(
            ratatui::widgets::Block::default().style(Style::default().bg(palette.bg)),
            area,
        );

        // Below the hard floor, render only a centered "too small" message — the
        // fixed header/footer splits would otherwise clip the body to nothing.
        if area.width < Self::MIN_COLS || area.height < Self::MIN_ROWS {
            let msg = Paragraph::new(Text::from(vec![
                Line::from(Span::styled(
                    "Terminal too small",
                    Style::default()
                        .fg(palette.primary)
                        .add_modifier(ratatui::style::Modifier::BOLD),
                )),
                Line::from(Span::styled(
                    format!(
                        "need ≥ {}×{} (now {}×{})",
                        Self::MIN_COLS,
                        Self::MIN_ROWS,
                        area.width,
                        area.height
                    ),
                    Style::default().fg(palette.ink_soft),
                )),
            ]))
            .alignment(ratatui::layout::Alignment::Center)
            .wrap(Wrap { trim: true });
            frame.render_widget(msg, area);
            return Ok(());
        }

        let chunks = Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(area);
        ui::draw_view(frame, chunks[0], &self.view, &self.config, &palette);
        self.status_bar.set_palette(palette);
        self.status_bar.draw(frame, chunks[1])?;

        // Modal overlays float on top of the screen behind them.
        if self.theme_picker.open {
            overlay::draw_theme_picker(
                frame,
                chunks[0],
                &self.theme,
                self.theme_picker.row,
                &palette,
            );
        } else if self.help_open {
            overlay::draw_help(frame, chunks[0], &self.view, &palette);
        } else if self.accounts.open {
            let profiles: Vec<(String, Profile)> = self
                .config
                .profiles
                .iter()
                .map(|(name, p)| (name.clone(), p.clone()))
                .collect();
            overlay::draw_accounts(
                frame,
                chunks[0],
                &profiles,
                &self.config.active,
                self.accounts.cursor,
                &palette,
            );
        } else if self.manual.open {
            overlay::draw_manual_placement(frame, chunks[0], &self.manual, &palette);
        } else if self.delete.open {
            overlay::draw_delete_course(frame, chunks[0], &self.delete, &palette);
        }
        Ok(())
    }
}
