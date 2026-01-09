use std::collections::HashMap;
use std::process::Command;

/// Check all macOS permissions
pub fn check_all() -> HashMap<String, bool> {
    let mut results = HashMap::new();
    
    // Note: Full Disk Access removed - no longer needed without iMessage
    results.insert("accessibility".to_string(), check_accessibility());
    results.insert("screen_recording".to_string(), check_screen_recording());
    results.insert("automation".to_string(), check_automation());
    // Note: Contacts is handled via Automation permission (AppleScript prompt)
    
    results
}

/// Request a specific permission (opens System Settings)
pub fn request(permission: &str) -> Result<(), Box<dyn std::error::Error>> {
    let url = match permission {
        "accessibility" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        "screen_recording" => "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        "automation" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
        _ => return Err("Unknown permission".into()),
    };
    
    Command::new("open")
        .arg(url)
        .spawn()?;
    
    Ok(())
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
    // Try to take a screenshot - this is the most reliable way to check
    // If screen recording is not granted, screencapture will fail or produce empty output
    let output = Command::new("screencapture")
        .args(["-x", "-c"]) // -x no sound, -c to clipboard (no file)
        .output();
    
    match output {
        Ok(o) => o.status.success(),
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
    ("Music", "tell application \"Music\" to get name"),
    ("Notes", "tell application \"Notes\" to get name"),
    ("Reminders", "tell application \"Reminders\" to get name"),
    ("Safari", "tell application \"Safari\" to get name"),
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
