#!/usr/bin/env node

/**
 * SYSTEM Setup
 * 
 * Simplified setup with two modes:
 * - Local: Everything on localhost
 * - Remote: Deploy to Cloudflare, access from anywhere
 */

import * as readline from 'readline';
import { writeFileSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { execSync, spawn, spawnSync } from 'child_process';
import { homedir } from 'os';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface Extension {
  name: string;
  author: string;
  owner?: string;
  title: string;
  description: string;
  commands: Array<{
    name: string;
    title: string;
    description: string;
    arguments?: Array<{ name: string; type: string; description: string; required?: boolean }>;
  }>;
}

interface Config {
  authToken: string;
  anthropicKey: string;
  mode: 'local' | 'remote';
  extensions: Extension[];
  deployed?: boolean;
  deployedUrl?: string;
  cloudflareAccountId?: string;
  models?: {
    fast: string;
    smart: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// Terminal Utils
// ═══════════════════════════════════════════════════════════════

const write = (s: string) => process.stdout.write(s);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let rows = process.stdout.rows || 24;
let cols = process.stdout.columns || 80;
process.stdout.on('resize', () => { rows = process.stdout.rows || 24; cols = process.stdout.columns || 80; });

const esc = {
  clear: '\x1b[2J',
  home: '\x1b[H',
  hide: '\x1b[?25l',
  show: '\x1b[?25h',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  move: (row: number, col: number) => `\x1b[${row};${col}H`,
  clearLine: '\x1b[2K',
};

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[38;2;100;200;150m',
  greenBright: '\x1b[38;2;130;230;170m',
  red: '\x1b[38;2;200;100;100m',
  yellow: '\x1b[38;2;200;180;100m',
  gray: '\x1b[38;2;100;100;100m',
  white: '\x1b[38;2;200;200;200m',
  bright: '\x1b[38;2;230;230;230m',
  cyan: '\x1b[38;2;100;180;200m',
};

const moveTo = (row: number, col: number) => write(esc.move(Math.max(1, row), Math.max(1, col)));
const clearScreen = () => write(esc.clear + esc.home);
const hideCursor = () => write(esc.hide);
const showCursor = () => write(esc.show);
const safeRepeat = (str: string, count: number) => str.repeat(Math.max(0, count));

// ═══════════════════════════════════════════════════════════════
// UI Components
// ═══════════════════════════════════════════════════════════════

const LOGO = [
  '┌────────────────────────────┐',
  '│ █▀▀ █▄█ █▀▀ ▀█▀ █▀▀ █▀▄▀█ │',
  '│ ▀▀█  █  ▀▀█  █  ██▄ █ ▀ █ │',
  '└────────────────────────────┘',
];

async function drawLogo(): Promise<void> {
  const startCol = Math.floor((cols - LOGO[0].length) / 2);
  for (let i = 0; i < LOGO.length; i++) {
    moveTo(2 + i, startCol);
    write(c.green + LOGO[i] + c.reset);
  }
}

async function drawStep(num: number, total: number, title: string): Promise<void> {
  const y = 8;
  const indicatorWidth = total * 2;
  const indicatorX = Math.floor((cols - indicatorWidth) / 2);
  
  moveTo(y, indicatorX);
  for (let i = 1; i <= total; i++) {
    if (i < num) {
      write(c.green + '● ' + c.reset);
    } else if (i === num) {
      write(c.greenBright + c.bold + '◉ ' + c.reset);
    } else {
      write(c.gray + '○ ' + c.reset);
    }
  }
  
  moveTo(y + 2, Math.floor((cols - title.length) / 2));
  write(c.bright + c.bold + title + c.reset);
}

async function clearContent(): Promise<void> {
  for (let i = 8; i < rows - 2; i++) {
    moveTo(i, 1);
    write(esc.clearLine);
  }
}

async function showMessage(row: number, message: string, color = c.white): Promise<void> {
  moveTo(row, Math.floor((cols - message.length) / 2));
  write(color + message + c.reset);
}

async function showProgress(message: string, task: () => Promise<void>): Promise<boolean> {
  const row = 14;
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frame = 0;
  let running = true;
  
  const animate = async () => {
    while (running) {
      const col = Math.floor((cols - message.length - 4) / 2);
      moveTo(row, col);
      write(c.green + frames[frame] + ' ' + c.white + message + c.reset + '  ');
      frame = (frame + 1) % frames.length;
      await sleep(80);
    }
  };
  
  const animPromise = animate();
  
  try {
    await task();
    running = false;
    await sleep(100);
    
    const col = Math.floor((cols - message.length - 4) / 2);
    moveTo(row, col);
    write(c.green + '✓ ' + c.bright + message + c.reset + '  ');
    return true;
  } catch (e) {
    running = false;
    await sleep(100);
    
    const col = Math.floor((cols - message.length - 4) / 2);
    moveTo(row, col);
    write(c.red + '✗ ' + c.white + message + c.reset + '  ');
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// Input Components
// ═══════════════════════════════════════════════════════════════

async function askChoice(question: string, options: Array<{ label: string; desc: string }>): Promise<number> {
  const row = 12;
  const col = Math.floor((cols - 50) / 2);
  let selected = 0;
  
  const draw = () => {
    moveTo(row, Math.floor((cols - question.length) / 2));
    write(c.white + question + c.reset);
    
    for (let i = 0; i < options.length; i++) {
      moveTo(row + 2 + (i * 2), col);
      if (i === selected) {
        write(c.green + c.bold + ' ▸ ' + c.greenBright + options[i].label + c.reset);
      } else {
        write(c.dim + '   ' + options[i].label + c.reset);
      }
      moveTo(row + 3 + (i * 2), col);
      write(c.dim + '     ' + options[i].desc + c.reset + safeRepeat(' ', 50));
    }
  };
  
  return new Promise((resolve) => {
    draw();
    
    const handler = (key: Buffer) => {
      const char = key.toString();
      
      if (char === '\x1b[A' || char === 'k') {
        selected = (selected - 1 + options.length) % options.length;
        draw();
      } else if (char === '\x1b[B' || char === 'j') {
        selected = (selected + 1) % options.length;
        draw();
      } else if (char === '\r' || char === '\n' || char === ' ') {
        process.stdin.removeListener('data', handler);
        process.stdin.setRawMode(false);
        resolve(selected);
      } else if (char === '\x03') {
        showCursor();
        process.exit(0);
      } else if (char >= '1' && char <= String(options.length)) {
        process.stdin.removeListener('data', handler);
        process.stdin.setRawMode(false);
        resolve(parseInt(char) - 1);
      }
    };
    
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', handler);
  });
}

async function askInput(label: string, placeholder = '', isSecret = false, defaultValue = ''): Promise<string> {
  const row = 13;
  const inputWidth = 50;
  const labelCol = Math.floor((cols - inputWidth) / 2);
  
  moveTo(row, labelCol);
  write(c.white + label + c.reset);
  
  moveTo(row + 2, labelCol);
  write(c.gray + '┌' + safeRepeat('─', inputWidth - 2) + '┐' + c.reset);
  moveTo(row + 3, labelCol);
  write(c.gray + '│' + c.reset + safeRepeat(' ', inputWidth - 2) + c.gray + '│' + c.reset);
  moveTo(row + 4, labelCol);
  write(c.gray + '└' + safeRepeat('─', inputWidth - 2) + '┘' + c.reset);
  
  if (placeholder && !defaultValue) {
    moveTo(row + 3, labelCol + 2);
    write(c.dim + placeholder + c.reset);
  }
  
  let value = defaultValue;
  const maxLen = inputWidth - 4;
  
  const redraw = () => {
    moveTo(row + 3, labelCol + 2);
    write(safeRepeat(' ', maxLen));
    moveTo(row + 3, labelCol + 2);
    if (isSecret && value.length > 0) {
      const shown = value.slice(0, 8);
      write(c.green + shown + c.dim + safeRepeat('•', Math.max(0, Math.min(value.length - 8, maxLen - 8))) + c.reset);
    } else {
      write(c.green + value.slice(-maxLen) + c.reset);
    }
    write(c.greenBright + '▌' + c.reset);
  };
  
  return new Promise((resolve) => {
    redraw();
    
    const handler = (key: Buffer) => {
      const char = key.toString();
      
      if (char === '\r' || char === '\n') {
        process.stdin.removeListener('data', handler);
        process.stdin.setRawMode(false);
        moveTo(row + 3, labelCol + 2 + Math.min(value.length, maxLen));
        write(' ');
        resolve(value);
      } else if (char === '\x7f' || char === '\b') {
        value = value.slice(0, -1);
        redraw();
      } else if (char === '\x03') {
        showCursor();
        process.exit(0);
      } else if (char >= ' ' && char <= '~') {
        value += char;
        redraw();
      }
    };
    
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', handler);
  });
}

async function askYesNo(question: string, defaultYes = true): Promise<boolean> {
  const row = 13;
  const hint = defaultYes ? '(Y/n)' : '(y/N)';
  const fullQ = question + ' ' + hint;
  const col = Math.floor((cols - fullQ.length) / 2);
  
  moveTo(row, col);
  write(c.white + question + ' ' + c.dim + hint + c.reset);
  
  return new Promise((resolve) => {
    const handler = (key: Buffer) => {
      const char = key.toString().toLowerCase();
      if (char === '\r' || char === '\n') {
        process.stdin.removeListener('data', handler);
        process.stdin.setRawMode(false);
        resolve(defaultYes);
      } else if (char === 'y') {
        process.stdin.removeListener('data', handler);
        process.stdin.setRawMode(false);
        resolve(true);
      } else if (char === 'n') {
        process.stdin.removeListener('data', handler);
        process.stdin.setRawMode(false);
        resolve(false);
      } else if (char === '\x03') {
        showCursor();
        process.exit(0);
      }
    };
    
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', handler);
  });
}

// ═══════════════════════════════════════════════════════════════
// Pre-flight Checks
// ═══════════════════════════════════════════════════════════════

interface PreflightResult {
  success: boolean;
  issues: Array<{ message: string; fix: string; fixCommand?: string; blocking: boolean }>;
}

function runPreflight(forRemote: boolean): PreflightResult {
  const issues: PreflightResult['issues'] = [];
  
  // Check Node version
  const nodeVersion = parseInt(process.version.slice(1).split('.')[0]);
  if (nodeVersion < 18) {
    issues.push({
      message: `Node.js ${process.version} is too old`,
      fix: 'Install Node.js 18 or later',
      fixCommand: 'brew install node@20',
      blocking: true,
    });
  }
  
  // Check if cloudflare-agent deps are installed
  const agentModules = join(process.cwd(), 'cloudflare-agent', 'node_modules');
  if (!existsSync(agentModules)) {
    issues.push({
      message: 'cloudflare-agent dependencies not installed',
      fix: 'Installing now...',
      fixCommand: 'cd cloudflare-agent && npm install',
      blocking: true,
    });
  }
  
  if (forRemote) {
    // Check cloudflared
    try {
      execSync('which cloudflared', { stdio: 'ignore' });
    } catch {
      issues.push({
        message: 'cloudflared not installed',
        fix: 'Install cloudflared for secure tunnel',
        fixCommand: 'brew install cloudflared',
        blocking: true,
      });
    }
    
    // Check wrangler auth
    try {
      const output = execSync('npx wrangler whoami 2>&1', { encoding: 'utf-8', timeout: 30000 });
      if (!output.includes('Account Name') && !output.includes('You are logged in')) {
        issues.push({
          message: 'Not logged in to Cloudflare',
          fix: 'Login to Cloudflare',
          fixCommand: 'npx wrangler login',
          blocking: true,
        });
      }
    } catch {
      issues.push({
        message: 'Not logged in to Cloudflare',
        fix: 'Login to Cloudflare',
        fixCommand: 'npx wrangler login',
        blocking: true,
      });
    }
  }
  
  return {
    success: issues.filter(i => i.blocking).length === 0,
    issues,
  };
}

async function fixIssues(issues: PreflightResult['issues']): Promise<boolean> {
  for (const issue of issues) {
    if (!issue.fixCommand) continue;
    
    await showMessage(16, `${c.dim}${issue.fix}${c.reset}`, c.dim);
    
    // Special handling for different fix types
    if (issue.fixCommand.includes('cd cloudflare-agent')) {
      // Install agent dependencies
      try {
        execSync('npm install', { 
          cwd: join(process.cwd(), 'cloudflare-agent'),
          stdio: 'ignore',
          timeout: 120000,
        });
      } catch {
        return false;
      }
    } else if (issue.fixCommand.includes('wrangler login')) {
      // Interactive login - spawn with inherited stdio
      try {
        const result = spawnSync('npx', ['wrangler', 'login'], { 
          stdio: 'inherit',
          timeout: 120000,
        });
        if (result.status !== 0) return false;
      } catch {
        return false;
      }
    } else if (issue.fixCommand.startsWith('brew ')) {
      // Can't auto-fix brew installs
      await showMessage(17, `${c.yellow}Run: ${issue.fixCommand}${c.reset}`, c.yellow);
      await sleep(3000);
      return false;
    }
  }
  
  return true;
}

// ═══════════════════════════════════════════════════════════════
// Cloudflare Deployment
// ═══════════════════════════════════════════════════════════════

interface CloudflareAccount {
  name: string;
  id: string;
}

function detectCloudflareAccounts(): CloudflareAccount[] {
  try {
    const output = execSync('npx wrangler whoami 2>&1', { 
      encoding: 'utf-8',
      timeout: 30000,
    });
    const accounts: CloudflareAccount[] = [];
    
    const lines = output.split('\n');
    for (const line of lines) {
      const match = line.match(/│\s*([^│]+?)\s*│\s*([a-f0-9]{32})\s*│/i);
      if (match && match[1] && match[2]) {
        const name = match[1].trim();
        const id = match[2].trim();
        if (name !== 'Account Name' && id !== 'Account ID') {
          accounts.push({ 
            name: name.length > 30 ? name.slice(0, 27) + '...' : name, 
            id 
          });
        }
      }
    }
    
    return accounts;
  } catch {
    return [];
  }
}

async function deployToCloudflare(config: Config, accountId: string): Promise<{ success: boolean; url?: string; error?: string }> {
  const agentDir = join(process.cwd(), 'cloudflare-agent');
  const env = accountId ? { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId } : process.env;
  
  try {
    // Step 1: Deploy the worker
    const deployResult = execSync('npx wrangler deploy 2>&1', {
      cwd: agentDir,
      encoding: 'utf-8',
      env,
      timeout: 120000,
    });
    
    // Extract deployed URL
    const urlMatch = deployResult.match(/https:\/\/[^\s]+\.workers\.dev/);
    const deployedUrl = urlMatch ? urlMatch[0] : '';
    
    if (!deployedUrl) {
      return { success: false, error: 'Could not find deployed URL in output' };
    }
    
    // Step 2: Set secrets
    const models = config.models || { fast: 'claude-3-5-haiku-20241022', smart: 'claude-sonnet-4-20250514' };
    const secrets = [
      { name: 'ANTHROPIC_API_KEY', value: config.anthropicKey },
      { name: 'BRIDGE_AUTH_TOKEN', value: config.authToken },
      { name: 'API_SECRET', value: config.authToken.slice(0, 32) },
      { name: 'BRIDGE_URL', value: 'http://localhost:3000' }, // Will be updated when tunnel starts
      { name: 'MODEL_FAST', value: models.fast },
      { name: 'MODEL_SMART', value: models.smart },
    ];
    
    for (const secret of secrets) {
      try {
        execSync(`echo "${secret.value}" | npx wrangler secret put ${secret.name} 2>&1`, {
          cwd: agentDir,
          env,
          timeout: 30000,
        });
      } catch (e) {
        // Non-fatal - secrets might already exist
      }
    }
    
    return { success: true, url: deployedUrl };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Unknown error';
    
    // Parse common errors
    if (error.includes('Could not resolve')) {
      return { 
        success: false, 
        error: 'Dependencies not installed. Run: cd cloudflare-agent && npm install' 
      };
    }
    
    if (error.includes('not logged in') || error.includes('authentication')) {
      return { 
        success: false, 
        error: 'Not logged in to Cloudflare. Run: npx wrangler login' 
      };
    }
    
    return { success: false, error };
  }
}

// ═══════════════════════════════════════════════════════════════
// Raycast Extension Scanner
// ═══════════════════════════════════════════════════════════════

function scanRaycastExtensions(): Extension[] {
  const raycastPath = join(homedir(), '.config', 'raycast', 'extensions');
  const extensions: Extension[] = [];
  
  if (!existsSync(raycastPath)) return extensions;
  
  try {
    const dirs = readdirSync(raycastPath);
    
    for (const dir of dirs) {
      const manifestPath = join(raycastPath, dir, 'package.json');
      if (!existsSync(manifestPath)) continue;
      
      try {
        const raw = readFileSync(manifestPath, 'utf-8');
        const manifest = JSON.parse(raw);
        
        if (!manifest.name || !manifest.commands || !Array.isArray(manifest.commands)) continue;
        
        const validCommands = manifest.commands
          .filter((cmd: any) => cmd && cmd.name && cmd.title)
          .filter((cmd: any) => !cmd.mode || cmd.mode === 'no-view' || cmd.mode === 'view')
          .map((cmd: any) => ({
            name: cmd.name,
            title: cmd.title,
            description: cmd.description || '',
            ...(cmd.arguments && Array.isArray(cmd.arguments) && cmd.arguments.length > 0 && {
              arguments: cmd.arguments.map((arg: any) => ({
                name: arg.name || 'input',
                type: arg.type || 'text',
                description: arg.placeholder || arg.description || '',
                required: arg.required ?? false,
              }))
            })
          }));
        
        if (validCommands.length === 0) continue;
        
        extensions.push({
          name: manifest.name,
          author: manifest.author || 'unknown',
          owner: manifest.owner || manifest.author || 'unknown',
          title: manifest.title || manifest.name,
          description: manifest.description || '',
          commands: validCommands,
        });
      } catch {}
    }
  } catch {}
  
  return extensions;
}

// ═══════════════════════════════════════════════════════════════
// Permissions
// ═══════════════════════════════════════════════════════════════

function getTerminalAppName(): string {
  const termProgram = process.env.TERM_PROGRAM || '';
  
  if (termProgram.includes('iTerm')) return 'iTerm';
  if (termProgram.includes('Apple_Terminal')) return 'Terminal';
  if (termProgram.includes('vscode') || termProgram.includes('Code')) return 'Visual Studio Code';
  if (termProgram.includes('cursor')) return 'Cursor';
  if (termProgram.includes('Warp')) return 'Warp';
  
  return 'Terminal';
}

function checkFullDiskAccess(): boolean {
  try {
    const dbPath = join(homedir(), 'Library', 'Messages', 'chat.db');
    execSync(`sqlite3 "${dbPath}" "SELECT 1 LIMIT 1" 2>/dev/null`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function checkAccessibility(): boolean {
  try {
    execSync(`osascript -e 'tell application "System Events" to return name of first process' 2>/dev/null`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function showPermissionsStep(): Promise<void> {
  const hasFDA = checkFullDiskAccess();
  const hasAccessibility = checkAccessibility();
  const terminalApp = getTerminalAppName();
  
  if (hasFDA && hasAccessibility) {
    await showMessage(14, `${c.green}✓${c.reset} Permissions already configured`, c.white);
    await sleep(1000);
    return;
  }
  
  await showMessage(12, `SYSTEM needs macOS permissions to control your Mac.`, c.white);
  await showMessage(13, `You'll add "${c.green}${terminalApp}${c.reset}" to each setting.`, c.dim);
  
  const statusY = 15;
  
  // Full Disk Access
  moveTo(statusY, Math.floor((cols - 40) / 2));
  if (hasFDA) {
    write(`${c.green}✓${c.reset} Full Disk Access ${c.dim}(iMessages)${c.reset}`);
  } else {
    write(`${c.yellow}○${c.reset} Full Disk Access ${c.dim}(iMessages)${c.reset}`);
  }
  
  // Accessibility
  moveTo(statusY + 1, Math.floor((cols - 40) / 2));
  if (hasAccessibility) {
    write(`${c.green}✓${c.reset} Accessibility ${c.dim}(keyboard/mouse)${c.reset}`);
  } else {
    write(`${c.yellow}○${c.reset} Accessibility ${c.dim}(keyboard/mouse)${c.reset}`);
  }
  
  moveTo(statusY + 3, Math.floor((cols - 50) / 2));
  write(`${c.dim}Press Enter to open System Settings, or S to skip${c.reset}`);
  
  const shouldOpen = await new Promise<boolean>((resolve) => {
    const handler = (key: Buffer) => {
      const char = key.toString().toLowerCase();
      if (char === '\r' || char === '\n') {
        process.stdin.removeListener('data', handler);
        process.stdin.setRawMode(false);
        resolve(true);
      } else if (char === 's') {
        process.stdin.removeListener('data', handler);
        process.stdin.setRawMode(false);
        resolve(false);
      } else if (char === '\x03') {
        showCursor();
        process.exit(0);
      }
    };
    
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', handler);
  });
  
  if (shouldOpen) {
    if (!hasFDA) {
      execSync('open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"', { stdio: 'ignore' });
      await sleep(500);
    }
    if (!hasAccessibility) {
      execSync('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"', { stdio: 'ignore' });
    }
    
    await clearContent();
    await drawStep(2, 4, 'Permissions');
    await showMessage(14, `${c.dim}Grant permissions in System Settings, then press Enter${c.reset}`, c.dim);
    
    await new Promise<void>((resolve) => {
      const handler = (key: Buffer) => {
        const char = key.toString();
        if (char === '\r' || char === '\n') {
          process.stdin.removeListener('data', handler);
          process.stdin.setRawMode(false);
          resolve();
        } else if (char === '\x03') {
          showCursor();
          process.exit(0);
        }
      };
      
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', handler);
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// Main Setup Flow
// ═══════════════════════════════════════════════════════════════

async function main() {
  hideCursor();
  clearScreen();
  
  await drawLogo();
  await showMessage(7, 'control your mac from anywhere', c.dim);
  await sleep(500);
  
  // Load existing config if any
  const configPath = join(process.cwd(), 'bridge.config.json');
  let existingConfig: Partial<Config> = {};
  
  if (existsSync(configPath)) {
    try {
      existingConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {}
  }
  
  const config: Config = {
    authToken: existingConfig.authToken || randomBytes(32).toString('hex'),
    anthropicKey: existingConfig.anthropicKey || '',
    mode: existingConfig.mode || 'local',
    extensions: existingConfig.extensions || [],
    models: existingConfig.models || {
      fast: 'claude-3-5-haiku-20241022',
      smart: 'claude-sonnet-4-20250514',
    },
  };
  
  // ─── Step 1: Choose Mode ───
  await clearContent();
  await drawStep(1, 4, 'Setup Mode');
  
  const modeChoice = await askChoice('How do you want to use SYSTEM?', [
    { label: 'Remote', desc: 'Access from anywhere via Cloudflare (recommended)' },
    { label: 'Local', desc: 'Access from this computer only' },
  ]);
  
  config.mode = modeChoice === 0 ? 'remote' : 'local';
  
  // ─── Pre-flight Checks ───
  await clearContent();
  await drawStep(1, 4, 'Setup Mode');
  
  const preflight = runPreflight(config.mode === 'remote');
  
  if (!preflight.success) {
    // Show issues and attempt to fix
    const issueCount = preflight.issues.filter(i => i.blocking).length;
    await showMessage(14, `${c.yellow}Found ${issueCount} issue(s) to fix${c.reset}`, c.yellow);
    await sleep(500);
    
    const fixed = await fixIssues(preflight.issues);
    
    if (!fixed) {
      await clearContent();
      await drawStep(1, 4, 'Setup Mode');
      
      for (let i = 0; i < Math.min(preflight.issues.length, 5); i++) {
        const issue = preflight.issues[i];
        await showMessage(14 + i, `${c.red}✗${c.reset} ${issue.message}`, c.white);
        if (issue.fixCommand) {
          await showMessage(15 + i, `  ${c.dim}Fix: ${c.cyan}${issue.fixCommand}${c.reset}`, c.dim);
        }
      }
      
      await showMessage(20, `${c.dim}Fix the issues above and run setup again${c.reset}`, c.dim);
      showCursor();
      process.exit(1);
    }
    
    await clearContent();
    await drawStep(1, 4, 'Setup Mode');
    await showMessage(14, `${c.green}✓${c.reset} Issues fixed`, c.white);
    await sleep(500);
  }
  
  await clearContent();
  await drawStep(1, 4, 'Setup Mode');
  await showMessage(14, `${c.green}✓${c.reset} ${config.mode === 'remote' ? 'Remote' : 'Local'} mode selected`, c.white);
  await sleep(800);
  
  // ─── Step 2: Permissions ───
  await clearContent();
  await drawStep(2, 4, 'Permissions');
  
  await showPermissionsStep();
  
  await clearContent();
  await drawStep(2, 4, 'Permissions');
  await showMessage(14, `${c.green}✓${c.reset} Permissions configured`, c.white);
  await sleep(800);
  
  // ─── Step 3: API Key ───
  await clearContent();
  await drawStep(3, 4, 'Anthropic API Key');
  
  if (config.anthropicKey) {
    const keepKey = await askYesNo('Keep existing API key?', true);
    if (!keepKey) {
      await clearContent();
      await drawStep(3, 4, 'Anthropic API Key');
      config.anthropicKey = await askInput('Anthropic API Key', 'sk-ant-...', true);
    }
  } else {
    config.anthropicKey = await askInput('Anthropic API Key', 'sk-ant-...', true);
  }
  
  // Validate key format
  if (!config.anthropicKey.startsWith('sk-ant-')) {
    await clearContent();
    await drawStep(3, 4, 'Anthropic API Key');
    await showMessage(14, `${c.yellow}Warning: Key doesn't start with sk-ant-${c.reset}`, c.yellow);
    await sleep(1000);
    await clearContent();
    await drawStep(3, 4, 'Anthropic API Key');
    config.anthropicKey = await askInput('Anthropic API Key', 'sk-ant-...', true);
  }
  
  await clearContent();
  await drawStep(3, 4, 'Anthropic API Key');
  await showMessage(14, `${c.green}✓${c.reset} API key configured`, c.white);
  await sleep(800);
  
  // ─── Step 4: Deploy / Finalize ───
  await clearContent();
  await drawStep(4, 4, config.mode === 'remote' ? 'Deploy' : 'Finalize');
  
  if (config.mode === 'remote') {
    // Deploy to Cloudflare
    await showMessage(12, 'Deploying to Cloudflare Workers...', c.white);
    
    // Detect accounts
    const accounts = detectCloudflareAccounts();
    let accountId = '';
    
    if (accounts.length === 1) {
      accountId = accounts[0].id;
      await showMessage(13, `${c.dim}Using account: ${accounts[0].name}${c.reset}`, c.dim);
    } else if (accounts.length > 1) {
      await clearContent();
      await drawStep(4, 4, 'Deploy');
      
      const accountChoices = accounts.map(a => ({ 
        label: a.name, 
        desc: `${a.id.slice(0, 8)}...` 
      }));
      const choice = await askChoice('Select Cloudflare account:', accountChoices);
      accountId = accounts[choice].id;
      
      await clearContent();
      await drawStep(4, 4, 'Deploy');
    }
    
    config.cloudflareAccountId = accountId;
    
    // Save config before deploy (in case deploy fails)
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    
    // Deploy
    let deployResult: { success: boolean; url?: string; error?: string } = { success: false };
    
    const deploySuccess = await showProgress('Deploying worker...', async () => {
      deployResult = await deployToCloudflare(config, accountId);
      if (!deployResult.success) {
        throw new Error(deployResult.error);
      }
    });
    
    if (!deploySuccess) {
      await clearContent();
      await drawStep(4, 4, 'Deploy');
      
      await showMessage(14, `${c.red}Deploy failed${c.reset}`, c.red);
      await showMessage(16, `${c.dim}${deployResult.error || 'Unknown error'}${c.reset}`, c.dim);
      
      // Offer to continue in local mode
      await showMessage(18, `${c.white}Continue in local mode instead?${c.reset}`, c.white);
      const continueLocal = await askYesNo('', true);
      
      if (continueLocal) {
        config.mode = 'local';
        config.deployed = false;
      } else {
        showCursor();
        process.exit(1);
      }
    } else {
      config.deployed = true;
      config.deployedUrl = deployResult.url;
      
      await showMessage(15, `${c.green}✓${c.reset} Deployed to ${c.cyan}${deployResult.url}${c.reset}`, c.white);
      await sleep(500);
    }
  }
  
  // Save final config
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  
  // Scan for Raycast extensions (quick, non-blocking)
  const extensions = scanRaycastExtensions();
  if (extensions.length > 0) {
    config.extensions = extensions;
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }
  
  // ─── Final Summary ───
  await clearContent();
  await drawLogo();
  
  await showMessage(8, `${c.green}${c.bold}Setup complete!${c.reset}`, c.green);
  
  if (config.mode === 'remote' && config.deployed) {
    await showMessage(11, `${c.white}SYSTEM is deployed at:${c.reset}`, c.white);
    await showMessage(12, `${c.cyan}${c.bold}${config.deployedUrl}${c.reset}`, c.cyan);
    
    await showMessage(14, `${c.white}API Secret:${c.reset}`, c.white);
    await showMessage(15, `${c.green}${config.authToken.slice(0, 32)}${c.reset}`, c.green);
    
    await showMessage(17, `${c.dim}Run ${c.cyan}npm start${c.dim} to start the bridge and tunnel${c.reset}`, c.dim);
  } else {
    await showMessage(11, `${c.dim}Run ${c.cyan}npm start${c.dim} to launch SYSTEM${c.reset}`, c.dim);
    await showMessage(13, `${c.white}Local URL: ${c.cyan}http://localhost:8787${c.reset}`, c.white);
    await showMessage(14, `${c.white}API Secret: ${c.green}${config.authToken.slice(0, 32)}${c.reset}`, c.white);
  }
  
  if (extensions.length > 0) {
    await showMessage(19, `${c.dim}${extensions.length} Raycast extensions detected${c.reset}`, c.dim);
  }
  
  await showMessage(21, `${c.dim}Press any key to exit${c.reset}`, c.dim);
  
  await new Promise<void>((resolve) => {
    const handler = () => {
      process.stdin.removeListener('data', handler);
      process.stdin.setRawMode(false);
      resolve();
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', handler);
  });
  
  showCursor();
  clearScreen();
  
  console.log(`${c.green}SYSTEM${c.reset} setup complete!\n`);
  
  if (config.mode === 'remote' && config.deployed) {
    console.log(`  ${c.white}URL:${c.reset}    ${c.cyan}${config.deployedUrl}${c.reset}`);
    console.log(`  ${c.white}Secret:${c.reset} ${c.green}${config.authToken.slice(0, 32)}${c.reset}`);
    console.log(`\nRun ${c.cyan}npm start${c.reset} to start the bridge.\n`);
  } else {
    console.log(`Run ${c.cyan}npm start${c.reset} to launch SYSTEM.\n`);
  }
}

main().catch(e => {
  showCursor();
  console.error(`\n${c.red}Setup failed: ${e.message}${c.reset}\n`);
  process.exit(1);
});
