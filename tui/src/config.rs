use color_eyre::{Result, eyre::eyre};
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const QUALIFIER: &str = "fm";
const ORGANIZATION: &str = "Sotto";
const APPLICATION: &str = "sotto";
const CONFIG_FILE: &str = "config.toml";

/// Persisted Sotto CLI session: the server to talk to and the long-lived API
/// key minted via `/api/v1/auth/pair/redeem`. Stored as TOML at the platform
/// config dir (e.g. `~/.config/sotto/config.toml` on Linux/macOS).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Config {
    pub server_url: String,
    pub api_key: String,
    /// The persisted theme choice. `#[serde(default)]` so a legacy config that
    /// predates theming (only `server_url` + `api_key`, no `[theme]` table)
    /// still loads — the absent table resolves to [`ThemeChoice::default`].
    #[serde(default)]
    pub theme: ThemeChoice,
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
fn config_path() -> Result<PathBuf> {
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
        match toml::from_str::<Config>(&contents) {
            Ok(config) => Ok(Some(config)),
            Err(e) => {
                eprintln!(
                    "warning: {} is not valid config ({e}); continuing with defaults",
                    path.display()
                );
                Ok(Some(Config::default()))
            }
        }
    }

    fn save_to(&self, path: &std::path::Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let contents = toml::to_string_pretty(self)?;
        std::fs::write(path, contents)?;
        set_owner_only_permissions(path)?;
        Ok(())
    }

    /// True when there is no usable session (no key configured).
    pub fn is_empty(&self) -> bool {
        self.api_key.trim().is_empty()
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

    #[test]
    fn save_then_load_roundtrips() {
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("nested").join("config.toml");

        // A non-default theme so the round trip actually exercises the new table.
        let config = Config {
            server_url: "http://localhost:3000".into(),
            api_key: "sk_sotto_example_key".into(),
            theme: ThemeChoice {
                mode: "dark".into(),
                light_palette: "paper".into(),
                accent: "#1C7A6B".into(),
            },
        };
        config.save_to(&path).unwrap();

        let loaded = Config::load_from(&path).unwrap().expect("config present");
        assert_eq!(loaded, config);
    }

    #[test]
    fn legacy_config_without_theme_loads_with_default_theme() {
        // A config written before theming existed: only the two original keys.
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("config.toml");
        std::fs::write(
            &path,
            "server_url = \"http://localhost:3000\"\napi_key = \"sk_sotto_old\"\n",
        )
        .unwrap();

        let loaded = Config::load_from(&path).unwrap().expect("config present");
        assert_eq!(loaded.server_url, "http://localhost:3000");
        assert_eq!(loaded.api_key, "sk_sotto_old");
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
            "server_url = \"s\"\napi_key = \"k\"\n\n[theme]\nmode = \"chartreuse\"\nlight_palette = \"plaid\"\naccent = \"#ZZZZZZ\"\n",
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
    fn login_preserves_an_existing_valid_theme() {
        // Simulate the login merge: a valid prior config has a non-default theme;
        // re-login overwrites only the credentials and keeps the theme block.
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("config.toml");
        let prior = Config {
            server_url: "http://old".into(),
            api_key: "sk_old".into(),
            theme: ThemeChoice {
                mode: "dark".into(),
                light_palette: "paper".into(),
                accent: "#80487F".into(),
            },
        };
        prior.save_to(&path).unwrap();

        // The login flow reads the prior config and reuses its theme.
        let existing = Config::load_from(&path).unwrap().expect("present");
        let after_login = Config {
            server_url: "http://new".into(),
            api_key: "sk_new".into(),
            theme: existing.theme.clone(),
        };
        assert_eq!(
            after_login.theme, prior.theme,
            "theme preserved across login"
        );
        assert_eq!(after_login.api_key, "sk_new", "credentials updated");
    }

    #[test]
    fn partial_theme_table_fills_missing_fields_from_defaults() {
        // Only `mode` set; light_palette + accent must default, not error.
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("config.toml");
        std::fs::write(
            &path,
            "server_url = \"s\"\napi_key = \"k\"\n\n[theme]\nmode = \"dark\"\n",
        )
        .unwrap();

        let loaded = Config::load_from(&path).unwrap().expect("config present");
        assert_eq!(loaded.theme.mode, "dark");
        assert_eq!(loaded.theme.light_palette, "aula");
        assert_eq!(loaded.theme.accent, "#3F4FB0");
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

        Config {
            server_url: "http://localhost:3000".into(),
            api_key: "sk_sotto_secret".into(),
            theme: ThemeChoice::default(),
        }
        .save_to(&path)
        .unwrap();

        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn is_empty_tracks_api_key() {
        let mut config = Config {
            server_url: "http://localhost:3000".into(),
            api_key: String::new(),
            theme: ThemeChoice::default(),
        };
        assert!(config.is_empty());
        config.api_key = "sk_sotto_x".into();
        assert!(!config.is_empty());
    }
}
