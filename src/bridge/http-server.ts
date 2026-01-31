#!/usr/bin/env node

import express from 'express';
import { allTools, getAllToolsWithDiscovery } from './tools/index.js';
import type { SystemTool } from './tools/index.js';
import { ZodError } from 'zod';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * SYSTEM Bridge
 *
 * The local bridge that runs on your Mac and executes commands.
 * This is the "body" that the SYSTEM Agent controls remotely.
 */

const app = express();
const PORT = process.env.PORT || 3000;

// Load auth token from config file or environment variable
function loadAuthToken(): string {
  // First, try environment variable
  if (process.env.BRIDGE_AUTH_TOKEN) {
    return process.env.BRIDGE_AUTH_TOKEN;
  }

  // Second, try bridge.config.json
  const configPath = join(process.cwd(), 'bridge.config.json');
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (config.authToken) {
        return config.authToken;
      }
    } catch {
      console.warn('Warning: Could not parse bridge.config.json');
    }
  }

  return '';
}

const AUTH_TOKEN = loadAuthToken();

let loadedTools: SystemTool[] = allTools;

if (!AUTH_TOKEN) {
  console.error(`
╔════════════════════════════════════════════════════════════╗
║  ⚠️  SECURITY ERROR: No auth token configured!             ║
╠════════════════════════════════════════════════════════════╣
║  Option 1: Run the setup wizard                            ║
║    npm run setup                                           ║
║                                                            ║
║  Option 2: Set environment variable                        ║
║    export BRIDGE_AUTH_TOKEN=$(openssl rand -hex 32)        ║
╚════════════════════════════════════════════════════════════╝
`);

  process.exit(1);
}

// Rate limiting
interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const rateLimits = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 60; // 60 requests per minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(ip);

  if (!entry || entry.resetAt < now) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  entry.count++;
  return true;
}

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimits.entries()) {
    if (entry.resetAt < now) {
      rateLimits.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW);

// Execution log storage
interface LogEntry {
  timestamp: string;
  method: string;
  path: string;
  tool?: string;
  ip: string | undefined;
  success?: boolean;
}
const executionLog: LogEntry[] = [];
const MAX_LOG_SIZE = 100;

// Task registry for async tasks with callbacks
interface PendingTask {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  callbackUrl: string;
  callbackToken: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
}
const pendingTasks = new Map<string, PendingTask>();

// Clean up old completed tasks periodically (keep for 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [id, task] of pendingTasks.entries()) {
    if (task.completedAt && now - task.completedAt > 5 * 60 * 1000) {
      pendingTasks.delete(id);
    }
  }
}, 60 * 1000);

// Helper to generate task IDs
function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Helper to send callback to Agent
async function sendCallback(task: PendingTask): Promise<void> {
  try {
    const response = await fetch(task.callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${task.callbackToken}`,
      },
      body: JSON.stringify({
        taskId: task.id,
        tool: task.tool,
        args: task.args,
        status: task.status,
        result: task.result,
        error: task.error,
        completedAt: task.completedAt,
      }),
    });

    if (!response.ok) {
      console.error(`[Callback] Failed to notify ${task.callbackUrl}: ${response.status}`);
    } else {
      console.log(`[Callback] Successfully notified ${task.callbackUrl} for task ${task.id}`);
    }
  } catch (error) {
    console.error(`[Callback] Error notifying ${task.callbackUrl}:`, error);
  }
}

// Middleware
app.use(express.json({ limit: '100kb' })); // Limit body size

// Security headers
app.use((req, res, next) => {
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('X-XSS-Protection', '1; mode=block');
  res.header('Referrer-Policy', 'no-referrer');
  next();
});

// Request logging middleware
app.use((req, res, next) => {
  if (req.path === '/execute' || req.path === '/batch') {
    const body = req.body as { tool?: string };
    executionLog.push({
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      tool: body?.tool,
      ip: req.ip,
    });

    if (executionLog.length > MAX_LOG_SIZE) {
      executionLog.shift();
    }
  }
  next();
});

// CORS - restrictive by default
app.use((req, res, next) => {
  const corsOrigins = process.env.CORS_ORIGINS;
  const origin = req.headers.origin;

  // In production, CORS_ORIGINS must be explicitly set
  if (!corsOrigins) {
    // No CORS headers = same-origin only (most secure default)
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    return next();
  }

  const allowedOrigins = corsOrigins.split(',').map((o) => o.trim());

  // Never allow wildcard - require explicit origins
  if (allowedOrigins.includes('*')) {
    console.warn('⚠️  WARNING: CORS_ORIGINS contains "*" - this is insecure!');
  }

  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }

  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

// Rate limiting middleware
app.use((req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';

  if (!checkRateLimit(ip)) {
    return res.status(429).json({
      error: 'Too many requests',
      retryAfter: Math.ceil(RATE_LIMIT_WINDOW / 1000),
    });
  }

  next();
});

// Authentication middleware
function authenticate(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = authHeader.slice(7);

  // Constant-time comparison to prevent timing attacks
  if (token.length !== AUTH_TOKEN.length) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  let mismatch = 0;
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ AUTH_TOKEN.charCodeAt(i);
  }

  if (mismatch !== 0) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  next();
}

/**
 * Health check endpoint (no auth required)
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    tools: loadedTools.length,
    version: '1.0.0',
  });
});

/**
 * List available tools
 */
app.get('/tools', authenticate, (req, res) => {
  res.json({
    tools: loadedTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  });
});

/**
 * Execute a tool
 */
app.post('/execute', authenticate, async (req, res) => {
  const { tool: toolName, args } = req.body;

  if (!toolName || typeof toolName !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid tool name' });
  }

  const tool = loadedTools.find((t) => t.name === toolName);

  if (!tool) {
    return res.status(404).json({
      error: `Tool "${toolName}" not found`,
      availableTools: loadedTools.map((t) => t.name),
    });
  }

  try {
    // Log execution (sanitize args to avoid leaking sensitive data)
    const sanitizedArgs = Object.fromEntries(
      Object.entries(args || {}).map(([k, v]) => {
        // Redact values that might be sensitive
        if (/password|secret|token|key|auth/i.test(k)) {
          return [k, '[REDACTED]'];
        }
        // Truncate long values
        if (typeof v === 'string' && v.length > 100) {
          return [k, v.slice(0, 100) + '...'];
        }
        return [k, v];
      })
    );
    console.log(`[${new Date().toISOString()}] Executing: ${toolName}`, sanitizedArgs);

    // Execute the tool
    const result = await tool.handler(args || {});

    // Update log with success status
    const lastLog = executionLog[executionLog.length - 1];
    if (lastLog) {
      lastLog.success = !result.isError;
    }

    console.log(
      `[${new Date().toISOString()}] ${result.isError ? 'Failed' : 'Success'}: ${toolName}`
    );

    // Handle both text and image responses
    const content = result.content[0];
    if (content?.type === 'image' && content.data) {
      res.json({
        success: !result.isError,
        tool: toolName,
        result: 'Screenshot captured',
        image: {
          data: content.data,
          mimeType: content.mimeType || 'image/png',
        },
      });
    } else {
      res.json({
        success: !result.isError,
        tool: toolName,
        result: content?.text ?? 'Action completed',
      });
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error: ${toolName}`, error);

    // Update log with failure
    const lastLog = executionLog[executionLog.length - 1];
    if (lastLog) {
      lastLog.success = false;
    }

    // Handle validation errors specifically
    if (error instanceof ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
    }

    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Batch execute multiple tools
 */
app.post('/batch', authenticate, async (req, res) => {
  const { tools } = req.body;

  if (!Array.isArray(tools)) {
    return res.status(400).json({ error: 'Expected array of tools' });
  }

  if (tools.length > 10) {
    return res.status(400).json({ error: 'Maximum 10 tools per batch' });
  }

  const results = [];

  for (const { tool: toolName, args } of tools) {
    const tool = loadedTools.find((t) => t.name === toolName);

    if (!tool) {
      results.push({
        tool: toolName,
        success: false,
        error: 'Tool not found',
      });
      continue;
    }

    try {
      const result = await tool.handler(args || {});
      results.push({
        tool: toolName,
        success: !result.isError,
        result: result.content[0]?.text ?? 'Action completed',
      });
    } catch (error) {
      if (error instanceof ZodError) {
        results.push({
          tool: toolName,
          success: false,
          error: 'Validation error',
          details: error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
      } else {
        results.push({
          tool: toolName,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  res.json({ results });
});

/**
 * Get execution logs (last 100)
 */
app.get('/logs', authenticate, (req, res) => {
  res.json({ logs: executionLog });
});

/**
 * Execute a tool asynchronously with callback
 * The Bridge will call back to the provided URL when the task completes
 */
app.post('/execute-async', authenticate, async (req, res) => {
  const { tool: toolName, args, callbackUrl, callbackToken } = req.body;

  if (!toolName || typeof toolName !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid tool name' });
  }

  if (!callbackUrl || typeof callbackUrl !== 'string') {
    return res.status(400).json({ error: 'Missing callbackUrl for async execution' });
  }

  if (!callbackToken || typeof callbackToken !== 'string') {
    return res.status(400).json({ error: 'Missing callbackToken for async execution' });
  }

  const tool = loadedTools.find((t) => t.name === toolName);

  if (!tool) {
    return res.status(404).json({
      error: `Tool "${toolName}" not found`,
      availableTools: loadedTools.map((t) => t.name),
    });
  }

  // Create task record
  const taskId = generateTaskId();
  const task: PendingTask = {
    id: taskId,
    tool: toolName,
    args: args || {},
    callbackUrl,
    callbackToken,
    status: 'pending',
    createdAt: Date.now(),
  };
  pendingTasks.set(taskId, task);

  // Return immediately with task ID
  res.json({
    taskId,
    status: 'accepted',
    message: `Task ${taskId} queued for execution`,
  });

  // Execute asynchronously and callback when done
  setImmediate(async () => {
    task.status = 'running';

    try {
      console.log(`[Async] Starting task ${taskId}: ${toolName}`);
      const result = await tool.handler(args || {});

      task.status = 'completed';
      task.completedAt = Date.now();

      // Handle both text and image responses
      const content = result.content[0];
      if (content?.type === 'image' && content.data) {
        task.result = {
          success: !result.isError,
          tool: toolName,
          result: 'Screenshot captured',
          image: {
            data: content.data,
            mimeType: content.mimeType || 'image/png',
          },
        };
      } else {
        task.result = {
          success: !result.isError,
          tool: toolName,
          result: content?.text ?? 'Action completed',
        };
      }

      console.log(`[Async] Task ${taskId} completed successfully`);
    } catch (error) {
      task.status = 'failed';
      task.completedAt = Date.now();
      task.error = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Async] Task ${taskId} failed:`, error);
    }

    // Send callback to Agent
    await sendCallback(task);
  });
});

/**
 * Get status of a pending task
 */
app.get('/tasks/:taskId', authenticate, (req, res) => {
  const { taskId } = req.params;
  const task = pendingTasks.get(taskId);

  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.json({
    taskId: task.id,
    tool: task.tool,
    status: task.status,
    createdAt: task.createdAt,
    completedAt: task.completedAt,
    result: task.result,
    error: task.error,
  });
});

/**
 * List all pending/recent tasks
 */
app.get('/tasks', authenticate, (req, res) => {
  const tasks = Array.from(pendingTasks.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50)
    .map((t) => ({
      taskId: t.id,
      tool: t.tool,
      status: t.status,
      createdAt: t.createdAt,
      completedAt: t.completedAt,
    }));

  res.json({ tasks });
});

/**
 * Start server
 * By default, binds to localhost only for security.
 * Set HOST=0.0.0.0 to listen on all interfaces (for tunnel use).
 */
const HOST = process.env.HOST || '127.0.0.1';

async function startServer() {
  console.log('Discovering Raycast extensions...');
  try {
    loadedTools = await getAllToolsWithDiscovery();
    const discoveredCount = loadedTools.length - allTools.length;
    if (discoveredCount > 0) {
      console.log(`Found ${discoveredCount} auto-discovered Raycast commands`);
    }
  } catch (err) {
    console.warn('Could not auto-discover Raycast extensions:', err);
  }

  app.listen(Number(PORT), HOST, () => {
    const toolCount = String(loadedTools.length).padEnd(2);
    const hostDisplay = HOST === '127.0.0.1' ? 'localhost (local only)' : HOST;
    const securityMode = HOST === '127.0.0.1' ? '🔒 Local only' : '⚠️  Network exposed';

    console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║    ███████╗██╗   ██╗███████╗████████╗███████╗███╗   ███╗  ║
║    ██╔════╝╚██╗ ██╔╝██╔════╝╚══██╔══╝██╔════╝████╗ ████║  ║
║    ███████╗ ╚████╔╝ ███████╗   ██║   █████╗  ██╔████╔██║  ║
║    ╚════██║  ╚██╔╝  ╚════██║   ██║   ██╔══╝  ██║╚██╔╝██║  ║
║    ███████║   ██║   ███████║   ██║   ███████╗██║ ╚═╝ ██║  ║
║    ╚══════╝   ╚═╝   ╚══════╝   ╚═╝   ╚══════╝╚═╝     ╚═╝  ║
║                                                            ║
║              Control Your Mac From Anywhere                ║
║                                                            ║
╠════════════════════════════════════════════════════════════╣
║  Status: Awake                                             ║
║  Host: ${hostDisplay.padEnd(43)}║
║  Port: ${String(PORT).padEnd(4)}                                             ║
║  Tools: ${toolCount}                                              ║
║  Auth: ✅ Token configured                                 ║
╠════════════════════════════════════════════════════════════╣
║  Endpoints:                                                ║
║    GET  /health        Health check (no auth)              ║
║    GET  /tools         List available tools                ║
║    POST /execute       Execute a tool (sync)               ║
║    POST /execute-async Execute with callback (2-way sync)  ║
║    POST /batch         Execute multiple tools (max 10)     ║
║    GET  /tasks         List async tasks                    ║
║    GET  /tasks/:id     Get task status                     ║
║    GET  /logs          View execution logs                 ║
╠════════════════════════════════════════════════════════════╣
║  Security: ${securityMode.padEnd(39)}║
║    • Rate limit: ${RATE_LIMIT_MAX} req/min                              ║
║    • Request size: 100kb max                               ║
║    • Constant-time token comparison                        ║
╚════════════════════════════════════════════════════════════╝
  `);

    console.log(`Tools available:`);
    loadedTools.forEach((tool) => {
      console.log(`  • ${tool.name}`);
    });

    console.log(`\nSYSTEM is online and ready.\n`);
  });
}

startServer();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n👋 Received SIGTERM, shutting down...');
  process.exit(0);
});
