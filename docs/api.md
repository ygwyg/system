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
