# SYSTEM

**Control your Mac from anywhere with AI.**

SYSTEM is a self-hosted AI assistant that controls your Mac. Talk to it naturally—play music, manage reminders, run commands, and more.

## Install

### Desktop App (Recommended)

Download [SYSTEM.dmg](https://github.com/ygwyg/system/releases/latest) from releases, drag to Applications, and launch. The app guides you through setup and lives in your menu bar.

### CLI

```bash
git clone https://github.com/ygwyg/system.git
cd system && npm install
npm run setup   # interactive wizard
npm start       # start everything
```

## Features

- **Music** — "Play some jazz" / "Skip this song"
- **Reminders** — "Remind me to stretch in 30 minutes"
- **Calendar** — "What's on my schedule today?"
- **Notes** — "Add to my shopping list"
- **System** — "Set volume to 50%" / "Toggle dark mode"
- **Files** — "Show my recent downloads"
- **Shortcuts** — Run any Apple Shortcut
- **Raycast** — Use any installed extension
- **Shell** — Run safe commands

## Permissions

SYSTEM requires 3 macOS permissions:

| Permission | Why |
|------------|-----|
| **Accessibility** | Keyboard/mouse control, window management |
| **Screen Recording** | Screenshots for visual context |
| **Automation** | Control apps (Finder, Safari, Notes, Calendar, etc.) |

The desktop app guides you through granting these.

## Architecture

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Your Device   │      │   Cloudflare    │      │    Your Mac     │
│                 │─────▶│   Workers       │─────▶│   (Bridge)      │
│  Chat with AI   │      │   (Agent)       │      │  Runs Commands  │
└─────────────────┘      └─────────────────┘      └─────────────────┘
```

- **Agent** (brain): Cloudflare Worker with Claude AI, scheduling, memory
- **Bridge** (body): Local server on your Mac that executes commands
- **Desktop App**: Native macOS app that manages everything

## Requirements

- macOS
- [Anthropic API key](https://console.anthropic.com)
- Node.js 18+ (CLI only)

## Documentation

Full documentation: **[ygwyg.github.io/system](https://ygwyg.github.io/system)**

- [API Reference](https://ygwyg.github.io/system/#auth)
- [Tools Reference](https://ygwyg.github.io/system/#core-tools)
- [Security](https://ygwyg.github.io/system/#security)

## Security

- All endpoints require authentication
- Shell commands are allowlisted
- Tokens generated automatically
- Everything runs on YOUR infrastructure
- Optional: Add [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) for Zero Trust auth

## License

MIT
