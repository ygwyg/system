use crate::config::Config;
use std::process::{Command, Stdio, Child};
use std::sync::Mutex;
use std::path::PathBuf;
use std::io::{BufRead, BufReader};
use once_cell::sync::Lazy;
use std::thread;
use rand::Rng;

static LOCAL_SERVER_PROCESS: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));
static TUNNEL_PROCESS: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));
static BRIDGE_PROCESS: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));

/// Generate a secure random token for API authentication
pub fn generate_token() -> String {
    const CHARSET: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut rng = rand::thread_rng();
    (0..32)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

fn get_path_env() -> String {
    let _home = std::env::var("HOME").unwrap_or_default();
    let existing_path = std::env::var("PATH").unwrap_or_default();
    
    let paths = [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ];
    
    let mut path_vec: Vec<&str> = paths.to_vec();
    if !existing_path.is_empty() {
        path_vec.push(&existing_path);
    }
    
    path_vec.join(":")
}

fn create_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    cmd.env("PATH", get_path_env());
    cmd
}

pub fn find_project_root(config: Option<&Config>) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    if let Some(cfg) = config {
        if let Some(ref root) = cfg.project_root {
            let path = PathBuf::from(root);
            if path.join("cloudflare-agent").exists() {
                return Ok(path);
            }
        }
    }
    
    if let Ok(home) = std::env::var("HOME") {
        let common_paths = [
            format!("{}/Desktop/cua", home),
            format!("{}/Desktop/system", home),
            format!("{}/Projects/system", home),
            format!("{}/code/system", home),
        ];
        
        for p in common_paths {
            let path = PathBuf::from(&p);
            if path.join("cloudflare-agent").exists() {
                return Ok(path);
            }
        }
    }
    
    Err("Could not find SYSTEM project".into())
}

pub async fn start_local_server(api_secret: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Check if already running
    {
        let mut guard = LOCAL_SERVER_PROCESS.lock().unwrap();
        if let Some(ref mut child) = *guard {
            if child.try_wait()?.is_none() {
                return Ok(());
            }
        }
    }
    
    let config = crate::config::load_config().ok();
    let project_root = find_project_root(config.as_ref())?;
    let agent_dir = project_root.join("cloudflare-agent");
    
    // Write .dev.vars with API key and the generated API secret
    if let Some(cfg) = &config {
        if let Some(ref api_key) = cfg.anthropic_key {
            // Use the provided api_secret for both bridge auth and API secret
            let dev_vars = format!(
                "ANTHROPIC_API_KEY={}\nBRIDGE_URL=http://localhost:3000\nBRIDGE_AUTH_TOKEN={}\nAPI_SECRET={}\n",
                api_key, api_secret, api_secret
            );
            std::fs::write(agent_dir.join(".dev.vars"), dev_vars)?;
            
            // Also write the bridge config so the bridge server uses the same token
            let bridge_config = serde_json::json!({
                "authToken": api_secret
            });
            std::fs::write(
                project_root.join("bridge.config.json"),
                serde_json::to_string_pretty(&bridge_config)?
            )?;
        }
    }
    
    // Start wrangler dev
    let child = create_command("npx")
        .args(["wrangler", "dev", "--port", "8787"])
        .current_dir(&agent_dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    
    *LOCAL_SERVER_PROCESS.lock().unwrap() = Some(child);
    
    // Start bridge too
    start_bridge().await?;
    
    // Wait for server to be ready
    tokio::time::sleep(tokio::time::Duration::from_secs(4)).await;
    
    Ok(())
}

async fn start_bridge() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    {
        let mut guard = BRIDGE_PROCESS.lock().unwrap();
        if let Some(ref mut child) = *guard {
            if child.try_wait()?.is_none() {
                return Ok(());
            }
        }
    }
    
    let config = crate::config::load_config().ok();
    let project_root = find_project_root(config.as_ref())?;
    
    let child = create_command("node")
        .arg("dist/bridge/http-server.js")
        .current_dir(&project_root)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    
    *BRIDGE_PROCESS.lock().unwrap() = Some(child);
    Ok(())
}

pub async fn start_tunnel_and_get_url() -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    // Check if already running
    {
        let mut guard = TUNNEL_PROCESS.lock().unwrap();
        if let Some(ref mut child) = *guard {
            if child.try_wait()?.is_none() {
                return Err("Tunnel already running".into());
            }
        }
    }
    
    // Start cloudflared and capture stderr to get URL
    let mut child = create_command("cloudflared")
        .args(["tunnel", "--url", "http://localhost:8787"])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()?;
    
    let stderr = child.stderr.take().ok_or("Failed to get stderr")?;
    
    // Read URL in a separate thread so we don't block
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            // Look for the tunnel URL
            if line.contains("trycloudflare.com") {
                let trimmed = line.trim().trim_matches('|').trim();
                if trimmed.starts_with("https://") {
                    let _ = tx.send(trimmed.to_string());
                    break;
                }
                // Try to find URL in the line
                for word in line.split_whitespace() {
                    let clean = word.trim_matches('|');
                    if clean.starts_with("https://") && clean.contains("trycloudflare.com") {
                        let _ = tx.send(clean.to_string());
                        break;
                    }
                }
            }
        }
        // Keep draining stderr so the pipe doesn't block cloudflared
        // This thread will exit when cloudflared exits
    });
    
    // Store the child process
    *TUNNEL_PROCESS.lock().unwrap() = Some(child);
    
    // Wait for URL with timeout
    let url = rx.recv_timeout(std::time::Duration::from_secs(30))
        .map_err(|_| "Timeout waiting for tunnel URL")?;
    
    Ok(url)
}

pub async fn stop_all() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(mut child) = LOCAL_SERVER_PROCESS.lock().unwrap().take() {
        let _ = child.kill();
    }
    if let Some(mut child) = TUNNEL_PROCESS.lock().unwrap().take() {
        let _ = child.kill();
    }
    if let Some(mut child) = BRIDGE_PROCESS.lock().unwrap().take() {
        let _ = child.kill();
    }
    Ok(())
}
