// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod permissions;
mod bridge;
mod config;

use tauri::{
    menu::{Menu, MenuItem},
    Manager,
};
use std::sync::Mutex;

struct AppState {
    running: Mutex<bool>,
    tunnel_url: Mutex<Option<String>>,
    api_secret: Mutex<Option<String>>,
}

#[tauri::command]
async fn check_config() -> Result<serde_json::Value, String> {
    let config = config::load_config().map_err(|e| e.to_string())?;
    
    Ok(serde_json::json!({
        "configured": config.anthropic_key.is_some(),
        "tunnelUrl": config.tunnel_url,
    }))
}

#[tauri::command]
async fn check_permissions() -> Result<serde_json::Value, String> {
    let results = permissions::check_all();
    Ok(serde_json::json!(results))
}

#[tauri::command]
async fn request_permission(permission: String) -> Result<(), String> {
    permissions::request(&permission).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_automation_apps() -> Result<Vec<String>, String> {
    Ok(permissions::get_automation_apps())
}

#[tauri::command]
async fn get_automation_apps_with_status() -> Result<Vec<(String, bool)>, String> {
    Ok(permissions::get_automation_apps_with_status())
}

#[tauri::command]
async fn prewarm_app(app_name: String) -> Result<bool, String> {
    Ok(permissions::prewarm_app(&app_name))
}

#[tauri::command]
async fn save_api_key(api_key: String) -> Result<(), String> {
    let mut config = config::load_config().unwrap_or_default();
    config.anthropic_key = Some(api_key);
    
    // Find and save project root
    match bridge::find_project_root(Some(&config)) {
        Ok(root) => {
            config.project_root = Some(root.to_string_lossy().to_string());
        }
        Err(e) => {
            return Err(format!("Could not find SYSTEM project: {}", e));
        }
    }
    
    config::save_config(&config).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn start_local_server(state: tauri::State<'_, AppState>) -> Result<String, String> {
    // Generate a new secure token for this session
    let token = bridge::generate_token();
    
    // Store the token in app state
    *state.api_secret.lock().unwrap() = Some(token.clone());
    
    // Start the server with the generated token
    bridge::start_local_server(&token).await.map_err(|e| e.to_string())?;
    
    // Return the token so frontend can display it
    Ok(token)
}

#[tauri::command]
async fn start_tunnel(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    match bridge::start_tunnel_and_get_url().await {
        Ok(url) => {
            *state.tunnel_url.lock().unwrap() = Some(url.clone());
            *state.running.lock().unwrap() = true;
            
            // Get the stored API secret
            let api_secret = state.api_secret.lock().unwrap().clone();
            
            // Save tunnel URL to config
            if let Ok(mut config) = config::load_config() {
                config.tunnel_url = Some(url.clone());
                let _ = config::save_config(&config);
            }
            
            Ok(serde_json::json!({
                "success": true,
                "url": url,
                "apiSecret": api_secret,
            }))
        }
        Err(e) => Ok(serde_json::json!({
            "success": false,
            "error": e.to_string(),
        }))
    }
}

#[tauri::command]
async fn stop_system(state: tauri::State<'_, AppState>) -> Result<(), String> {
    bridge::stop_all().await.map_err(|e| e.to_string())?;
    *state.running.lock().unwrap() = false;
    *state.tunnel_url.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
async fn get_status(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    let running = *state.running.lock().unwrap();
    let url = state.tunnel_url.lock().unwrap().clone();
    
    Ok(serde_json::json!({
        "running": running,
        "tunnelUrl": url,
    }))
}

#[tauri::command]
async fn show_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn quit_app(app: tauri::AppHandle) -> Result<(), String> {
    // Stop everything before quitting
    let _ = bridge::stop_all().await;
    app.exit(0);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            running: Mutex::new(false),
            tunnel_url: Mutex::new(None),
            api_secret: Mutex::new(None),
        })
        .setup(|app| {
            // Create menu for the tray icon
            let menu = Menu::with_items(app, &[
                &MenuItem::with_id(app, "open", "Open SYSTEM", true, None::<&str>)?,
                &MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?,
            ])?;
            
            // Get the tray icon created by config and set its menu
            if let Some(tray) = app.tray_by_id("main") {
                tray.set_menu(Some(menu))?;
                tray.on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "open" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            tauri::async_runtime::block_on(async {
                                let _ = bridge::stop_all().await;
                            });
                            app.exit(0);
                        }
                        _ => {}
                    }
                });
            }
            
            // Always show window on launch for now
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_config,
            check_permissions,
            request_permission,
            get_automation_apps,
            get_automation_apps_with_status,
            prewarm_app,
            save_api_key,
            start_local_server,
            start_tunnel,
            stop_system,
            get_status,
            show_window,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
