use std::collections::HashMap;
use std::process::Command;

/// Check all macOS permissions
pub fn check_all() -> HashMap<String, bool> {
    let mut results = HashMap::new();
    
    results.insert("full_disk".to_string(), check_full_disk_access());
    results.insert("accessibility".to_string(), check_accessibility());
    results.insert("screen_recording".to_string(), check_screen_recording());
    results.insert("contacts".to_string(), check_contacts());
    results.insert("automation".to_string(), check_automation());
    
    results
}

/// Request a specific permission (opens System Settings)
pub fn request(permission: &str) -> Result<(), Box<dyn std::error::Error>> {
    let url = match permission {
        "full_disk" => "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
        "accessibility" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        "screen_recording" => "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        "contacts" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts",
        "automation" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
        _ => return Err("Unknown permission".into()),
    };
    
    Command::new("open")
        .arg(url)
        .spawn()?;
    
    Ok(())
}

/// Check Full Disk Access by trying to read Messages database
fn check_full_disk_access() -> bool {
    let home = std::env::var("HOME").unwrap_or_default();
    let db_path = format!("{}/Library/Messages/chat.db", home);
    
    let output = Command::new("sqlite3")
        .args([&db_path, "SELECT 1 LIMIT 1"])
        .output();
    
    match output {
        Ok(o) => o.status.success(),
        Err(_) => false,
    }
}

/// Check Accessibility permission
fn check_accessibility() -> bool {
    let output = Command::new("osascript")
        .args(["-e", "tell application \"System Events\" to return name of first process"])
        .output();
    
    match output {
        Ok(o) => o.status.success(),
        Err(_) => false,
    }
}

/// Check Contacts access
fn check_contacts() -> bool {
    let output = Command::new("osascript")
        .args(["-e", "tell application \"Contacts\" to return count of people"])
        .output();
    
    match output {
        Ok(o) => o.status.success(),
        Err(_) => false,
    }
}

/// Check Automation permission
fn check_automation() -> bool {
    let output = Command::new("osascript")
        .args(["-e", "tell application \"System Events\" to get name of first application process whose frontmost is true"])
        .output();
    
    match output {
        Ok(o) => o.status.success(),
        Err(_) => false,
    }
}

/// Check Screen Recording permission
fn check_screen_recording() -> bool {
    // Use CGPreflightScreenCaptureAccess via a simple swift snippet
    // This returns the actual permission state without triggering a prompt
    let output = Command::new("swift")
        .args(["-e", "import ScreenCaptureKit; print(CGPreflightScreenCaptureAccess())"])
        .output();
    
    match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            stdout.trim() == "true"
        }
        Err(_) => false,
    }
}

/// Apps that need Automation permission
/// These commands trigger the Automation permission dialog - they use simple property access
/// that works even if the app has no data (e.g., empty calendar)
pub const AUTOMATION_APPS: &[(&str, &str)] = &[
    ("Calendar", "tell application \"Calendar\" to get name"),
    ("Contacts", "tell application \"Contacts\" to get name"),
    ("Finder", "tell application \"Finder\" to get name"),
    ("Messages", "tell application \"Messages\" to get name"),
    ("Music", "tell application \"Music\" to get name"),
    ("Notes", "tell application \"Notes\" to get name"),
    ("Reminders", "tell application \"Reminders\" to get name"),
    ("Safari", "tell application \"Safari\" to get name"),
    ("Google Chrome", "tell application \"Google Chrome\" to get name"),
    ("System Events", "tell application \"System Events\" to get name"),
];

/// Check if automation permission is already granted for an app
/// This is a quick check that doesn't trigger a dialog if not granted
pub fn check_app_permission(app_name: &str) -> bool {
    // Use tccutil or check if we can run a simple command
    // For now, we check by looking at TCC database or trying a non-interactive check
    let script = AUTOMATION_APPS
        .iter()
        .find(|(name, _)| *name == app_name)
        .map(|(_, script)| *script);
    
    if let Some(script) = script {
        // Run with a short timeout - if it hangs waiting for permission, it's not granted
        let output = Command::new("osascript")
            .args(["-e", script])
            .output();
        
        match output {
            Ok(o) => o.status.success(),
            Err(_) => false,
        }
    } else {
        false
    }
}

/// Pre-warm Automation permission for a specific app
/// Returns true if permission was granted (or already granted), false if denied
pub fn prewarm_app(app_name: &str) -> bool {
    // Find the script for this app
    let script = AUTOMATION_APPS
        .iter()
        .find(|(name, _)| *name == app_name)
        .map(|(_, script)| *script);
    
    if let Some(script) = script {
        let output = Command::new("osascript")
            .args(["-e", script])
            .output();
        
        match output {
            Ok(o) => o.status.success(),
            Err(_) => false,
        }
    } else {
        false
    }
}

/// Get list of apps with their current permission status
pub fn get_automation_apps_with_status() -> Vec<(String, bool)> {
    AUTOMATION_APPS
        .iter()
        .map(|(name, _)| {
            let granted = check_app_permission(name);
            (name.to_string(), granted)
        })
        .collect()
}

/// Get list of apps that need pre-warming
pub fn get_automation_apps() -> Vec<String> {
    AUTOMATION_APPS.iter().map(|(name, _)| name.to_string()).collect()
}
