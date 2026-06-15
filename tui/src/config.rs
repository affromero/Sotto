use color_eyre::{Result, eyre::eyre};
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

const QUALIFIER: &str = "fm";
const ORGANIZATION: &str = "Sotto";
const APPLICATION: &str = "sotto";
const CONFIG_FILE: &str = "config.toml";

/// The default profile name used when none is given (and the name a migrated
/// legacy single-credential config lands under).
pub(crate) const DEFAULT_PROFILE: &str = "default";

/// One named connection: a Sotto server and the API key paired with it. Each
/// Sotto instance is single-learner, so a profile identifies an instance the
/// learner can switch between (their self-host, a colleague's server, a managed
/// instance). `name` caches the learner identity captured at login.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Profile {
    pub server_url: String,
    pub api_key: String,
    /// Cached display name/email from the redeem response, shown in the account
    /// list and as a `whoami` fallback. `None` if the server returned no user.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

impl Profile {
    /// True when this profile has no usable credential.
    pub fn is_empty(&self) -> bool {
        self.api_key.trim().is_empty()
    }
}

/// Persisted Sotto CLI config: a set of named [`Profile`]s plus the active one,
/// and a global theme shared across profiles. Stored as TOML at the platform
/// config dir (e.g. `~/.config/sotto/config.toml` on Linux/macOS).
///
/// Field order matters for TOML: `toml` emits scalar values before tables, so
/// the scalar `active` is declared first, then the `[theme]` table, then the
/// `[profiles.*]` tables last.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Config {
    /// The name of the active profile (the one the TUI connects through).
    #[serde(default)]
    pub active: String,
    /// The persisted theme choice. Global (shared across profiles), and
    /// `#[serde(default)]` so a config without a `[theme]` table still loads.
    #[serde(default)]
    pub theme: ThemeChoice,
    /// All known profiles, keyed by name. A `BTreeMap` keeps serialization order
    /// stable.
    #[serde(default)]
    pub profiles: BTreeMap<String, Profile>,
}

/// A permissive view used only to detect/migrate a legacy single-credential
/// config (top-level `server_url`/`api_key`, no `[profiles]`). Every field is
/// optional so both the legacy and current shapes deserialize without error.
#[derive(Debug, Default, Deserialize)]
struct RawConfig {
    active: Option<String>,
    #[serde(default)]
    theme: Option<ThemeChoice>,
    // Legacy top-level credentials.
    server_url: Option<String>,
    api_key: Option<String>,
    profiles: Option<BTreeMap<String, Profile>>,
}

impl RawConfig {
    /// Resolve into the current [`Config`], migrating a legacy single-credential
    /// file into a `default` profile. The theme is preserved across migration.
    fn into_config(self) -> Config {
        let theme = self.theme.unwrap_or_default();
        if let Some(profiles) = self.profiles {
            // Already the current shape.
            let active = self.active.unwrap_or_default();
            return Config {
                active,
                theme,
                profiles,
            };
        }
        // Legacy: fold the single top-level credential into `profiles.default`.
        match (self.server_url, self.api_key) {
            (Some(server_url), Some(api_key)) => {
                let mut profiles = BTreeMap::new();
                profiles.insert(
                    DEFAULT_PROFILE.to_string(),
                    Profile {
                        server_url,
                        api_key,
                        name: None,
                    },
                );
                Config {
                    active: DEFAULT_PROFILE.to_string(),
                    theme,
                    profiles,
                }
            }
            // No credentials at all (and no profiles): an empty session that
            // still carries any theme it had.
            _ => Config {
                active: String::new(),
                theme,
                profiles: BTreeMap::new(),
            },
        }
    }
}

/// The serialized theme choice (mode + light palette + accent), persisted as a
/// `[theme]` TOML table. Mirrors the web `AppearanceControls` selections. Stored
/// as strings so the file stays human-readable and forward-tolerant; each field
/// defaults independently, so a partial `[theme]` table also loads.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct ThemeChoice {
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default = "default_light_palette")]
    pub light_palette: String,
    #[serde(default = "default_accent")]
    pub accent: String,
}

fn default_mode() -> String {
    "light".to_string()
}
fn default_light_palette() -> String {
    "aula".to_string()
}
fn default_accent() -> String {
    "#3F4FB0".to_string()
}

impl Default for ThemeChoice {
    fn default() -> Self {
        Self {
            mode: default_mode(),
            light_palette: default_light_palette(),
            accent: default_accent(),
        }
    }
}

/// Resolve the config file path: `<config_dir>/config.toml`.
pub(crate) fn config_path() -> Result<PathBuf> {
    let dirs = ProjectDirs::from(QUALIFIER, ORGANIZATION, APPLICATION)
        .ok_or_else(|| eyre!("could not determine a config directory for this platform"))?;
    Ok(dirs.config_dir().join(CONFIG_FILE))
}

impl Config {
    /// Load the persisted config, or `None` when no config file exists yet.
    pub fn load() -> Result<Option<Self>> {
        let path = config_path()?;
        Self::load_from(&path)
    }

    /// Persist the config to the platform config path, creating parent
    /// directories as needed. On Unix the file is written with `0600`
    /// permissions because it holds an API key.
    pub fn save(&self) -> Result<()> {
        let path = config_path()?;
        self.save_to(&path)
    }

    /// Load the config at `path`. Resilient by design: a missing file is `None`
    /// (run login), but a file that cannot be read or parsed does NOT crash the
    /// CLI — it warns to stderr and falls back to [`Config::default`] (an empty
    /// session, so the app simply prompts for login). The corrupt file is left
    /// in place; the next successful `save` overwrites it cleanly.
    fn load_from(path: &std::path::Path) -> Result<Option<Self>> {
        if !path.exists() {
            return Ok(None);
        }
        let contents = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(e) => {
                eprintln!(
                    "warning: could not read {} ({e}); continuing with defaults",
                    path.display()
                );
                return Ok(Some(Config::default()));
            }
        };
        // Parse through the permissive `RawConfig` so a legacy single-credential
        // file (top-level `server_url`/`api_key`, no `[profiles]`) migrates into
        // a `default` profile instead of failing to load.
        match toml::from_str::<RawConfig>(&contents) {
            Ok(raw) => Ok(Some(raw.into_config())),
            Err(e) => {
                eprintln!(
                    "warning: {} is not valid config ({e}); continuing with defaults",
                    path.display()
                );
                Ok(Some(Config::default()))
            }
        }
    }

    pub(crate) fn save_to(&self, path: &std::path::Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let contents = toml::to_string_pretty(self)?;
        std::fs::write(path, contents)?;
        set_owner_only_permissions(path)?;
        Ok(())
    }

    /// True when there is no usable session: no active profile, or the active
    /// profile has no key.
    pub fn is_empty(&self) -> bool {
        self.active_profile().is_none_or(Profile::is_empty)
    }

    // --- Profile management -------------------------------------------------

    /// The active profile, if `active` names an existing one.
    pub fn active_profile(&self) -> Option<&Profile> {
        self.profiles.get(&self.active)
    }

    /// Profile names in stable (sorted) order.
    pub fn profile_names(&self) -> Vec<String> {
        self.profiles.keys().cloned().collect()
    }

    /// Insert or replace the profile named `name`.
    pub fn upsert_profile(&mut self, name: &str, profile: Profile) {
        self.profiles.insert(name.to_string(), profile);
    }

    /// Set the active profile. Errors (listing the available names) when `name`
    /// is not a known profile, so a typo never silently clears the session.
    pub fn set_active(&mut self, name: &str) -> Result<()> {
        if !self.profiles.contains_key(name) {
            let available = self.profile_names().join(", ");
            return Err(eyre!(
                "no profile named '{name}'. Available: {}",
                if available.is_empty() {
                    "(none)".to_string()
                } else {
                    available
                }
            ));
        }
        self.active = name.to_string();
        Ok(())
    }

    /// Remove the profile named `name`. If it was the active one, the active
    /// pointer moves to another remaining profile (or clears when none remain).
    /// Returns `true` if a profile was removed.
    pub fn remove_profile(&mut self, name: &str) -> bool {
        let removed = self.profiles.remove(name).is_some();
        if removed && self.active == name {
            self.active = self.profiles.keys().next().cloned().unwrap_or_default();
        }
        removed
    }
}

#[cfg(unix)]
fn set_owner_only_permissions(path: &std::path::Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(path)?.permissions();
    perms.set_mode(0o600);
    std::fs::set_permissions(path, perms)?;
    Ok(())
}

#[cfg(not(unix))]
fn set_owner_only_permissions(_path: &std::path::Path) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A config with a single active profile (the common shape after login).
    fn single_profile(name: &str, server: &str, key: &str, theme: ThemeChoice) -> Config {
        let mut profiles = BTreeMap::new();
        profiles.insert(
            name.to_string(),
            Profile {
                server_url: server.into(),
                api_key: key.into(),
                name: None,
            },
        );
        Config {
            active: name.to_string(),
            theme,
            profiles,
        }
    }

    #[test]
    fn save_then_load_roundtrips_multiple_profiles() {
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("nested").join("config.toml");

        // A non-default theme + two profiles so the round trip exercises both the
        // scalar/table ordering and the cached identity field.
        let mut config = single_profile(
            "home",
            "http://localhost:3000",
            "sk_home",
            ThemeChoice {
                mode: "dark".into(),
                light_palette: "paper".into(),
                accent: "#1C7A6B".into(),
            },
        );
        config.upsert_profile(
            "work",
            Profile {
                server_url: "https://work.example".into(),
                api_key: "sk_work".into(),
                name: Some("Ada".into()),
            },
        );
        config.save_to(&path).unwrap();

        let loaded = Config::load_from(&path).unwrap().expect("config present");
        assert_eq!(loaded, config, "two-profile config round-trips exactly");
    }

    #[test]
    fn legacy_single_credential_migrates_into_default_profile() {
        // A pre-profiles config: top-level server_url/api_key + a [theme] table.
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("config.toml");
        std::fs::write(
            &path,
            "server_url = \"http://localhost:3000\"\napi_key = \"sk_sotto_old\"\n\n[theme]\nmode = \"dark\"\nlight_palette = \"paper\"\naccent = \"#80487F\"\n",
        )
        .unwrap();

        let loaded = Config::load_from(&path).unwrap().expect("config present");
        // Migrated into `profiles.default`, active = default.
        assert_eq!(loaded.active, "default");
        let p = loaded.active_profile().expect("default profile present");
        assert_eq!(p.server_url, "http://localhost:3000");
        assert_eq!(p.api_key, "sk_sotto_old");
        // The theme is preserved across migration.
        assert_eq!(loaded.theme.mode, "dark");
        assert_eq!(loaded.theme.accent, "#80487F");
        // A migrated logged-in config is NOT an empty session.
        assert!(!loaded.is_empty(), "migration keeps the user logged in");
    }

    #[test]
    fn legacy_config_without_theme_migrates_with_default_theme() {
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("config.toml");
        std::fs::write(
            &path,
            "server_url = \"http://localhost:3000\"\napi_key = \"sk_sotto_old\"\n",
        )
        .unwrap();

        let loaded = Config::load_from(&path).unwrap().expect("config present");
        assert_eq!(loaded.active_profile().unwrap().api_key, "sk_sotto_old");
        assert_eq!(loaded.theme, ThemeChoice::default());
    }

    #[test]
    fn garbage_config_loads_as_default_without_crashing() {
        // A syntactically broken TOML file must not crash the CLI: it loads as a
        // default (empty) session so the app simply prompts for login.
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("config.toml");
        std::fs::write(&path, "this is not = valid = toml = at all ][").unwrap();

        let loaded = Config::load_from(&path).expect("load must not error");
        assert_eq!(
            loaded,
            Some(Config::default()),
            "a corrupt config falls back to defaults, not an error"
        );
        // The empty session means the app will ask the user to log in.
        assert!(loaded.unwrap().is_empty());
    }

    #[test]
    fn unknown_theme_values_still_load_and_resolve_to_defaults() {
        // A hand-edited config with garbage theme values parses fine (strings)
        // and resolves to sane defaults when turned into a Theme — never panics.
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("config.toml");
        std::fs::write(
            &path,
            "active = \"default\"\n\n[theme]\nmode = \"chartreuse\"\nlight_palette = \"plaid\"\naccent = \"#ZZZZZZ\"\n\n[profiles.default]\nserver_url = \"s\"\napi_key = \"k\"\n",
        )
        .unwrap();

        let loaded = Config::load_from(&path).expect("load").expect("present");
        // The raw strings round-trip as-is...
        assert_eq!(loaded.theme.mode, "chartreuse");
        // ...and resolving them yields the safe defaults (mode -> dark since the
        // unknown mode isn't "light"; palette -> aula; accent -> aula blue).
        let theme = crate::theme::Theme::from_choice(&loaded.theme);
        assert_eq!(theme.accent, crate::theme::AULA_BLUE);
    }

    #[test]
    fn partial_theme_table_fills_missing_fields_from_defaults() {
        // Only `mode` set; light_palette + accent must default, not error.
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("config.toml");
        std::fs::write(
            &path,
            "active = \"default\"\n\n[theme]\nmode = \"dark\"\n\n[profiles.default]\nserver_url = \"s\"\napi_key = \"k\"\n",
        )
        .unwrap();

        let loaded = Config::load_from(&path).unwrap().expect("config present");
        assert_eq!(loaded.theme.mode, "dark");
        assert_eq!(loaded.theme.light_palette, "aula");
        assert_eq!(loaded.theme.accent, "#3F4FB0");
    }

    #[test]
    fn upsert_set_active_and_remove_profile_logic() {
        let mut config = single_profile("home", "http://home", "sk_home", ThemeChoice::default());
        config.upsert_profile(
            "work",
            Profile {
                server_url: "http://work".into(),
                api_key: "sk_work".into(),
                name: None,
            },
        );
        assert_eq!(config.profile_names(), vec!["home", "work"]);

        // Switch to a known profile; unknown errors and does not change active.
        config.set_active("work").expect("known profile");
        assert_eq!(config.active, "work");
        assert!(config.set_active("nope").is_err());
        assert_eq!(
            config.active, "work",
            "a failed switch leaves active intact"
        );

        // Removing the active profile moves active to a remaining one.
        assert!(config.remove_profile("work"));
        assert_eq!(config.active, "home", "active moves to a remaining profile");

        // Removing the last profile clears active -> empty session.
        assert!(config.remove_profile("home"));
        assert_eq!(config.active, "");
        assert!(config.is_empty());
        // Removing a missing profile is a no-op.
        assert!(!config.remove_profile("ghost"));
    }

    #[test]
    fn is_empty_tracks_the_active_profile_key() {
        // No profiles -> empty.
        let mut config = Config::default();
        assert!(config.is_empty());

        // Active points at a keyless profile -> still empty.
        config.upsert_profile(
            "default",
            Profile {
                server_url: "http://s".into(),
                api_key: String::new(),
                name: None,
            },
        );
        config.active = "default".into();
        assert!(config.is_empty());

        // A real key -> not empty.
        config.upsert_profile(
            "default",
            Profile {
                server_url: "http://s".into(),
                api_key: "sk_x".into(),
                name: None,
            },
        );
        assert!(!config.is_empty());

        // Active naming a missing profile -> empty.
        config.active = "ghost".into();
        assert!(config.is_empty());
    }

    #[test]
    fn load_missing_file_returns_none() {
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("does-not-exist.toml");
        assert_eq!(Config::load_from(&path).unwrap(), None);
    }

    #[cfg(unix)]
    #[test]
    fn saved_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("config.toml");

        single_profile(
            "default",
            "http://localhost:3000",
            "sk_sotto_secret",
            ThemeChoice::default(),
        )
        .save_to(&path)
        .unwrap();

        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}
