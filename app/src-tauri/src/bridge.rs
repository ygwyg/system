use crate::config::Config;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::path::PathBuf;
use once_cell::sync::Lazy;

static BRIDGE_PROCESS: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));
static TUNNEL_PROCESS: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));

/// Find the project root directory
fn find_project_root() -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    // Try multiple strategies to find the project root
    
    // 1. Check for SYSTEM_PROJECT_ROOT env var
    if let Ok(root) = std::env::var("SYSTEM_PROJECT_ROOT") {
        let path = PathBuf::from(root);
        if path.join("cloudflare-agent").exists() {
            return Ok(path);
        }
    }
    
    // 2. Check current directory
    let current_dir = std::env::current_dir()?;
    if current_dir.join("cloudflare-agent").exists() {
        return Ok(current_dir);
    }
    
    // 3. Check parent of current directory (when running from app/)
    if let Some(parent) = current_dir.parent() {
        if parent.join("cloudflare-agent").exists() {
            return Ok(parent.to_path_buf());
        }
    }
    
    // 4. Check relative to executable
    if let Ok(exe_path) = std::env::current_exe() {
        // macOS: /path/to/SYSTEM.app/Contents/MacOS/system-app
        // Go up to find project root
        let mut path = exe_path;
        for _ in 0..6 {
            if let Some(parent) = path.parent() {
                path = parent.to_path_buf();
                if path.join("cloudflare-agent").exists() {
                    return Ok(path);
                }
            }
        }
    }
    
    // 5. Check home directory for system project
    if let Ok(home) = std::env::var("HOME") {
        let common_paths = [
            format!("{}/Desktop/cua", home),
            format!("{}/Projects/system", home),
            format!("{}/code/system", home),
            format!("{}/dev/system", home),
        ];
        
        for p in common_paths {
            let path = PathBuf::from(&p);
            if path.join("cloudflare-agent").exists() {
                return Ok(path);
            }
        }
    }
    
    Err("Could not find SYSTEM project root. Set SYSTEM_PROJECT_ROOT environment variable.".into())
}

/// Start the bridge server
pub async fn start() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Check if already running
    if let Some(ref mut child) = *BRIDGE_PROCESS.lock().unwrap() {
        if child.try_wait()?.is_none() {
            return Ok(()); // Already running
        }
    }
    
    let project_root = find_project_root()?;
    
    // Start bridge using node
    let child = Command::new("node")
        .arg("dist/bridge/http-server.js")
        .current_dir(&project_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    
    *BRIDGE_PROCESS.lock().unwrap() = Some(child);
    
    // Give it a moment to start
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
    
    Ok(())
}

/// Stop the bridge server
pub async fn stop() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(mut child) = BRIDGE_PROCESS.lock().unwrap().take() {
        child.kill()?;
    }
    
    if let Some(mut child) = TUNNEL_PROCESS.lock().unwrap().take() {
        child.kill()?;
    }
    
    Ok(())
}

/// Start cloudflared tunnel
pub async fn start_tunnel() -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    // Check if already running
    if let Some(ref mut child) = *TUNNEL_PROCESS.lock().unwrap() {
        if child.try_wait()?.is_none() {
            return Err("Tunnel already running".into());
        }
    }
    
    let child = Command::new("cloudflared")
        .args(["tunnel", "--url", "http://localhost:3000"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    
    *TUNNEL_PROCESS.lock().unwrap() = Some(child);
    
    // TODO: Parse the tunnel URL from output
    Ok("https://tunnel.trycloudflare.com".to_string())
}

/// Deploy to Cloudflare Workers
pub async fn deploy_to_cloudflare(config: &Config) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let project_root = find_project_root()?;
    let agent_dir = project_root.join("cloudflare-agent");
    
    if !agent_dir.exists() {
        return Err(format!("cloudflare-agent directory not found at {:?}", agent_dir).into());
    }
    
    // Ensure dependencies are installed
    let npm_install = Command::new("npm")
        .arg("install")
        .current_dir(&agent_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()?;
    
    if !npm_install.status.success() {
        let stderr = String::from_utf8_lossy(&npm_install.stderr);
        return Err(format!("Failed to install dependencies: {}", stderr).into());
    }
    
    // Deploy with wrangler
    let mut deploy_cmd = Command::new("npx");
    deploy_cmd
        .args(["wrangler", "deploy"])
        .current_dir(&agent_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    
    // Set account ID if available
    if let Some(account_id) = &config.cloudflare_account_id {
        deploy_cmd.env("CLOUDFLARE_ACCOUNT_ID", account_id);
    }
    
    let output = deploy_cmd.output()?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    
    if !output.status.success() {
        // Combine stdout and stderr for better error info
        let combined = format!("{}\n{}", stdout, stderr);
        return Err(format!("Deploy failed: {}", combined.trim()).into());
    }
    
    // Extract URL from output (check both stdout and stderr)
    let combined_output = format!("{}\n{}", stdout, stderr);
    let url = combined_output
        .lines()
        .find(|line| line.contains("workers.dev"))
        .and_then(|line| {
            line.split_whitespace()
                .find(|word| word.contains("workers.dev"))
        })
        .map(|s| s.trim().to_string())
        .ok_or("Could not find deployed URL in output")?;
    
    // Set secrets
    let secrets = [
        ("ANTHROPIC_API_KEY", config.anthropic_key.as_deref().unwrap_or("")),
        ("BRIDGE_AUTH_TOKEN", config.auth_token.as_deref().unwrap_or("")),
        ("API_SECRET", &config.auth_token.as_deref().unwrap_or("").chars().take(32).collect::<String>()),
        ("BRIDGE_URL", "http://localhost:3000"),
    ];
    
    for (name, value) in secrets {
        if value.is_empty() {
            continue;
        }
        
        let mut secret_cmd = Command::new("sh");
        secret_cmd
            .args(["-c", &format!("echo '{}' | npx wrangler secret put {}", value, name)])
            .current_dir(&agent_dir)
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        
        if let Some(account_id) = &config.cloudflare_account_id {
            secret_cmd.env("CLOUDFLARE_ACCOUNT_ID", account_id);
        }
        
        let _ = secret_cmd.output(); // Ignore errors for secrets
    }
    
    Ok(url)
}
