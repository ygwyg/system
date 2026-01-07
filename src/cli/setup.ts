#!/usr/bin/env node

/**
 * SYSTEM Setup
 * 
 * The most beautiful CLI setup experience.
 */

import * as readline from 'readline';
import { writeFileSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { execSync, spawn, ChildProcess } from 'child_process';
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
  mode: 'ui' | 'api';
  access: 'local' | 'remote';
  extensions: Extension[];
  deployed?: boolean;
  deployedUrl?: string;
  cloudflareAccountId?: string;
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
  up: (n: number) => `\x1b[${n}A`,
  down: (n: number) => `\x1b[${n}B`,
  right: (n: number) => `\x1b[${n}C`,
  left: (n: number) => `\x1b[${n}D`,
  move: (row: number, col: number) => `\x1b[${row};${col}H`,
  clearLine: '\x1b[2K',
  saveCursor: '\x1b7',
  restoreCursor: '\x1b8',
};

// Colors - monochrome with green accent (matching UI)
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
  bg: '\x1b[48;2;10;10;10m',
  bgSubtle: '\x1b[48;2;20;20;20m',
};

const moveTo = (row: number, col: number) => write(esc.move(Math.max(1, row), Math.max(1, col)));
const clearScreen = () => write(esc.clear + esc.home);
const hideCursor = () => write(esc.hide);
const showCursor = () => write(esc.show);
const centerCol = (textLen: number) => Math.max(1, Math.floor((cols - textLen) / 2));
const safeRepeat = (str: string, count: number) => str.repeat(Math.max(0, count));

// ═══════════════════════════════════════════════════════════════
// Beautiful UI Components
// ═══════════════════════════════════════════════════════════════

const LOGO = [
  '┌────────────────────────────┐',
  '│ █▀▀ █▄█ █▀▀ ▀█▀ █▀▀ █▀▄▀█ │',
  '│ ▀▀█  █  ▀▀█  █  ██▄ █ ▀ █ │',
  '└────────────────────────────┘',
];

const LOGO_WIDTH = LOGO[0].length;

async function drawLogo(highlight = false): Promise<void> {
  const startCol = Math.floor((cols - LOGO_WIDTH) / 2);
  const color = highlight ? c.greenBright : c.green;
  
  for (let i = 0; i < LOGO.length; i++) {
    moveTo(2 + i, startCol);
    write(color + LOGO[i] + c.reset);
  }
}

async function animateLogo(): Promise<void> {
  const startCol = Math.floor((cols - LOGO_WIDTH) / 2);
  const chars = '░▒▓█';
  
  // Build up animation
  for (let frame = 0; frame < 15; frame++) {
    for (let i = 0; i < LOGO.length; i++) {
      moveTo(2 + i, startCol);
      let line = '';
      for (let j = 0; j < LOGO[i].length; j++) {
        if (LOGO[i][j] !== ' ' && LOGO[i][j] !== '╗' && LOGO[i][j] !== '╝' && LOGO[i][j] !== '╚' && LOGO[i][j] !== '╔') {
          const progress = (frame / 15) * LOGO[i].length;
          if (j < progress) {
            line += c.green + LOGO[i][j];
          } else if (j < progress + 5) {
            line += c.dim + c.green + chars[Math.floor(Math.random() * chars.length)];
          } else {
            line += ' ';
          }
        } else {
          if (frame > 10) {
            line += c.green + LOGO[i][j];
          } else {
            line += ' ';
          }
        }
      }
      write(line + c.reset);
    }
    await sleep(40);
  }
  
  // Final clean draw
  await drawLogo(true);
  await sleep(200);
  await drawLogo(false);
}

function drawBox(row: number, col: number, width: number, height: number, title?: string): void {
  const top = '┌' + safeRepeat('─', width - 2) + '┐';
  const mid = '│' + safeRepeat(' ', width - 2) + '│';
  const bot = '└' + safeRepeat('─', width - 2) + '┘';
  
  moveTo(row, col);
  write(c.gray + top);
  
  for (let i = 1; i < height - 1; i++) {
    moveTo(row + i, col);
    write(mid);
  }
  
  moveTo(row + height - 1, col);
  write(bot + c.reset);
  
  if (title) {
    moveTo(row, col + 2);
    write(c.gray + '┤ ' + c.white + title + c.gray + ' ├' + c.reset);
  }
}

async function drawStep(num: number, total: number, title: string, active = false): Promise<void> {
  const y = 9;
  
  // Calculate total width of step indicators (● ○ etc with spaces)
  const indicatorWidth = total * 2; // Each indicator is 1 char + 1 space
  const indicatorX = Math.floor((cols - indicatorWidth) / 2);
  
  // Step indicator - CENTERED
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
  
  // Title - CENTERED
  moveTo(y + 2, Math.floor((cols - title.length) / 2));
  write((active ? c.bright + c.bold : c.white) + title + c.reset);
}

async function typeText(row: number, text: string, color = c.white, speed = 20): Promise<void> {
  const col = Math.floor((cols - text.length) / 2);
  moveTo(row, col);
  
  for (let i = 0; i < text.length; i++) {
    write(color + text[i] + c.reset);
    if (text[i] !== ' ') await sleep(speed);
  }
}

async function showSuccess(message: string): Promise<void> {
  const row = 14;
  const col = Math.floor((cols - message.length - 4) / 2);
  
  moveTo(row, col);
  write(c.green + '✓ ' + c.bright + message + c.reset);
  await sleep(500);
}

async function showError(message: string): Promise<void> {
  const row = 14;
  const col = Math.floor((cols - message.length - 4) / 2);
  
  moveTo(row, col);
  write(c.red + '✗ ' + c.white + message + c.reset);
  await sleep(1000);
}

async function clearContent(): Promise<void> {
  for (let i = 9; i < rows - 2; i++) {
    moveTo(i, 1);
    write(esc.clearLine);
  }
}

// ═══════════════════════════════════════════════════════════════
// Input Components
// ═══════════════════════════════════════════════════════════════

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

async function askInput(label: string, placeholder = '', isSecret = false): Promise<string> {
  const row = 13;
  const inputWidth = 40;
  const labelCol = Math.floor((cols - inputWidth) / 2);
  
  moveTo(row, labelCol);
  write(c.white + label + c.reset);
  
  moveTo(row + 2, labelCol);
  write(c.gray + '┌' + safeRepeat('─', inputWidth - 2) + '┐' + c.reset);
  moveTo(row + 3, labelCol);
  write(c.gray + '│' + c.reset + safeRepeat(' ', inputWidth - 2) + c.gray + '│' + c.reset);
  moveTo(row + 4, labelCol);
  write(c.gray + '└' + safeRepeat('─', inputWidth - 2) + '┘' + c.reset);
  
  if (placeholder) {
    moveTo(row + 3, labelCol + 2);
    write(c.dim + placeholder + c.reset);
  }
  
  let value = '';
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
        // Clear cursor
        moveTo(row + 3, labelCol + 2 + Math.min(value.length, maxLen));
        write(' ');
        resolve(value);
      } else if (char === '\x7f' || char === '\b') {
        // Backspace
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

async function askChoice(question: string, options: string[]): Promise<number> {
  const row = 13;
  const col = Math.floor((cols - 40) / 2);
  let selected = 0;
  
  const draw = () => {
    moveTo(row, Math.floor((cols - question.length) / 2));
    write(c.white + question + c.reset);
    
    for (let i = 0; i < options.length; i++) {
      moveTo(row + 2 + i, col);
      if (i === selected) {
        write(c.green + c.bold + ' ▸ ' + c.greenBright + options[i] + c.reset);
      } else {
        write(c.dim + '   ' + options[i] + c.reset);
      }
      write(safeRepeat(' ', 40 - options[i].length - 3));
    }
  };
  
  return new Promise((resolve) => {
    draw();
    
    const handler = (key: Buffer) => {
      const char = key.toString();
      
      if (char === '\x1b[A' || char === 'k') { // Up
        selected = (selected - 1 + options.length) % options.length;
        draw();
      } else if (char === '\x1b[B' || char === 'j') { // Down
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

// ═══════════════════════════════════════════════════════════════
// Raycast Extension Scanner
// ═══════════════════════════════════════════════════════════════

interface RaycastManifest {
  name: string;
  title: string;
  description?: string;
  author?: string;
  owner?: string;
  commands?: Array<{
    name: string;
    title: string;
    description?: string;
    mode?: string;
    arguments?: Array<{
      name: string;
      type: string;
      placeholder?: string;
      required?: boolean;
    }>;
  }>;
}

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
        
        // Skip if no name or commands
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
      } catch (e) {
        // Skip extensions we can't parse
      }
    }
  } catch (e) {
    // Return empty if we can't read the directory
  }
  
  return extensions;
}

async function selectExtensions(extensions: Extension[]): Promise<Extension[]> {
  if (extensions.length === 0) return [];
  
  const selected = new Set<number>();
  let cursor = 0;
  let scroll = 0;
  let searchQuery = '';
  let filteredIndices: number[] = extensions.map((_, i) => i);
  const maxVisible = Math.min(10, rows - 18);
  
  const updateFilter = () => {
    if (searchQuery === '') {
      filteredIndices = extensions.map((_, i) => i);
    } else {
      const q = searchQuery.toLowerCase();
      filteredIndices = extensions
        .map((ext, i) => ({ ext, i }))
        .filter(({ ext }) => 
          ext.title.toLowerCase().includes(q) || 
          ext.name.toLowerCase().includes(q) ||
          ext.description.toLowerCase().includes(q)
        )
        .map(({ i }) => i);
    }
    cursor = 0;
    scroll = 0;
  };
  
  const draw = () => {
    const col = Math.floor((cols - 55) / 2);
    
    // Search box
    moveTo(12, col);
    write(c.gray + '┌─ search ' + safeRepeat('─', 44) + '┐' + c.reset);
    moveTo(13, col);
    write(c.gray + '│ ' + c.reset);
    write(c.green + (searchQuery || c.dim + 'type to filter...') + c.reset);
    write(safeRepeat(' ', 50 - searchQuery.length));
    write(c.green + '_' + c.reset); // Cursor
    write(c.gray + ' │' + c.reset);
    moveTo(14, col);
    write(c.gray + '└' + safeRepeat('─', 53) + '┘' + c.reset);
    
    // Help text
    moveTo(15, col);
    write(c.dim + '↑↓ navigate • space select • a=all • enter done' + c.reset);
    
    // List
    for (let i = 0; i < maxVisible; i++) {
      const filteredIdx = scroll + i;
      moveTo(17 + i, col);
      
      if (filteredIdx >= filteredIndices.length) {
        write(safeRepeat(' ', 55));
        continue;
      }
      
      const extIdx = filteredIndices[filteredIdx];
      const ext = extensions[extIdx];
      const isSelected = selected.has(extIdx);
      const isCursor = filteredIdx === cursor;
      
      const checkbox = isSelected ? c.green + '◉' : c.gray + '○';
      const name = ext.title.slice(0, 38);
      const count = `(${ext.commands.length})`;
      
      if (isCursor) {
        write(c.bgSubtle + checkbox + ' ' + c.bright + c.bold + name + c.reset + c.bgSubtle + c.dim + ' ' + count + c.reset);
      } else {
        write(checkbox + ' ' + c.white + name + c.reset + c.dim + ' ' + count + c.reset);
      }
      write(safeRepeat(' ', 55 - name.length - count.length - 3));
    }
    
    // Scroll indicators
    if (scroll > 0) {
      moveTo(16, col + 27);
      write(c.green + '▲' + c.reset);
    } else {
      moveTo(16, col + 27);
      write(' ');
    }
    if (scroll + maxVisible < filteredIndices.length) {
      moveTo(17 + maxVisible, col + 27);
      write(c.green + '▼' + c.reset);
    } else {
      moveTo(17 + maxVisible, col + 27);
      write(' ');
    }
    
    // Status
    moveTo(17 + maxVisible + 1, col);
    write(c.green + c.bold + selected.size + c.reset + c.white + ' selected' + c.reset);
    write(c.dim + ' · ' + filteredIndices.length + ' shown' + c.reset + '          ');
  };
  
  return new Promise((resolve) => {
    draw();
    
    const handler = (key: Buffer) => {
      const char = key.toString();
      
      if (char === '\x1b[A') { // Up
        if (cursor > 0) {
          cursor--;
          if (cursor < scroll) scroll = cursor;
        }
        draw();
      } else if (char === '\x1b[B') { // Down
        if (cursor < filteredIndices.length - 1) {
          cursor++;
          if (cursor >= scroll + maxVisible) scroll = cursor - maxVisible + 1;
        }
        draw();
      } else if (char === ' ') { // Toggle
        if (filteredIndices.length > 0) {
          const extIdx = filteredIndices[cursor];
          if (selected.has(extIdx)) {
            selected.delete(extIdx);
          } else {
            selected.add(extIdx);
          }
        }
        draw();
      } else if (char === 'a' && searchQuery === '') { // Select all (only when not searching)
        for (const idx of filteredIndices) selected.add(idx);
        draw();
      } else if (char === '\r' || char === '\n') {
        process.stdin.removeListener('data', handler);
        process.stdin.setRawMode(false);
        resolve(Array.from(selected).map(i => extensions[i]));
      } else if (char === '\x03') {
        showCursor();
        process.exit(0);
      } else if (char === '\x7f' || char === '\b') { // Backspace
        searchQuery = searchQuery.slice(0, -1);
        updateFilter();
        draw();
      } else if (char === '\x1b') { // Escape - clear search
        searchQuery = '';
        updateFilter();
        draw();
      } else if (char >= ' ' && char <= '~' && char.length === 1) { // Printable chars
        searchQuery += char;
        updateFilter();
        draw();
      }
    };
    
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', handler);
  });
}

// ═══════════════════════════════════════════════════════════════
// Cloudflare Account Detection
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
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const accounts: CloudflareAccount[] = [];
    
    // Parse the table output from wrangler whoami
    // Format: │ Account Name │ Account ID │
    const lines = output.split('\n');
    for (const line of lines) {
      // Match lines that look like: │ Name │ ID │
      const match = line.match(/│\s*([^│]+?)\s*│\s*([a-f0-9]{32})\s*│/i);
      if (match && match[1] && match[2]) {
        const name = match[1].trim();
        const id = match[2].trim();
        // Skip header row
        if (name !== 'Account Name' && id !== 'Account ID') {
          // Truncate long names to prevent display issues
          accounts.push({ 
            name: name.length > 30 ? name.slice(0, 27) + '...' : name, 
            id 
          });
        }
      }
    }
    
    return accounts;
  } catch (e) {
    // Return empty array on any error
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// System Functions
// ═══════════════════════════════════════════════════════════════

function checkCommand(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isRaycastInstalled(): boolean {
  // Check if Raycast app exists
  const appPaths = [
    '/Applications/Raycast.app',
    join(homedir(), 'Applications', 'Raycast.app'),
  ];
  
  for (const appPath of appPaths) {
    if (existsSync(appPath)) return true;
  }
  
  // Also check if extensions directory exists (means Raycast has been used)
  const extensionsPath = join(homedir(), '.config', 'raycast', 'extensions');
  return existsSync(extensionsPath);
}

async function startQuickTunnel(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    
    let output = '';
    const timeout = setTimeout(() => {
      reject(new Error('Tunnel timeout'));
    }, 30000);
    
    proc.stderr.on('data', (data) => {
      output += data.toString();
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    });
    
    proc.on('error', () => reject(new Error('Failed to start tunnel')));
  });
}

// ═══════════════════════════════════════════════════════════════
// Progress Animation
// ═══════════════════════════════════════════════════════════════

async function showProgress(message: string, task: () => Promise<void>): Promise<void> {
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
  } catch (e) {
    running = false;
    await sleep(100);
    
    const col = Math.floor((cols - message.length - 4) / 2);
    moveTo(row, col);
    write(c.red + '✗ ' + c.white + message + c.reset + '  ');
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════
// Permissions Management
// ═══════════════════════════════════════════════════════════════

interface PermissionCheck {
  name: string;
  urlScheme: string;
  test: () => boolean;
  reason: string;
}

function getTerminalAppName(): string {
  // Detect what terminal/app is running the script
  const termProgram = process.env.TERM_PROGRAM || '';
  
  if (termProgram.includes('iTerm')) return 'iTerm';
  if (termProgram.includes('Apple_Terminal')) return 'Terminal';
  if (termProgram.includes('vscode') || termProgram.includes('Code')) return 'Visual Studio Code';
  if (termProgram.includes('cursor')) return 'Cursor';
  if (termProgram.includes('Warp')) return 'Warp';
  
  // Check via process tree
  try {
    let pid = process.ppid;
    for (let i = 0; i < 5; i++) { // Walk up to 5 levels
      const comm = execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf-8' }).trim();
      const name = comm.split('/').pop() || '';
      
      if (name.includes('Terminal')) return 'Terminal';
      if (name.includes('iTerm')) return 'iTerm';
      if (name.includes('Code')) return 'Visual Studio Code';
      if (name.includes('cursor')) return 'Cursor';
      if (name.includes('opencode')) return 'OpenCode';
      if (name.includes('Warp')) return 'Warp';
      if (name.includes('Hyper')) return 'Hyper';
      if (name.includes('Alacritty')) return 'Alacritty';
      if (name.includes('kitty')) return 'kitty';
      
      // Get parent's parent
      const ppid = execSync(`ps -p ${pid} -o ppid=`, { encoding: 'utf-8' }).trim();
      if (!ppid || ppid === '1' || ppid === '0') break;
      pid = parseInt(ppid);
    }
  } catch {}
  
  return 'Terminal';
}

function getTerminalAppPath(): string {
  const name = getTerminalAppName();
  const paths: Record<string, string> = {
    'Terminal': '/System/Applications/Utilities/Terminal.app',
    'iTerm': '/Applications/iTerm.app',
    'Visual Studio Code': '/Applications/Visual Studio Code.app',
    'Cursor': '/Applications/Cursor.app',
    'OpenCode': '/Applications/OpenCode.app',
    'Warp': '/Applications/Warp.app',
    'Hyper': '/Applications/Hyper.app',
    'Alacritty': '/Applications/Alacritty.app',
    'kitty': '/Applications/kitty.app',
  };
  return paths[name] || paths['Terminal'];
}

function checkFullDiskAccess(): boolean {
  // Try to read the Messages database - this requires Full Disk Access
  try {
    const dbPath = join(homedir(), 'Library', 'Messages', 'chat.db');
    execSync(`sqlite3 "${dbPath}" "SELECT 1 LIMIT 1" 2>/dev/null`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function checkAccessibility(): boolean {
  // Try an accessibility action - if it works, we have permission
  try {
    execSync(`osascript -e 'tell application "System Events" to return name of first process' 2>/dev/null`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function checkContacts(): boolean {
  try {
    execSync(`osascript -e 'tell application "Contacts" to return count of people' 2>/dev/null`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function requestPermission(
  name: string,
  urlScheme: string, 
  testFn: () => boolean,
  reason: string
): Promise<boolean> {
  const terminalApp = getTerminalAppName();
  const boxWidth = 56;
  const boxX = Math.floor((cols - boxWidth) / 2);
  
  // Check if already granted
  if (testFn()) {
    return true;
  }
  
  // Show permission request
  moveTo(10, Math.floor((cols - 30) / 2));
  write(c.yellow + '⚠ ' + c.white + c.bold + name + ' Required' + c.reset);
  
  moveTo(12, boxX);
  write(c.dim + reason + c.reset);
  
  moveTo(14, boxX);
  write(c.white + 'Add ' + c.green + c.bold + terminalApp + c.reset + c.white + ' to ' + name + c.reset);
  
  // Open System Settings
  moveTo(16, boxX);
  write(c.dim + 'Opening System Settings...' + c.reset);
  
  try {
    execSync(`open "${urlScheme}"`, { stdio: 'ignore' });
  } catch {}
  
  await sleep(500);
  
  moveTo(16, boxX);
  write(c.white + '1. Click the ' + c.green + '+' + c.white + ' button' + c.reset + '                    ');
  moveTo(17, boxX);
  write(c.white + '2. Select ' + c.green + terminalApp + c.reset + '                    ');
  moveTo(18, boxX);
  write(c.white + '3. Enable the toggle' + c.reset);
  
  moveTo(20, boxX);
  write(c.dim + 'Waiting for permission...' + c.reset);
  
  // Poll for permission (check every 2 seconds, timeout after 60s)
  const startTime = Date.now();
  const timeout = 60000;
  let dots = 0;
  
  while (Date.now() - startTime < timeout) {
    if (testFn()) {
      moveTo(20, boxX);
      write(c.green + '✓ ' + c.bright + name + ' granted!' + c.reset + '                    ');
      await sleep(1000);
      return true;
    }
    
    // Update waiting animation
    dots = (dots + 1) % 4;
    moveTo(20, boxX);
    write(c.dim + 'Waiting for permission' + '.'.repeat(dots) + ' '.repeat(3 - dots) + c.reset);
    
    await sleep(2000);
  }
  
  // Timeout - ask to skip or retry
  moveTo(20, boxX);
  write(c.yellow + '⚠ Permission not detected' + c.reset + '                    ');
  
  moveTo(22, boxX);
  const shouldRetry = await askYesNo('Retry?', true);
  
  if (shouldRetry) {
    await clearContent();
    return requestPermission(name, urlScheme, testFn, reason);
  }
  
  return false;
}

async function showPermissionsGuide(): Promise<void> {
  const terminalApp = getTerminalAppName();
  
  // Check and request permissions in order of importance
  const permissions: Array<{
    name: string;
    urlScheme: string;
    test: () => boolean;
    reason: string;
    critical: boolean;
  }> = [
    {
      name: 'Full Disk Access',
      urlScheme: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
      test: checkFullDiskAccess,
      reason: 'Required to read iMessages and access files',
      critical: true,
    },
    {
      name: 'Accessibility',
      urlScheme: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      test: checkAccessibility,
      reason: 'Required for keyboard/mouse control and Raycast',
      critical: true,
    },
    {
      name: 'Contacts',
      urlScheme: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts',
      test: checkContacts,
      reason: 'Allows looking up contacts by name',
      critical: false,
    },
  ];
  
  // Quick check - if critical permissions are already granted, skip
  const missingCritical = permissions.filter(p => p.critical && !p.test());
  
  if (missingCritical.length === 0) {
    // All critical permissions granted
    moveTo(12, Math.floor((cols - 30) / 2));
    write(c.green + '✓ ' + c.bright + 'Permissions configured' + c.reset);
    await sleep(800);
    return;
  }
  
  // Show intro
  moveTo(10, Math.floor((cols - 40) / 2));
  write(c.white + c.bold + 'macOS Permissions Setup' + c.reset);
  
  moveTo(12, Math.floor((cols - 50) / 2));
  write(c.dim + `SYSTEM needs permissions to control your Mac.` + c.reset);
  
  moveTo(13, Math.floor((cols - 45) / 2));
  write(c.dim + `You'll add "${c.green}${terminalApp}${c.dim}" to each setting.` + c.reset);
  
  moveTo(15, Math.floor((cols - 25) / 2));
  write(c.dim + 'Press any key to start...' + c.reset);
  
  await new Promise<void>((resolve) => {
    const handler = (key: Buffer) => {
      if (key.toString() === '\x03') { showCursor(); process.exit(0); }
      process.stdin.removeListener('data', handler);
      process.stdin.setRawMode(false);
      resolve();
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', handler);
  });
  
  // Request each permission
  for (const perm of permissions) {
    await clearContent();
    await drawLogo();
    
    const granted = await requestPermission(perm.name, perm.urlScheme, perm.test, perm.reason);
    
    if (!granted && perm.critical) {
      await clearContent();
      moveTo(12, Math.floor((cols - 45) / 2));
      write(c.yellow + '⚠ ' + c.white + perm.name + ' is required for full functionality' + c.reset);
      moveTo(14, Math.floor((cols - 40) / 2));
      write(c.dim + 'Some features may not work without it.' + c.reset);
      await sleep(2000);
    }
  }
  
  await clearContent();
  moveTo(12, Math.floor((cols - 25) / 2));
  write(c.green + '✓ ' + c.bright + 'Permissions configured' + c.reset);
  await sleep(800);
}

// ═══════════════════════════════════════════════════════════════
// Main Setup Flow
// ═══════════════════════════════════════════════════════════════

async function main() {
  hideCursor();
  clearScreen();
  
  // Intro animation
  await animateLogo();
  await sleep(300);
  
  await typeText(8, 'control your mac from anywhere', c.dim, 30);
  await sleep(1000);
  
  // Initialize config
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
    mode: existingConfig.mode || 'ui',
    access: existingConfig.access || 'local',
    extensions: existingConfig.extensions || [],
  };
  
  // ─── Step 1: Raycast ───
  await clearContent();
  await drawStep(1, 5, 'Raycast Extensions', true);
  
  const hasRaycast = isRaycastInstalled();
  
  if (hasRaycast) {
    const useRaycast = await askYesNo('Scan for Raycast extensions?', true);
    
    if (useRaycast) {
      await clearContent();
      await drawStep(1, 5, 'Raycast Extensions', true);
      
      let extensions: Extension[] = [];
      await showProgress('Scanning extensions...', async () => {
        extensions = scanRaycastExtensions();
        await sleep(500);
      });
      
      if (extensions.length > 0) {
        await sleep(300);
        await clearContent();
        await drawStep(1, 5, 'Raycast Extensions', true);
        
        config.extensions = await selectExtensions(extensions);
        
        await clearContent();
        await drawStep(1, 5, 'Raycast Extensions', true);
        
        if (config.extensions.length > 0) {
          await showSuccess(`${config.extensions.length} extensions enabled`);
        } else {
          moveTo(14, Math.floor((cols - 35) / 2));
          write(c.dim + 'No extensions selected (can add later)' + c.reset);
        }
      } else {
        await showError('No compatible extensions found');
      }
    } else {
      moveTo(14, Math.floor((cols - 25) / 2));
      write(c.dim + 'Skipped (can add later)' + c.reset);
    }
  } else {
    moveTo(13, Math.floor((cols - 40) / 2));
    write(c.dim + 'Raycast not detected - skipping' + c.reset);
    moveTo(14, Math.floor((cols - 45) / 2));
    write(c.dim + 'Core tools will still work (music, shell, etc.)' + c.reset);
  }
  
  await sleep(1000);
  
  // ─── Step 1b: Permissions Check ───
  await clearContent();
  await showPermissionsGuide();
  await sleep(500);
  
  // ─── Step 2: Anthropic API Key ───
  await clearContent();
  await drawStep(2, 5, 'AI Configuration', true);
  
  if (config.anthropicKey) {
    const keepKey = await askYesNo('Keep existing Anthropic API key?', true);
    if (!keepKey) {
      await clearContent();
      await drawStep(2, 5, 'AI Configuration', true);
      config.anthropicKey = await askInput('Anthropic API Key', 'sk-ant-...', true);
    }
  } else {
    config.anthropicKey = await askInput('Anthropic API Key', 'sk-ant-...', true);
  }
  
  // Validate
  if (!config.anthropicKey.startsWith('sk-ant-')) {
    await clearContent();
    await drawStep(2, 5, 'AI Configuration', true);
    await showError('Invalid key format (should start with sk-ant-)');
    await sleep(500);
    await clearContent();
    await drawStep(2, 5, 'AI Configuration', true);
    config.anthropicKey = await askInput('Anthropic API Key', 'sk-ant-...', true);
  }
  
  await clearContent();
  await drawStep(2, 5, 'AI Configuration', true);
  await showSuccess('API key configured');
  await sleep(800);
  
  // ─── Step 3: Interface Mode ───
  await clearContent();
  await drawStep(3, 5, 'Interface', true);
  
  const modeChoice = await askChoice('How will you use SYSTEM?', [
    'Web UI - Beautiful chat interface',
    'API Only - For scripts & automation',
  ]);
  
  config.mode = modeChoice === 0 ? 'ui' : 'api';
  
  await clearContent();
  await drawStep(3, 5, 'Interface', true);
  await showSuccess(config.mode === 'ui' ? 'Web UI enabled' : 'API mode enabled');
  await sleep(800);
  
  // ─── Step 4: Access Mode ───
  await clearContent();
  await drawStep(4, 5, 'Access', true);
  
  const accessChoice = await askChoice('Where will you access from?', [
    'This computer only (localhost)',
    'Anywhere (via secure tunnel)',
  ]);
  
  config.access = accessChoice === 0 ? 'local' : 'remote';
  
  if (config.access === 'remote' && !checkCommand('cloudflared')) {
    await clearContent();
    await drawStep(4, 5, 'Access', true);
    
    moveTo(13, Math.floor((cols - 45) / 2));
    write(c.yellow + '⚠ ' + c.white + 'cloudflared not installed' + c.reset);
    moveTo(15, Math.floor((cols - 35) / 2));
    write(c.dim + 'Install: brew install cloudflared' + c.reset);
    moveTo(17, Math.floor((cols - 30) / 2));
    write(c.dim + 'Falling back to local mode' + c.reset);
    
    config.access = 'local';
    await sleep(2000);
  }
  
  await clearContent();
  await drawStep(4, 5, 'Access', true);
  await showSuccess(config.access === 'local' ? 'Local access configured' : 'Remote access configured');
  await sleep(800);
  
  // ─── Step 5: Deploy ───
  await clearContent();
  await drawStep(5, 5, 'Deploy', true);
  
  if (config.mode === 'ui') {
    const wantDeploy = await askYesNo('Deploy agent to Cloudflare Workers? (access from anywhere)', true);
    
    if (wantDeploy) {
      // Check for wrangler and detect accounts
      {
        await clearContent();
        await drawStep(5, 5, 'Deploy', true);
        
        // Auto-detect Cloudflare accounts
        let accountId = '';
        
        await showProgress('Detecting Cloudflare accounts...', async () => {
          await sleep(300);
        });
        
        const accounts = detectCloudflareAccounts();
        
        await clearContent();
        await drawStep(5, 5, 'Deploy', true);
        
        if (accounts.length === 0) {
          // Not logged in or can't detect
          moveTo(13, Math.max(2, Math.floor((cols - 40) / 2)));
          write(c.yellow + '⚠ ' + c.white + 'Could not detect accounts' + c.reset);
          moveTo(14, Math.max(2, Math.floor((cols - 35) / 2)));
          write(c.dim + 'Run: npx wrangler login' + c.reset);
          await sleep(2000);
        } else if (accounts.length === 1) {
          // Single account - use automatically
          accountId = accounts[0].id;
          moveTo(13, Math.max(2, Math.floor((cols - 30) / 2)));
          write(c.green + '✓ ' + c.white + 'Using account:' + c.reset);
          moveTo(14, Math.max(2, Math.floor((cols - accounts[0].name.length) / 2)));
          write(c.greenBright + accounts[0].name + c.reset);
          await sleep(1000);
        } else {
          // Multiple accounts - let user choose
          const choices = accounts.map(a => `${a.name} (${a.id.slice(0, 8)}...)`);
          const choice = await askChoice('Select Cloudflare account:', choices);
          accountId = accounts[choice].id;
        }
        
        await clearContent();
        await drawStep(5, 5, 'Deploy', true);
        
        // Deploy first, then set secrets (to avoid creating orphan workers on failure)
        const agentDir = join(process.cwd(), 'cloudflare-agent');
        
        // Set account ID env var if provided
        const deployEnv = accountId ? { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId } : process.env;
        
        try {
          let deployUrl = '';
          await showProgress('Deploying to Cloudflare...', async () => {
            try {
              const result = execSync('npx wrangler deploy 2>&1', {
                cwd: agentDir,
                encoding: 'utf-8',
                env: deployEnv,
              });
              
              // Extract URL from output - handle various formats
              const match = result.match(/https:\/\/[a-z0-9_-]+\.[a-z0-9_-]+\.workers\.dev/i) 
                || result.match(/https:\/\/[^\s]+\.workers\.dev/i);
              if (match) {
                deployUrl = match[0].replace(/[.,]$/, ''); // trim trailing punctuation
              }
            } catch (e: any) {
              // Log full error for debugging
              const fullErr = e.stdout?.toString() || e.stderr?.toString() || e.message || '';
              console.error('\n[Deploy Error]', fullErr);
              throw new Error(fullErr.split('\n').find((l: string) => l.trim()) || 'Deploy failed');
            }
          });
          
          if (deployUrl) {
            // Deploy succeeded - now set secrets
            await clearContent();
            await drawStep(5, 5, 'Deploy', true);
            
            await showProgress('Setting secrets...', async () => {
              const secrets = [
                ['ANTHROPIC_API_KEY', config.anthropicKey],
                ['BRIDGE_AUTH_TOKEN', config.authToken],
                ['API_SECRET', config.authToken.slice(0, 32)],
              ];
              
              for (const [key, value] of secrets) {
                try {
                  execSync(`echo "${value}" | npx wrangler secret put ${key}`, {
                    cwd: agentDir,
                    stdio: 'pipe',
                    env: deployEnv,
                  });
                } catch (e) {
                  // Secret might already exist, continue
                }
              }
              await sleep(500);
            });
            
            config.deployed = true;
            config.deployedUrl = deployUrl;
            if (accountId) config.cloudflareAccountId = accountId;
            
            await clearContent();
            await drawStep(5, 5, 'Deploy', true);
            await showSuccess('Deployed to Cloudflare!');
          } else {
            config.deployed = false;
            await showError('Deploy completed but no URL found');
          }
        } catch (e: any) {
          await clearContent();
          await drawStep(5, 5, 'Deploy', true);
          
          moveTo(13, Math.floor((cols - 35) / 2));
          write(c.red + '✗ ' + c.white + 'Deployment failed' + c.reset);
          
          // Show actual error
          const errMsg = e.message || e.stderr?.toString() || 'Unknown error';
          const shortErr = errMsg.slice(0, 60);
          moveTo(15, Math.floor((cols - shortErr.length) / 2));
          write(c.dim + shortErr + c.reset);
          
          moveTo(17, Math.floor((cols - 55) / 2));
          write(c.dim + 'Check terminal output above or try: npx wrangler deploy' + c.reset);
          
          if (config.access === 'remote') {
            moveTo(19, Math.floor((cols - 50) / 2));
            write(c.yellow + '⚠ Remote access requires deployment to work' + c.reset);
          }
          
          config.deployed = false;
          await sleep(4000);
        }
      }
    } else {
      config.deployed = false;
      
      await clearContent();
      await drawStep(5, 5, 'Deploy', true);
      moveTo(14, Math.floor((cols - 30) / 2));
      write(c.dim + 'Skipped (run locally instead)' + c.reset);
    }
  } else {
    // API mode - skip deployment UI
    config.deployed = false;
    moveTo(14, Math.floor((cols - 35) / 2));
    write(c.dim + 'API mode - no UI to deploy' + c.reset);
  }
  
  await sleep(800);
  
  // ─── Save Config ───
  await clearContent();
  moveTo(12, Math.floor((cols - 20) / 2));
  write(c.white + 'Saving configuration...' + c.reset);
  
  writeFileSync(configPath, JSON.stringify({
    authToken: config.authToken,
    anthropicKey: config.anthropicKey,
    mode: config.mode,
    access: config.access,
    deployed: config.deployed,
    ...(config.deployedUrl && { deployedUrl: config.deployedUrl }),
    ...(config.cloudflareAccountId && { cloudflareAccountId: config.cloudflareAccountId }),
    extensions: config.extensions.map(ext => ({
      name: ext.name,
      author: ext.author,
      ...(ext.owner && { owner: ext.owner }),
      description: ext.description,
      commands: ext.commands,
    })),
  }, null, 2));
  
  await sleep(500);
  
  // ─── Final Screen ───
  clearScreen();
  await drawLogo(true);
  
  moveTo(9, Math.floor((cols - 20) / 2));
  write(c.green + c.bold + '✓ Setup Complete!' + c.reset);
  
  const boxWidth = 50;
  const boxX = Math.floor((cols - boxWidth) / 2);
  
  drawBox(11, boxX, boxWidth, 10, 'Configuration');
  
  moveTo(13, boxX + 3);
  write(c.dim + 'Mode: ' + c.white + (config.mode === 'ui' ? 'Web UI' : 'API') + c.reset);
  
  moveTo(14, boxX + 3);
  write(c.dim + 'Access: ' + c.white + (config.access === 'local' ? 'Local' : 'Remote') + c.reset);
  
  moveTo(15, boxX + 3);
  write(c.dim + 'Deployed: ' + c.white + (config.deployed ? 'Yes ✓' : 'No (local)') + c.reset);
  
  moveTo(16, boxX + 3);
  write(c.dim + 'Extensions: ' + c.white + config.extensions.length + c.reset);
  
  moveTo(17, boxX + 3);
  write(c.dim + 'Auth Token: ' + c.green + config.authToken.slice(0, 12) + '...' + c.reset);
  
  // Next steps
  moveTo(20, Math.floor((cols - 15) / 2));
  write(c.white + c.bold + 'Next Steps' + c.reset);
  
  if (config.deployed && config.deployedUrl) {
    // Deployed to Cloudflare - just need to start the bridge
    moveTo(22, boxX);
    write(c.green + '1. ' + c.white + 'Start Bridge:' + c.reset);
    moveTo(23, boxX + 3);
    write(c.green + c.bold + 'npm start' + c.reset);
    
    moveTo(25, boxX);
    write(c.green + '2. ' + c.white + 'Open SYSTEM:' + c.reset);
    moveTo(26, boxX + 3);
    write(c.green + c.bold + config.deployedUrl + c.reset);
    
    moveTo(28, boxX);
    write(c.dim + 'API Secret: ' + c.white + config.authToken.slice(0, 32) + c.reset);
  } else {
    moveTo(22, boxX);
    write(c.green + '1. ' + c.white + 'Start SYSTEM:' + c.reset);
    moveTo(23, boxX + 3);
    write(c.green + c.bold + 'npm start' + c.reset);
    
    if (config.mode === 'ui') {
      moveTo(25, boxX);
      write(c.green + '2. ' + c.white + 'Open in browser:' + c.reset);
      moveTo(26, boxX + 3);
      write(c.green + 'http://localhost:8787' + c.reset);
    }
  }
  
  moveTo(rows - 2, 1);
  showCursor();
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════
// Entry Point
// ═══════════════════════════════════════════════════════════════

main().catch(e => {
  showCursor();
  clearScreen();
  console.error('Setup failed:', e.message);
  process.exit(1);
});
