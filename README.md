# SYSTEM

**Control your Mac from anywhere with AI.**

```
┌────────────────────────────┐
│ █▀▀ █▄█ █▀▀ ▀█▀ █▀▀ █▀▄▀█  │
│ ▀▀█  █  ▀▀█  █  ██▄ █ ▀ █  │
└────────────────────────────┘
```

SYSTEM is a self-hosted AI assistant that controls your Mac. Talk to it naturally—play music, send messages, run commands, and more.

## Quick Start

```bash
# Install
git clone https://github.com/ygwyg/system.git
cd system
npm install

# Setup (interactive wizard)
npm run setup

# Start
npm start
```

That's it. Open the URL shown and start chatting.

## What Can It Do?

- **Music** - "Play some jazz" / "Skip this song"
- **Messaging** - "Text mom I'm running late" (with confirmation)
- **Reminders** - "Remind me to stretch in 30 minutes"
- **System** - "Set volume to 50%" / "What's on my clipboard?"
- **Raycast** - Use any installed extension
- **Shell** - Run safe commands
- **AppleScript** - Advanced automation

## Setup Wizard

The setup wizard (`npm run setup`) guides you through:

1. **Raycast** - Scan and select extensions (optional)
2. **AI** - Enter your Anthropic API key
3. **Interface** - Web UI or API-only
4. **Access** - Local or remote (via tunnel)

## Requirements

- macOS
- Node.js 18+
- [Anthropic API key](https://console.anthropic.com)
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/) (for remote access, optional)
- [Raycast](https://raycast.com) (optional)

## Configuration

After setup, your config is saved in `bridge.config.json`:

```json
{
  "authToken": "your-secure-token",
  "anthropicKey": "sk-ant-...",
  "mode": "ui",
  "access": "remote",
  "extensions": [...]
}
```

## Commands

```bash
npm run setup    # Interactive setup wizard
npm start        # Start SYSTEM
npm run dev      # Start bridge only (no tunnel)
npm run build    # Rebuild TypeScript
```

## Architecture

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Your Phone    │      │   Cloudflare    │      │    Your Mac     │
│   or Laptop     │─────▶│   (Optional)    │─────▶│   (Bridge)      │
│                 │      │                 │      │                 │
│  Chat with AI   │      │  Quick Tunnel   │      │  Runs Commands  │
└─────────────────┘      └─────────────────┘      └─────────────────┘
```

**Local mode:** Everything runs on your Mac, accessible at `localhost`.

**Remote mode:** Uses a secure Cloudflare tunnel (no account needed!) to access from anywhere.

## Security

- All endpoints require authentication
- Dangerous shell commands blocked
- Messages require confirmation (human-in-the-loop)
- Tokens generated automatically
- Everything runs on YOUR infrastructure

### Recommended: Cloudflare Access

If you deploy to Cloudflare Workers, **strongly consider** adding [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) for an extra layer of security. This adds Zero Trust authentication before anyone can reach your agent.

**Quick Setup (Dashboard):**
1. Go to [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com)
2. Navigate to **Access** → **Applications** → **Add an application**
3. Select **Self-hosted** and enter your worker URL
4. Create an access policy (e.g., email ends with `@yourdomain.com`)
5. Save — now users must authenticate before accessing SYSTEM

**Automation (Terraform):**
```hcl
resource "cloudflare_access_application" "system" {
  zone_id          = var.zone_id
  name             = "SYSTEM"
  domain           = "your-agent.workers.dev"
  session_duration = "24h"
}

resource "cloudflare_access_policy" "system_policy" {
  application_id = cloudflare_access_application.system.id
  zone_id        = var.zone_id
  name           = "Allow specific emails"
  precedence     = 1
  decision       = "allow"

  include {
    email = ["you@example.com"]
  }
}
```

This is separate from the API secret—it adds authentication at the network edge before requests even reach your worker.

## Troubleshooting

**"No auth token"** - Run `npm run setup`

**Tunnel not starting** - Install cloudflared: `brew install cloudflared`

**Agent errors** - Check `cloudflare-agent/.dev.vars` has correct values

## Advanced

### Deploy Agent to Cloudflare

For a permanent deployment (instead of local):

```bash
cd cloudflare-agent
npm install

# Set secrets
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put BRIDGE_URL
npx wrangler secret put BRIDGE_AUTH_TOKEN
npx wrangler secret put API_SECRET

# Deploy
npm run deploy
```

## License

MIT
