# SYSTEM API Reference

Remote Mac automation powered by AI. Control your Mac from anywhere.

## Base URL

```
Agent: https://your-agent.workers.dev
Bridge: http://localhost:3456
```

## Authentication

```
Authorization: Bearer <api_secret>
```

Or query parameter: `?token=<api_secret>`

---

## Agent Endpoints

### Chat

```http
POST /chat

{
  "message": "Play some jazz music"
}
```

Response:
```json
{
  "message": "Playing jazz on Apple Music",
  "actions": [{
    "tool": "music_play",
    "args": { "query": "jazz" },
    "success": true,
    "result": "Now playing: Jazz Vibes"
  }]
}
```

### Reset State

```http
POST /reset
```

Clears conversation history, pending actions, and resets agent state.

### List Schedules

```http
GET /schedules
```

Response:
```json
{
  "schedules": [{
    "id": "abc123",
    "description": "Play closing time",
    "scheduledAt": "2026-01-05T17:00:00Z",
    "cron": "0 17 * * *"
  }]
}
```

### Cancel Schedule

```http
DELETE /schedules/:id
```

### Get State (Debug)

```http
GET /state
```

Response:
```json
{
  "preferences": { "wife": "Jane" },
  "historyLength": 12,
  "scheduleCount": 2
}
```

### WebSocket

```
wss://your-agent.workers.dev/ws?token=...
```

Events: `scheduled_result`, `notification`, `bridge_status`

---

## Bridge Endpoints

### List Tools

```http
GET /tools
Authorization: Bearer <bridge_auth_token>
```

### Execute Tool

```http
POST /execute
Authorization: Bearer <bridge_auth_token>

{
  "tool": "open_app",
  "args": { "app": "Safari" }
}
```

Response:
```json
{
  "success": true,
  "result": "Opened Safari"
}
```

### Health Check

```http
GET /health
```

---

## Tools Reference

### Core

| Tool | Description | Args |
|------|-------------|------|
| `open_app` | Open application | `app` |
| `open_url` | Open URL in browser | `url` |
| `shell` | Run shell command | `command` |
| `shell_list` | List available commands | — |
| `applescript` | Execute AppleScript | `script` |
| `notify` | Show notification | `title`, `message` |
| `say` | Text-to-speech | `text`, `voice?` |
| `clipboard_get` | Get clipboard | — |
| `clipboard_set` | Set clipboard | `text` |
| `screenshot` | Take screenshot | — |

### Computer Use Agent (CUA)

Visual automation - AI sees your screen and controls mouse/keyboard.

| Tool | Description | Args |
|------|-------------|------|
| `cua_screenshot` | Take screenshot | `type?` (full/window) |
| `cua_click` | Click at coordinates | `x`, `y`, `button?`, `clicks?` |
| `cua_double_click` | Double-click | `x`, `y` |
| `cua_right_click` | Right-click | `x`, `y` |
| `cua_type` | Type text | `text`, `delay?` |
| `cua_key` | Press key combo | `key` (e.g., "cmd+c", "return") |
| `cua_scroll` | Scroll | `direction`, `amount?`, `x?`, `y?` |
| `cua_drag` | Drag from point to point | `fromX`, `fromY`, `toX`, `toY` |
| `cua_focus_app` | Focus application | `app` |
| `cua_launch_app` | Launch application | `app` |
| `cua_window_manage` | Manage window | `app`, `action`, `x?`, `y?`, `width?`, `height?` |
| `cua_menu_click` | Click menu item | `app`, `menu`, `item`, `submenu?` |
| `cua_get_windows` | List visible windows | — |
| `cua_mouse_position` | Get cursor position | — |
| `cua_screen_info` | Get display info | — |
| `cua_wait` | Wait N seconds | `seconds` |
| `cua_wait_for` | Wait for UI element | `role`, `title?`, `condition?`, `timeout?` |
| `cua_select_all` | Cmd+A | — |
| `cua_copy` | Cmd+C | — |
| `cua_paste` | Cmd+V | — |
| `cua_undo` | Cmd+Z | — |
| `cua_save` | Cmd+S | — |
| `cua_new_tab` | Cmd+T | — |
| `cua_close_window` | Cmd+W | — |
| `cua_open_url` | Open URL in browser | `url` |

### Accessibility (AX)

Find and interact with UI elements by role/title.

| Tool | Description | Args |
|------|-------------|------|
| `ax_get_elements` | Get UI tree of frontmost app | — |
| `ax_find` | Find elements by role | `role`, `title?` |
| `ax_click_element` | Click element by title | `title`, `role?` |
| `ax_type_in_field` | Type in text field | `text`, `field?`, `clear?` |
| `ax_focused_element` | Get focused element | — |
| `ax_list_apps` | List running apps | — |

### Computer Use Endpoint

```http
POST /computer-use
Authorization: Bearer <api_secret>

{
  "goal": "Click the Submit button",
  "maxIterations": 10,
  "app": "Safari"
}
```

Response:
```json
{
  "success": true,
  "message": "Clicked Submit button",
  "iterations": 2,
  "actions": [...]
}
```

### Music

| Tool | Description | Args |
|------|-------------|------|
| `music_play` | Play/search music | `query?` |
| `music_pause` | Pause playback | — |
| `music_next` | Next track | — |
| `music_previous` | Previous track | — |
| `music_current` | Current track info | — |
| `volume_get` | Get volume | — |
| `volume_set` | Set volume | `level` (0-100) |
| `volume_up` | Volume +10% | — |
| `volume_down` | Volume -10% | — |
| `volume_mute` | Toggle mute | — |

### Calendar & Reminders

| Tool | Description | Args |
|------|-------------|------|
| `calendar_today` | Today's events | — |
| `calendar_upcoming` | Next N events | `count?` |
| `calendar_next` | Next event | — |
| `calendar_create` | Create event | `title`, `start`, `end?` |
| `reminders_list` | List reminders | `list?` |
| `reminders_create` | Create reminder | `title`, `list?`, `dueDate?` |
| `reminders_complete` | Complete reminder | `title` |

### System Status

| Tool | Description | Args |
|------|-------------|------|
| `battery_status` | Battery info | — |
| `wifi_status` | WiFi info | — |
| `storage_status` | Disk space | — |
| `running_apps` | Running apps | — |
| `front_app` | Frontmost app | — |

### Display & Focus

| Tool | Description | Args |
|------|-------------|------|
| `brightness_set` | Set brightness | `level` (0-100) |
| `dark_mode_toggle` | Toggle dark mode | — |
| `dark_mode_status` | Get dark mode | — |
| `dnd_toggle` | Toggle DND | — |
| `lock_screen` | Lock Mac | — |
| `sleep_display` | Sleep display | — |
| `sleep_mac` | Sleep Mac | — |

### Notes

| Tool | Description | Args |
|------|-------------|------|
| `notes_list` | List notes | — |
| `notes_search` | Search notes | `query` |
| `notes_create` | Create note | `title`, `body?`, `folder?` |
| `notes_read` | Read note | `title` |
| `notes_append` | Append to note | `title`, `text` |

### Files

| Tool | Description | Args |
|------|-------------|------|
| `finder_search` | Search files | `query` |
| `finder_downloads` | List downloads | — |
| `finder_desktop` | List desktop | — |
| `finder_reveal` | Reveal in Finder | `path` |
| `finder_trash` | Move to trash | `path` |

### Shortcuts

| Tool | Description | Args |
|------|-------------|------|
| `shortcut_run` | Run shortcut | `name`, `input?` |
| `shortcut_list` | List shortcuts | — |

### Browser

| Tool | Description | Args |
|------|-------------|------|
| `browser_url` | Get current URL | — |
| `browser_tabs` | List tabs | — |

### Raycast

| Tool | Description | Args |
|------|-------------|------|
| `raycast` | Run extension | `extension`, `command`, `arguments?` |

Plus any extensions enabled during setup become dedicated tools.

---

## Errors

```json
{
  "error": "Description of what went wrong"
}
```

| Code | Description |
|------|-------------|
| 401 | Invalid or missing token |
| 404 | Endpoint or tool not found |
| 500 | Internal error |
| 503 | Bridge offline |

---

## Rate Limiting

No built-in rate limiting. The bridge processes requests sequentially.

---

## Security

- Bearer token authentication
- Shell command allowlisting
- Dangerous pattern blocking
- Ephemeral tunnel URLs
