import { Agent, routeAgentRequest, getAgentByName, type Schedule, type Connection, type ConnectionContext } from "agents";
import { chatHTML } from "./ui";

/**
 * SYSTEM Agent - Remote Mac Control via AI
 * 
 * A Cloudflare Agent that controls your Mac remotely.
 * Features: Real-time WebSocket, scheduled tasks, human-in-the-loop.
 */

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface Env {
  ANTHROPIC_API_KEY: string;
  BRIDGE_URL: string;
  BRIDGE_AUTH_TOKEN: string;
  API_SECRET: string;
  SystemAgent: DurableObjectNamespace<SystemAgent>;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Tool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

interface PendingAction {
  tool: string;
  args: Record<string, unknown>;
  context: string;
  originalRequest: string;
}

interface RateLimit {
  count: number;
  resetAt: number;
}

interface ScheduleRecord {
  id: string;
  when: string;
  tool: string;
  args: Record<string, unknown>;
  description: string;
  createdAt: number;
  type: "one-time" | "recurring";
}

interface SystemState {
  history: Message[];
  preferences: Record<string, string>;
  lastActive: number;
  pendingAction?: PendingAction;
  rateLimit?: RateLimit;
  scheduleRegistry: ScheduleRecord[];
}

interface ScheduledAction {
  tool: string;
  args: Record<string, unknown>;
  description: string;
}

interface WSMessage {
  type: "notification" | "scheduled_result" | "bridge_status" | "chat" | "ping";
  payload: unknown;
  timestamp: string;
}

// ═══════════════════════════════════════════════════════════════
// Security Helpers
// ═══════════════════════════════════════════════════════════════

/**
 * Constant-time string comparison to prevent timing attacks.
 * Returns true if strings are equal, false otherwise.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// ═══════════════════════════════════════════════════════════════
// Agent Implementation
// ═══════════════════════════════════════════════════════════════

export class SystemAgent extends Agent<Env, SystemState> {
  initialState: SystemState = {
    history: [],
    preferences: {},
    lastActive: Date.now(),
    scheduleRegistry: [],
  };

  private readonly RATE_LIMIT = 60;
  private readonly RATE_WINDOW = 60 * 1000;
  private connections: Map<string, Connection> = new Map();

  // WebSocket handlers
  onConnect(connection: Connection, _ctx: ConnectionContext) {
    this.connections.set(connection.id, connection);
    this.sendToConnection(connection, {
      type: "notification",
      payload: { title: "Connected", message: "Real-time updates enabled" },
      timestamp: new Date().toISOString(),
    });
  }

  async onMessage(connection: Connection, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;
    
    try {
      const data = JSON.parse(message);
      
      if (data.type === "ping") {
        this.sendToConnection(connection, {
          type: "ping",
          payload: { pong: true },
          timestamp: new Date().toISOString(),
        });
      } else if (data.type === "chat" && data.token && data.message) {
        if (!timingSafeEqual(data.token, this.env.API_SECRET)) {
          this.sendToConnection(connection, {
            type: "notification",
            payload: { title: "Error", message: "Invalid token" },
            timestamp: new Date().toISOString(),
          });
          return;
        }
        
        const result = await this.processChat(data.message);
        this.sendToConnection(connection, {
          type: "chat",
          payload: result,
          timestamp: new Date().toISOString(),
        });
      }
    } catch {}
  }

  onClose(connection: Connection) {
    this.connections.delete(connection.id);
  }

  private sendToConnection(connection: Connection, message: WSMessage) {
    try {
      connection.send(JSON.stringify(message));
    } catch {
      this.connections.delete(connection.id);
    }
  }

  broadcastToClients(message: WSMessage) {
    const payload = JSON.stringify(message);
    for (const [id, conn] of this.connections) {
      try {
        conn.send(payload);
      } catch {
        this.connections.delete(id);
      }
    }
  }

  // Rate limiting
  checkRateLimit(): { allowed: boolean; remaining: number; resetIn: number } {
    const now = Date.now();
    let rateLimit = this.state.rateLimit;
    
    if (!rateLimit || now >= rateLimit.resetAt) {
      rateLimit = { count: 0, resetAt: now + this.RATE_WINDOW };
    }
    
    rateLimit.count++;
    this.setState({ ...this.state, rateLimit });
    
    return {
      allowed: rateLimit.count <= this.RATE_LIMIT,
      remaining: Math.max(0, this.RATE_LIMIT - rateLimit.count),
      resetIn: Math.max(0, rateLimit.resetAt - now),
    };
  }

  // HTTP request handler
  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Root - status
    if (path === "/" && request.method === "GET") {
      return Response.json({
        status: "online",
        agent: "SYSTEM",
        timestamp: new Date().toISOString(),
      });
    }
    
    // Health check
    if (path.endsWith("/health")) {
      return Response.json({
        status: "awake",
        timestamp: new Date().toISOString(),
        schedules: (this.state.scheduleRegistry || []).length,
      });
    }
    

    // Rate limiting
    const { allowed, resetIn } = this.checkRateLimit();
    if (!allowed) {
      return Response.json(
        { error: "Rate limit exceeded" },
        { status: 429, headers: { "X-RateLimit-Reset": String(Math.ceil(resetIn / 1000)) } }
      );
    }
    
    // Chat
    if (path.endsWith("/chat") && request.method === "POST") {
      return this.handleChat(request);
    }
    
    // Reset state (keeps preferences)
    if (path.endsWith("/reset") && request.method === "POST") {
      const prefs = this.state.preferences;
      this.setState({ ...this.initialState, preferences: prefs, lastActive: Date.now() });
      return Response.json({ success: true, message: "History cleared, preferences kept" });
    }
    
    // Get state (debug)
    if (path.endsWith("/state") && request.method === "GET") {
      return Response.json({
        historyLength: this.state.history.length,
        preferences: this.state.preferences,
        pendingAction: this.state.pendingAction,
        lastActive: this.state.lastActive,
      });
    }
    
    // Execute tool directly
    if (path.endsWith("/execute") && request.method === "POST") {
      return this.handleExecute(request);
    }
    
    // Get schedules
    if (path.endsWith("/schedules") && request.method === "GET") {
      const registry = this.state.scheduleRegistry || [];
      const formatted = registry.map((s: ScheduleRecord) => ({
        id: s.id,
        time: s.when,
        payload: { tool: s.tool, args: s.args, description: s.description },
        type: s.type,
        createdAt: s.createdAt,
      }));
      return Response.json({ schedules: formatted });
    }
    
    // Delete schedule
    if (path.match(/\/schedules\/[^/]+$/) && request.method === "DELETE") {
      const scheduleId = path.split('/').pop();
      if (scheduleId) {
        try { await this.cancelSchedule(scheduleId); } catch {}
        const registry = this.state.scheduleRegistry || [];
        this.setState({
          ...this.state,
          scheduleRegistry: registry.filter((s: ScheduleRecord) => s.id !== scheduleId),
        });
        return Response.json({ success: true });
      }
      return Response.json({ error: "Invalid schedule ID" }, { status: 400 });
    }
    
    // Get history
    if (path.endsWith("/history") && request.method === "GET") {
      return Response.json({ history: this.state.history, lastActive: this.state.lastActive });
    }
    
    // Clear history
    if (path.endsWith("/clear") && request.method === "POST") {
      this.setState({ ...this.state, history: [] });
      return Response.json({ success: true });
    }
    
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  async handleChat(request: Request): Promise<Response> {
    try {
      const body = await request.json() as { message: string };
      const result = await this.processChat(body.message);
      return Response.json(result);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
    }
  }

  async handleExecute(request: Request): Promise<Response> {
    try {
      const body = await request.json() as { tool: string; args: Record<string, unknown> };
      const result = await this.callBridge(body.tool, body.args);
      return Response.json(result);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
    }
  }

  isConfirmation(message: string): boolean {
    return /^(yes|yeah|yep|yup|sure|ok|okay|do it|send it|confirm|go ahead|please|y)\.?!?$/i.test(message.trim());
  }
  
  isCancellation(message: string): boolean {
    return /^(no|nope|cancel|stop|don't|nevermind|never mind|abort|n)\.?!?$/i.test(message.trim());
  }

  // Main chat processing
  async processChat(message: string): Promise<{
    message: string;
    action?: { tool: string; args: Record<string, unknown>; result: string; success: boolean };
    actions?: Array<{ tool: string; args: Record<string, unknown>; result: string; success: boolean; image?: { data: string; mimeType: string } }>;
    scheduled?: { id: string; when: string; description: string };
  }> {
    // Handle pending actions (human-in-the-loop)
    if (this.state.pendingAction) {
      const pending = this.state.pendingAction;
      
      if (this.isConfirmation(message)) {
        const result = await this.callBridge(pending.tool, pending.args);
        this.setState({
          ...this.state,
          pendingAction: undefined,
          history: [
            ...this.state.history,
            { role: "user" as const, content: message },
            { role: "assistant" as const, content: result.success ? "Sent!" : "Failed." },
          ].slice(-50),
          lastActive: Date.now(),
        });
        
        return {
          message: result.success ? "Sent!" : `Failed: ${result.error}`,
          action: { tool: pending.tool, args: pending.args, result: result.success ? result.result! : result.error!, success: result.success },
        };
      }
      
      if (this.isCancellation(message)) {
        this.setState({
          ...this.state,
          pendingAction: undefined,
          history: [...this.state.history, { role: "user" as const, content: message }, { role: "assistant" as const, content: "Cancelled." }].slice(-50),
          lastActive: Date.now(),
        });
        return { message: "Cancelled." };
      }
      
      if (pending.args.message === '' && pending.tool === 'send_imessage') {
        this.setState({
          ...this.state,
          pendingAction: { ...pending, args: { ...pending.args, message } },
          history: [...this.state.history, { role: "user" as const, content: message }].slice(-50),
          lastActive: Date.now(),
        });
        return { message: `Send "${message}" to ${pending.args.to}? *(yes/no)*` };
      }
      
      this.setState({ ...this.state, pendingAction: undefined });
    }
    
    // Process with Claude
    const tools = await this.fetchTools();
    const messages: Message[] = [...this.state.history.slice(-40), { role: "user" as const, content: message }];
    const systemPrompt = this.buildSystemPrompt(tools);
    const response = await this.callClaude(systemPrompt, messages);
    const { text, actions, schedule } = this.parseResponse(response);
    
    const actionResults: Array<{ tool: string; args: Record<string, unknown>; result: string; success: boolean; image?: { data: string; mimeType: string } }> = [];
    let scheduledTask;
    
    if (schedule) {
      const scheduleResult = await this.scheduleAction(schedule);
      scheduledTask = { id: scheduleResult.id, when: schedule.when, description: schedule.description };
    }
    
    // Execute actions
    for (const action of actions) {
      const result = await this.callBridge(action.tool, action.args);
      const actionResult: typeof actionResults[0] = {
        tool: action.tool,
        args: action.args,
        result: result.success ? result.result! : result.error!,
        success: result.success,
      };
      if (result.image) actionResult.image = result.image;
      actionResults.push(actionResult);
      
      // Contact search -> message flow (human-in-the-loop)
      if (action.tool === 'search_contacts' && result.success && result.result && !result.result.toLowerCase().includes('error')) {
        const phoneMatch = result.result.match(/[\+]?1?[\s\-\.]?\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]?\d{4}/);
        const phone = phoneMatch ? phoneMatch[0].replace(/[\s\-\.\(\)]/g, '') : null;
        
        if (phone) {
          // Use message from Claude's action args (preferred) or fall back to regex
          let intendedMessage = action.args.message as string || '';
          
          // Fallback: try to extract from original user message
          if (!intendedMessage) {
            const patterns = [
              /(?:saying|say)\s+["']?(.+?)["']?$/i,
              /(?:that|to say)\s+["']?(.+?)["']?$/i,
            ];
            for (const pattern of patterns) {
              const match = message.match(pattern);
              if (match?.[1] && match[1].length > 0) { 
                intendedMessage = match[1].trim().replace(/^["']|["']$/g, ''); 
                break; 
              }
            }
          }
          
          if (/make\s*up|create|write|generate/i.test(message)) {
            const generated = await this.callClaude("Write a short, friendly message. Just the text, nothing else.", [{ role: "user", content: `Write: "${message}"` }]);
            this.setState({ ...this.state, pendingAction: { tool: 'send_imessage', args: { to: phone, message: generated.trim() }, context: result.result, originalRequest: message } });
            return { message: `Found: **${result.result}**\n\n> "${generated.trim()}"\n\nSend? *(yes/no)*`, actions: actionResults };
          }
          
          this.setState({
            ...this.state,
            pendingAction: { tool: 'send_imessage', args: { to: phone, message: intendedMessage }, context: result.result, originalRequest: message },
            history: [...this.state.history, { role: "user" as const, content: message }].slice(-50),
          });
          
          return {
            message: intendedMessage ? `Found: **${result.result}**\n\nSend "${intendedMessage}"? *(yes/no)*` : `Found: **${result.result}**\n\nWhat message?`,
            actions: actionResults,
          };
        }
      }
    }
    
    this.setState({
      ...this.state,
      history: [...this.state.history, { role: "user" as const, content: message }, { role: "assistant" as const, content: response }].slice(-50),
      lastActive: Date.now(),
    });
    
    return { message: text, action: actionResults[0], actions: actionResults, scheduled: scheduledTask };
  }

  async scheduleAction(schedule: { when: string; tool: string; args: Record<string, unknown>; description: string }): Promise<{ id: string }> {
    const when = this.parseWhen(schedule.when);
    const payload: ScheduledAction = { tool: schedule.tool, args: schedule.args, description: schedule.description };
    const result = await this.schedule(when, "executeScheduledAction", payload);
    
    const isRecurring = typeof when === "string" && when.includes("*");
    const record: ScheduleRecord = {
      id: result.id,
      when: typeof when === "string" ? when : schedule.when,
      tool: schedule.tool,
      args: schedule.args,
      description: schedule.description,
      createdAt: Date.now(),
      type: isRecurring ? "recurring" : "one-time",
    };
    
    const registry = this.state.scheduleRegistry || [];
    this.setState({ ...this.state, scheduleRegistry: [...registry, record] });
    
    return { id: result.id };
  }

  async executeScheduledAction(payload: ScheduledAction) {
    const result = await this.callBridge(payload.tool, payload.args);
    
    const registry = this.state.scheduleRegistry || [];
    const scheduleRecord = registry.find((s: ScheduleRecord) => s.tool === payload.tool && s.description === payload.description);
    
    const historyEntry = { role: "assistant" as const, content: `[Scheduled: ${payload.description}]\n${result.success ? result.result : result.error}` };
    
    if (scheduleRecord?.type === "one-time") {
      this.setState({
        ...this.state,
        history: [...this.state.history, historyEntry].slice(-50),
        scheduleRegistry: registry.filter((s: ScheduleRecord) => s.id !== scheduleRecord.id),
      });
    } else {
      this.setState({ ...this.state, history: [...this.state.history, historyEntry].slice(-50) });
    }
    
    this.broadcastToClients({
      type: "scheduled_result",
      payload: {
        description: payload.description,
        tool: payload.tool,
        args: payload.args,
        result: result.success ? result.result : result.error,
        success: result.success,
        image: result.image,
      },
      timestamp: new Date().toISOString(),
    });
  }

  parseWhen(when: string): Date | number | string {
    const now = Date.now();
    
    // Cron syntax
    if (/^[\d\*\/\-\,]+\s+[\d\*\/\-\,]+\s+[\d\*\/\-\,]+\s+[\d\*\/\-\,]+\s+[\d\*\/\-\,]+$/.test(when.trim())) {
      return when.trim();
    }
    
    // "every day at X"
    const dailyMatch = when.match(/every\s*day\s*(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (dailyMatch) {
      let hour = parseInt(dailyMatch[1]);
      const minute = dailyMatch[2] ? parseInt(dailyMatch[2]) : 0;
      if (dailyMatch[3]?.toLowerCase() === 'pm' && hour < 12) hour += 12;
      if (dailyMatch[3]?.toLowerCase() === 'am' && hour === 12) hour = 0;
      return `${minute} ${hour} * * *`;
    }
    
    if (/every\s*hour/i.test(when)) return '0 * * * *';
    if (/every\s*morning/i.test(when)) return '0 7 * * *';
    if (/every\s*evening/i.test(when)) return '0 18 * * *';
    
    const everyHours = when.match(/every\s*(\d+)\s*hours?/i);
    if (everyHours) return `0 */${everyHours[1]} * * *`;
    
    const weekday = when.match(/every\s*weekday\s*(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (weekday) {
      let hour = parseInt(weekday[1]);
      const minute = weekday[2] ? parseInt(weekday[2]) : 0;
      if (weekday[3]?.toLowerCase() === 'pm' && hour < 12) hour += 12;
      return `${minute} ${hour} * * 1-5`;
    }
    
    // "in X minutes/hours"
    const relative = when.match(/in\s+(\d+)\s*(second|minute|hour|day)s?/i);
    if (relative) {
      const mult: Record<string, number> = { second: 1000, minute: 60000, hour: 3600000, day: 86400000 };
      return new Date(now + parseInt(relative[1]) * mult[relative[2].toLowerCase()]);
    }
    
    const parsed = new Date(when);
    return isNaN(parsed.getTime()) ? new Date(now + 60000) : parsed;
  }

  buildSystemPrompt(tools: Tool[]): string {
    // Separate core tools from extension tools
    // HIDE send_imessage from Claude - it's handled internally after search_contacts
    const coreTools = tools.filter(t => 
      t.name !== 'send_imessage' && (
        !t.name.includes('_') || 
        ['music_', 'volume_', 'calendar_', 'reminders_', 'battery_', 'wifi_', 'storage_', 'running_', 'front_', 'brightness_', 'dark_mode_', 'dnd_', 'lock_', 'sleep_', 'notes_', 'finder_', 'shortcut_', 'browser_', 'clipboard_', 'search_'].some(p => t.name.startsWith(p))
      )
    );
    const extensionTools = tools.filter(t => !coreTools.includes(t) && t.name.includes('_') && t.name !== 'send_imessage');
    
    const coreDesc = coreTools.map(t => `- ${t.name}: ${t.description}`).join("\n");
    
    // For extension tools, include argument info so Claude knows what to pass
    const extDesc = extensionTools.length > 0 
      ? "\n\nRAYCAST EXTENSIONS (use these exact tool names):\n" + extensionTools.map(t => {
          const schema = t.inputSchema as { properties?: Record<string, { description?: string }>, required?: string[] };
          const props = schema?.properties || {};
          const required = schema?.required || [];
          const args = Object.entries(props)
            .filter(([k]) => k !== 'text')
            .map(([k, v]) => `${k}${required.includes(k) ? '*' : ''}: ${v.description || k}`)
            .join(', ');
          return `- ${t.name}${args ? ` (${args})` : ''}`;
        }).join("\n")
      : "";
    const prefs = Object.entries(this.state.preferences).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "None";
    
    return `You are SYSTEM, a personal AI assistant that controls a Mac remotely. Be helpful and concise.

USER PREFERENCES:
${prefs}

AVAILABLE TOOLS:
${coreDesc}${extDesc}

IMPORTANT: For Raycast extensions, use the EXACT tool name from the list above (like "slack_send_message", "linear_create_issue"). Do NOT use the generic "raycast" tool - use the specific extension tools instead.

===== QUICK REFERENCE =====

MUSIC: music_play, music_pause, music_next, music_previous, music_current
VOLUME: volume_up, volume_down, volume_set, volume_mute, volume_get
MESSAGING (iMessage/SMS):
  ⚠️ ONLY way to send messages: use search_contacts tool
  ⚠️ NEVER use applescript to send messages - it won't work!
  
  Flow:
  1. If user uses a nickname (wife, mom, boss), check USER PREFERENCES for the real name
  2. Call search_contacts with the real name AND the message to send
  3. System handles confirmation and sending automatically
  
  IMPORTANT: Rewrite the message from the sender's perspective!
  - "tell her I love her" → "I love you" (speaking TO her, not about her)
  - "let him know I'm running late" → "I'm running late"
  - "ask her if she wants dinner" → "Do you want dinner?"
  
  Example: "text my wife and tell her I love her"
  - Check USER PREFERENCES: wife -> (stored name)
  - Rewrite message for recipient: "I love you"
  - Call: {"tool": "search_contacts", "args": {"query": "(name)", "message": "I love you"}}
CALENDAR: calendar_today, calendar_upcoming, calendar_next, calendar_create
REMINDERS: reminders_list, reminders_create, reminders_complete
SYSTEM: battery_status, wifi_status, storage_status, running_apps, front_app
DISPLAY: brightness_set, dark_mode_toggle, dark_mode_status, dnd_toggle
SCREEN: lock_screen, sleep_display, sleep_mac
NOTES: notes_list, notes_search, notes_create, notes_read, notes_append
FILES: finder_search, finder_downloads, finder_desktop, finder_reveal, finder_trash
SHORTCUTS: shortcut_run, shortcut_list
BROWSER: browser_url, browser_tabs
APPS: open_app, open_url
OTHER: screenshot, notify, say, clipboard_get, clipboard_set

===== ACTION FORMAT =====

\`\`\`action
{"tool": "music_play", "args": {"query": "Resonance"}}
\`\`\`

Multiple actions (separate blocks):
\`\`\`action
{"tool": "open_app", "args": {"name": "Chrome"}}
\`\`\`
\`\`\`action
{"tool": "battery_status", "args": {}}
\`\`\`

Raycast extensions with arguments:
\`\`\`action
{"tool": "linear_create_issue_for_myself", "args": {"title": "Fix the bug"}}
\`\`\`
\`\`\`action
{"tool": "spotify_player_justPlay", "args": {"query": "Bohemian Rhapsody"}}
\`\`\`

===== SCHEDULING =====

For future tasks, use schedule blocks (not action blocks):

\`\`\`schedule
{"when": "in 5 minutes", "tool": "notify", "args": {"message": "Hi"}, "description": "Reminder"}
\`\`\`

\`\`\`schedule
{"when": "every day at 5pm", "tool": "music_play", "args": {"query": "chill"}, "description": "Daily music"}
\`\`\`

Supported: "in X minutes/hours", "every day at Xpm", "every morning/evening", "every hour", "every weekday at X", cron syntax

===== PREFERENCES =====
\`\`\`preference
{"key": "name", "value": "value"}
\`\`\`

Be brief. Don't explain - just do it.`;
  }

  parseResponse(content: string): {
    text: string;
    actions: Array<{ tool: string; args: Record<string, unknown> }>;
    schedule?: { when: string; tool: string; args: Record<string, unknown>; description: string };
  } {
    let text = content;
    const actions: Array<{ tool: string; args: Record<string, unknown> }> = [];
    let schedule;
    
    // Extract action blocks
    const actionRegex = /```action\n?([\s\S]*?)\n?```/g;
    let actionMatch;
    while ((actionMatch = actionRegex.exec(content)) !== null) {
      try {
        const action = JSON.parse(actionMatch[1]);
        if (action?.tool) actions.push(action);
      } catch {}
    }
    text = text.replace(/```action\n?[\s\S]*?\n?```/g, "").trim();
    
    // Extract schedule block
    const scheduleMatch = content.match(/```schedule\n?([\s\S]*?)\n?```/);
    if (scheduleMatch) {
      try {
        schedule = JSON.parse(scheduleMatch[1]);
        text = text.replace(/```schedule\n?[\s\S]*?\n?```/, "").trim();
      } catch {}
    }
    
    // Extract preference block
    const prefMatch = content.match(/```preference\n?([\s\S]*?)\n?```/);
    if (prefMatch) {
      try {
        const pref = JSON.parse(prefMatch[1]);
        text = text.replace(/```preference\n?[\s\S]*?\n?```/, "").trim();
        if (pref) this.setState({ ...this.state, preferences: { ...this.state.preferences, [pref.key]: pref.value } });
      } catch {}
    }
    
    return { text: text || "Done!", actions, schedule };
  }

  async callClaude(systemPrompt: string, messages: Message[]): Promise<string> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 4096, system: systemPrompt, messages }),
    });

    if (!response.ok) throw new Error(`Claude API error: ${response.status}`);
    const data = await response.json() as { content: { text: string }[] };
    return data.content[0]?.text || "No response";
  }

  async fetchTools(): Promise<Tool[]> {
    try {
      const res = await fetch(`${this.env.BRIDGE_URL}/tools`, {
        headers: { Authorization: `Bearer ${this.env.BRIDGE_AUTH_TOKEN}` },
      });
      const data = await res.json() as { tools: Tool[] };
      return data.tools || [];
    } catch { return []; }
  }

  async callBridge(tool: string, args: Record<string, unknown>): Promise<{ success: boolean; result?: string; error?: string; image?: { data: string; mimeType: string } }> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      
      const res = await fetch(`${this.env.BRIDGE_URL}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.env.BRIDGE_AUTH_TOKEN}` },
        body: JSON.stringify({ tool, args }),
        signal: controller.signal,
      });
      
      clearTimeout(timeout);
      const data = await res.json() as Record<string, unknown>;
      return {
        success: Boolean(data.success),
        result: data.result as string,
        error: data.error as string,
        image: data.image as { data: string; mimeType: string } | undefined
      };
    } catch (e) {
      return { success: false, error: e instanceof Error && e.name === "AbortError" ? "Timeout" : "Bridge unreachable" };
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Worker Entry Point
// ═══════════════════════════════════════════════════════════════

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // Serve UI (no cache for fresh updates)
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(chatHTML, { 
        headers: { 
          "Content-Type": "text/html",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
          "Expires": "0"
        } 
      });
    }
    
    // API info
    if (url.pathname === "/api" && request.method === "GET") {
      return Response.json({
        name: "SYSTEM",
        version: "1.0.0",
        endpoints: ["/", "/agents/system-agent/chat", "/agents/system-agent/schedules"],
      });
    }
    
    // Agent routes
    if (url.pathname.startsWith("/agents/")) {
      const authHeader = request.headers.get("Authorization");
      const token = authHeader?.replace("Bearer ", "");
      
      if (!token || !timingSafeEqual(token, env.API_SECRET)) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      
      const agent = await getAgentByName(env.SystemAgent, "main");
      
      const prefix = "/agents/system-agent";
      const agentPath = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || "/" : "/";
      
      const agentUrl = new URL(request.url);
      agentUrl.pathname = agentPath;
      const agentRequest = new Request(agentUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });
      
      return agent.fetch(agentRequest);
    }
    
    const response = await routeAgentRequest(request, env);
    return response || Response.json({ error: "Not found" }, { status: 404 });
  },
};
