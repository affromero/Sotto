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

    fn load_from(path: &std::path::Path) -> Result<Option<Self>> {
        if !path.exists() {
            return Ok(None);
        }
        let contents = std::fs::read_to_string(path)?;
        let config: Config = toml::from_str(&contents)?;
        Ok(Some(config))
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

        let config = Config {
            server_url: "http://localhost:3000".into(),
            api_key: "sk_sotto_example_key".into(),
        };
        config.save_to(&path).unwrap();

        let loaded = Config::load_from(&path).unwrap().expect("config present");
        assert_eq!(loaded, config);
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
        };
        assert!(config.is_empty());
        config.api_key = "sk_sotto_x".into();
        assert!(!config.is_empty());
    }
}
