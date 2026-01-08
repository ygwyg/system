use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub anthropic_key: Option<String>,
    pub project_root: Option<String>,
    pub tunnel_url: Option<String>,
    // Legacy/advanced fields
    pub auth_token: Option<String>,
    pub mode: Option<String>,
    pub deployed: Option<bool>,
    pub deployed_url: Option<String>,
    pub cloudflare_account_id: Option<String>,
    #[serde(default)]
    pub extensions: Vec<serde_json::Value>,
}

/// Get the app's config directory (~/.config/system or ~/Library/Application Support/system)
fn get_config_dir() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let home = std::env::var("HOME")?;
    
    // Use macOS standard location
    let config_dir = PathBuf::from(&home)
        .join("Library")
        .join("Application Support")
        .join("system");
    
    // Create if doesn't exist
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)?;
    }
    
    Ok(config_dir)
}

/// Get the path to the config file
fn config_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let config_dir = get_config_dir()?;
    Ok(config_dir.join("config.json"))
}

/// Load configuration from bridge.config.json
pub fn load_config() -> Result<Config, Box<dyn std::error::Error>> {
    let path = config_path()?;
    
    if !path.exists() {
        return Ok(Config::default());
    }
    
    let content = fs::read_to_string(path)?;
    let config: Config = serde_json::from_str(&content)?;
    
    Ok(config)
}

/// Save configuration to bridge.config.json
pub fn save_config(config: &Config) -> Result<(), Box<dyn std::error::Error>> {
    let path = config_path()?;
    let content = serde_json::to_string_pretty(config)?;
    fs::write(path, content)?;
    Ok(())
}
