# SYSTEM Agent

The Cloudflare Worker that serves as the AI "brain" for SYSTEM. Deploy your own instance.

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure secrets for local development

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars`:

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
BRIDGE_URL=http://localhost:3000
BRIDGE_AUTH_TOKEN=your-bridge-token
API_SECRET=your-ui-password
```

### 3. Run locally

```bash
npm run dev
```

Open http://localhost:8787 and enter your `API_SECRET` to connect.

### 4. Deploy to Cloudflare

```bash
# Set your secrets (you'll be prompted for values)
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put BRIDGE_URL
npx wrangler secret put BRIDGE_AUTH_TOKEN
npx wrangler secret put API_SECRET

# Deploy
npm run deploy
```

Your agent will be live at `https://system-agent.<your-subdomain>.workers.dev`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key for Claude |
| `BRIDGE_URL` | URL to your bridge (tunnel URL for production) |
| `BRIDGE_AUTH_TOKEN` | Token to authenticate with your bridge |
| `API_SECRET` | Password for the web UI |

## Architecture

```
Your Browser
    │
    │ API_SECRET (Bearer token)
    ▼
Your Cloudflare Worker (system-agent.you.workers.dev)
    │
    ├──▶ Claude API (with your ANTHROPIC_API_KEY)
    │
    └──▶ Your Bridge (via BRIDGE_URL + BRIDGE_AUTH_TOKEN)
              │
              ▼
         Your Mac
```

Everything runs on your infrastructure. Full control.

## Features

### Chat Interface
Terminal-style web UI at the root path.

### Scheduling
```
"Remind me in 30 minutes"
"Every day at 9am, play my playlist"
"Every weekday at 5pm, notify me"
```

### Human-in-the-Loop
Sensitive actions (messaging) require confirmation.

### Preferences
Remembers context like names and relationships.

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Chat UI |
| `GET /api` | API info |
| `POST /agents/system-agent/chat` | Send chat message |
| `GET /agents/system-agent/schedules` | List scheduled tasks |
| `POST /agents/system-agent/clear` | Clear history |

All `/agents/*` endpoints require `Authorization: Bearer <API_SECRET>`.

## Development

```bash
# Type check
npx tsc --noEmit

# Run locally
npm run dev

# View logs after deployment
npx wrangler tail
```
