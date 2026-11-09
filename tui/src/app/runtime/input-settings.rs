use super::*;

impl App {
    // --- Theme & polish (P7) -----------------------------------------------

    /// Toggle the theme picker overlay (`t`). Closing it persists the choice.
    pub(super) fn on_toggle_theme_picker(&mut self) {
        if self.theme_picker.open {
            self.theme_picker = ThemePicker::closed();
            self.persist_theme();
        } else {
            // Opening the picker dismisses the other modals (one at a time).
            self.help_open = false;
            self.accounts = AccountsOverlay::closed();
            self.theme_picker = ThemePicker::opened();
        }
        self.render();
    }

    /// Toggle the key-help overlay (`?`).
    pub(super) fn on_toggle_help(&mut self) {
        self.help_open = !self.help_open;
        if self.help_open {
            self.theme_picker = ThemePicker::closed();
            self.accounts = AccountsOverlay::closed();
        }
        self.render();
    }

    /// Cycle the value of the picker's focused row and apply it live. The choice
    /// is persisted when the picker closes (not on every keystroke).
    pub(super) fn on_cycle_theme_value(&mut self) {
        if self.theme_picker.open {
            overlay::cycle_focused(&mut self.theme, self.theme_picker.row);
            self.render();
        }
    }

    /// Persist `config` to its configured path. A no-op when `config_path` is
    /// `None` (tests), so the suite never writes the developer's real config.
    pub(super) fn persist_config(&self) -> Result<()> {
        match &self.config_path {
            Some(path) => self.config.save_to(path),
            None => Ok(()),
        }
    }

    /// Write the active theme into `config` and persist it. A save failure is
    /// surfaced in the status bar rather than crashing the UI loop.
    pub(super) fn persist_theme(&mut self) {
        self.config.theme = self.theme.to_choice();
        if let Err(e) = self.persist_config() {
            self.status_bar
                .set_error(format!("could not save theme: {e}"));
        }
    }

    // --- Account management (P9) -------------------------------------------

    /// Toggle the account switcher overlay (`A`). Opens with the cursor on the
    /// active profile so Enter on it is a no-op switch.
    pub(super) fn on_toggle_accounts(&mut self) {
        if self.accounts.open {
            self.accounts = AccountsOverlay::closed();
        } else {
            self.theme_picker = ThemePicker::closed();
            self.help_open = false;
            let active_idx = self
                .config
                .profile_names()
                .iter()
                .position(|n| n == &self.config.active)
                .unwrap_or(0);
            self.accounts = AccountsOverlay::opened(active_idx);
        }
        self.render();
    }

    /// Switch to the profile under the switcher cursor.
    ///
    /// A successful client build is the GATE for the rest of the switch: we build
    /// the new profile's client FIRST, and only then swap it in, set the profile
    /// active, persist, and reload. If the build fails we change nothing — the
    /// previously-active profile and its client stay in place — so a fetch is
    /// never dispatched through a client that does not belong to the now-active
    /// profile (which would otherwise load the old account's data under the new
    /// one). The error surfaces in the status bar.
    pub(super) fn on_switch_account(&mut self) {
        let names = self.config.profile_names();
        let Some(name) = names.get(self.accounts.cursor).cloned() else {
            self.accounts = AccountsOverlay::closed();
            return;
        };
        self.accounts = AccountsOverlay::closed();

        // No-op when already active (still close the overlay).
        if name == self.config.active {
            self.render();
            return;
        }

        // Finish the current recording under its original account before
        // changing the client. An unsaved copy must stay in memory.
        if self.recorder.is_recording()
            || self.retained_class_recording.is_some()
            || self.view.has_upload_in_progress()
        {
            self.status_bar.set_error(
                "Finish or save your recording and wait for its upload before switching accounts."
                    .into(),
            );
            self.render();
            return;
        }

        // Build the target profile's client BEFORE mutating any state.
        let Some(profile) = self.config.profiles.get(&name).cloned() else {
            self.status_bar
                .set_error(format!("no profile named '{name}'"));
            self.render();
            return;
        };
        let client = match (self.client_factory)(&profile) {
            Ok(client) => client,
            Err(e) => {
                // Build failed: keep the previously-active profile + client. Do
                // NOT set active, persist, or fetch through the stale client.
                self.status_bar
                    .set_error(format!("could not connect with '{name}': {e}"));
                self.render();
                return;
            }
        };

        // The client is good — commit the switch.
        self.stop_audio();
        self.cache_practice();
        for cached in self.practice_cache.values_mut() {
            cached.mark_abandoned_uploads_unknown(None);
            if let Some(progress) = cached.learning_progress_mut()
                && progress.in_flight.take().is_some()
            {
                progress.dirty = true;
                progress.conflict = true;
            }
        }
        let previous_key = self.config.active_profile().map(|old| {
            (
                old.server_url.trim_end_matches('/').to_string(),
                old.api_key.clone(),
            )
        });
        let next_key = (
            profile.server_url.trim_end_matches('/').to_string(),
            profile.api_key.clone(),
        );
        let previous_cache = std::mem::take(&mut self.practice_cache);
        if let Some(previous_key) = previous_key {
            self.account_practice_cache
                .insert(previous_key, previous_cache);
        }
        self.practice_cache = self
            .account_practice_cache
            .remove(&next_key)
            .unwrap_or_default();
        self.client = client;
        self.pending_admissions.clear();
        self.pending_selections.clear();
        self.placement_transport = Default::default();
        let user = profile
            .name
            .clone()
            .unwrap_or_else(|| "(owner)".to_string());
        self.status_bar.set_session(profile.server_url, user);
        // `set_active` cannot fail here: `name` came from `profile_names()`.
        let _ = self.config.set_active(&name);
        if let Err(e) = self.persist_config() {
            self.status_bar.set_error(format!("could not save: {e}"));
        }
        // Reload courses against the NEW client (bumps gen, sets Loading).
        self.fetch_courses();
    }
}
