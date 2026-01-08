#!/usr/bin/env node

/**
 * SYSTEM Start
 * 
 * Starts all services based on configuration.
 * - Local mode: Bridge + Local agent
 * - Remote mode: Bridge + Tunnel + (uses deployed worker)
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { spawn, ChildProcess, execSync } from 'child_process';
import { homedir } from 'os';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface ProviderConfig {
  env?: Record<string, string>;
  models?: {
    fast?: string;
    smart?: string;
  };
}

interface Config {
  authToken: string;
  aiProvider?: string;
  providerEnvs?: Record<string, ProviderConfig>;
  mode: 'local' | 'remote';
  deployed?: boolean;
  deployedUrl?: string;
  cloudflareAccountId?: string;
  extensions: unknown[];
  models?: {
    fast: string;
    smart: string;
  };
}

interface ResolvedProvider {
  name: string;
  env: Record<string, string>;
  models: {
    fast: string;
    smart: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// Terminal Utils
// ═══════════════════════════════════════════════════════════════

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[38;2;100;200;150m',
  red: '\x1b[38;2;200;100;100m',
  yellow: '\x1b[38;2;200;180;100m',
  white: '\x1b[38;2;200;200;200m',
  bright: '\x1b[38;2;230;230;230m',
  cyan: '\x1b[38;2;100;180;200m',
};

const log = (s: string) => console.log(s);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const DEFAULT_MODELS = {
  fast: 'claude-3-5-haiku-20241022',
  smart: 'claude-sonnet-4-20250514',
};

function resolveProvider(config: Config): ResolvedProvider {
  const providerName =
    config.aiProvider || Object.keys(config.providerEnvs || {})[0];
  if (!providerName) {
    throw new Error('No AI provider configured');
  }

  const providerConfig = config.providerEnvs?.[providerName] || {};
  const env = providerConfig.env || {};
  const models = {
    fast: providerConfig.models?.fast || config.models?.fast || DEFAULT_MODELS.fast,
    smart: providerConfig.models?.smart || config.models?.smart || DEFAULT_MODELS.smart,
  };

  if (!config.authToken) {
    throw new Error('Missing authToken in config');
  }

  if (Object.keys(env).length === 0) {
    throw new Error(`Provider "${providerName}" has no credentials/env set`);
  }

  return { name: providerName, env, models };
}

// ═══════════════════════════════════════════════════════════════
// ASCII Art
// ═══════════════════════════════════════════════════════════════

const LOGO = `
${c.dim}┌───────────────────────────┐${c.reset}
${c.dim}│${c.reset} ${c.green}█▀▀ █▄█ █▀▀ ▀█▀ █▀▀ █▀▄▀█${c.reset} ${c.dim}│${c.reset}
${c.dim}│${c.reset} ${c.green}▀▀█  █  ▀▀█  █  ██▄ █ ▀ █${c.reset} ${c.dim}│${c.reset}
${c.dim}└───────────────────────────┘${c.reset}`;

// ═══════════════════════════════════════════════════════════════
// Process Management
// ═══════════════════════════════════════════════════════════════

const processes: ChildProcess[] = [];

function cleanup() {
  log(`\n${c.dim}Shutting down...${c.reset}`);
  for (const proc of processes) {
    try {
      proc.kill();
    } catch {}
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// ═══════════════════════════════════════════════════════════════
// Service Starters
// ═══════════════════════════════════════════════════════════════

async function startBridge(config: Config, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      HOST: host,
      PORT: '3000',
    };
    
    const proc = spawn('node', ['dist/bridge/http-server.js'], {
      env,
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    
    processes.push(proc);
    
    let started = false;
    let output = '';
    
    proc.stdout.on('data', (data) => {
      output += data.toString();
      if ((output.includes('SYSTEM is online') || output.includes('listening')) && !started) {
        started = true;
        resolve();
      }
    });
    
    proc.stderr.on('data', (data) => {
      const str = data.toString();
      if (!started && (str.includes('Error') || str.includes('EADDRINUSE'))) {
        reject(new Error(str.trim()));
      }
    });
    
    proc.on('error', reject);
    
    setTimeout(() => {
      if (!started) resolve(); // Assume it started
    }, 5000);
  });
}

async function startTunnel(): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('cloudflared', ['tunnel', '--url', 'http://localhost:3000'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    
    processes.push(proc);
    
    let output = '';
    let resolved = false;
    
    const checkUrl = () => {
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !resolved) {
        resolved = true;
        resolve(match[0]);
      }
    };
    
    proc.stdout.on('data', (data) => {
      output += data.toString();
      checkUrl();
    });
    
    proc.stderr.on('data', (data) => {
      output += data.toString();
      checkUrl();
    });
    
    proc.on('error', (e) => {
      if (!resolved) reject(e);
    });
    
    setTimeout(() => {
      if (!resolved) reject(new Error('Tunnel timeout - is cloudflared installed?'));
    }, 30000);
  });
}

async function updateDeployedBridgeUrl(bridgeUrl: string, accountId?: string): Promise<void> {
  const agentDir = join(process.cwd(), 'cloudflare-agent');
  try {
    const env = accountId ? { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId } : process.env;
    execSync(`echo "${bridgeUrl}" | npx wrangler secret put BRIDGE_URL 2>&1`, {
      cwd: agentDir,
      stdio: 'pipe',
      env,
      timeout: 30000,
    });
  } catch {
    // Non-fatal
  }
}

async function startLocalAgent(config: Config, bridgeUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const provider = resolveProvider(config);
    const devVarsLines = [
      `BRIDGE_URL=${bridgeUrl}`,
      `BRIDGE_AUTH_TOKEN=${config.authToken}`,
      `API_SECRET=${config.authToken.slice(0, 32)}`,
      `AI_PROVIDER=${provider.name}`,
      `MODEL_FAST=${provider.models.fast}`,
      `MODEL_SMART=${provider.models.smart}`,
      ...Object.entries(provider.env).map(([key, value]) => `${key}=${value}`),
    ];
    const devVars = devVarsLines.join('\n') + '\n';
    
    const agentDir = join(process.cwd(), 'cloudflare-agent');
    writeFileSync(join(agentDir, '.dev.vars'), devVars);
    
    const proc = spawn('npm', ['run', 'dev'], {
      cwd: agentDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });
    
    processes.push(proc);
    
    let started = false;
    let output = '';
    
    const checkStarted = () => {
      if ((output.includes('Ready') || output.includes('localhost:8787')) && !started) {
        started = true;
        resolve();
      }
    };
    
    proc.stdout.on('data', (data) => {
      output += data.toString();
      checkStarted();
    });
    
    proc.stderr.on('data', (data) => {
      output += data.toString();
      checkStarted();
    });
    
    proc.on('error', reject);
    
    setTimeout(() => {
      if (!started) resolve(); // Assume it started
    }, 15000);
  });
}

// ═══════════════════════════════════════════════════════════════
// Status Display
// ═══════════════════════════════════════════════════════════════

interface Service {
  name: string;
  status: 'starting' | 'running' | 'error';
  url?: string;
  error?: string;
}

function showStatus(services: Service[], config: Config) {
  console.clear();
  log(LOGO);
  log('');
  
  const maxName = Math.max(...services.map(s => s.name.length));
  
  for (const svc of services) {
    const name = svc.name.padEnd(maxName + 2);
    let status = '';
    
    switch (svc.status) {
      case 'starting':
        status = `${c.yellow}◐ starting${c.reset}`;
        break;
      case 'running':
        status = `${c.green}● running${c.reset}`;
        break;
      case 'error':
        status = `${c.red}✗ error${c.reset}`;
        break;
    }
    
    if (svc.url) {
      log(`  ${c.white}${name}${c.reset} ${status}  ${c.cyan}${svc.url}${c.reset}`);
    } else {
      log(`  ${c.white}${name}${c.reset} ${status}`);
    }
    
    if (svc.error) {
      log(`  ${' '.repeat(maxName + 2)} ${c.red}${svc.error}${c.reset}`);
    }
  }
  
  log('');
}

// ═══════════════════════════════════════════════════════════════
// Permissions Check
// ═══════════════════════════════════════════════════════════════

function checkFullDiskAccess(): boolean {
  try {
    const dbPath = join(homedir(), 'Library', 'Messages', 'chat.db');
    execSync(`sqlite3 "${dbPath}" "SELECT 1 LIMIT 1" 2>/dev/null`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function showPermissionWarning() {
  log(`${c.yellow}┌─────────────────────────────────────────────────────────┐${c.reset}`);
  log(`${c.yellow}│${c.reset} ${c.yellow}⚠${c.reset}  ${c.white}Full Disk Access not granted${c.reset}                         ${c.yellow}│${c.reset}`);
  log(`${c.yellow}│${c.reset}                                                         ${c.yellow}│${c.reset}`);
  log(`${c.yellow}│${c.reset}  iMessage reading won't work until you:                 ${c.yellow}│${c.reset}`);
  log(`${c.yellow}│${c.reset}                                                         ${c.yellow}│${c.reset}`);
  log(`${c.yellow}│${c.reset}  1. Open ${c.cyan}System Settings → Privacy & Security${c.reset}          ${c.yellow}│${c.reset}`);
  log(`${c.yellow}│${c.reset}  2. Click ${c.cyan}Full Disk Access${c.reset}                             ${c.yellow}│${c.reset}`);
  log(`${c.yellow}│${c.reset}  3. Add your terminal app and enable it                 ${c.yellow}│${c.reset}`);
  log(`${c.yellow}│${c.reset}  4. Restart this terminal                               ${c.yellow}│${c.reset}`);
  log(`${c.yellow}│${c.reset}                                                         ${c.yellow}│${c.reset}`);
  log(`${c.yellow}│${c.reset}  Run ${c.cyan}npm run check${c.reset} for detailed permission status      ${c.yellow}│${c.reset}`);
  log(`${c.yellow}└─────────────────────────────────────────────────────────┘${c.reset}`);
  log('');
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function main() {
  // Load config
  const configPath = join(process.cwd(), 'bridge.config.json');
  
  if (!existsSync(configPath)) {
    log(`\n${c.red}Error: Not configured${c.reset}`);
    log(`\nRun ${c.cyan}npm run setup${c.reset} first.\n`);
    process.exit(1);
  }
  
  let config: Config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    log(`\n${c.red}Error: Invalid config file${c.reset}`);
    log(`\nRun ${c.cyan}npm run setup${c.reset} to reconfigure.\n`);
    process.exit(1);
  }
  
  // Validate config
  try {
    resolveProvider(config);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Missing required config values';
    log(`\n${c.red}Error: Missing required config values${c.reset}`);
    log(`\n${message}\n`);
    log(`Run ${c.cyan}npm run setup${c.reset} to reconfigure.\n`);
    process.exit(1);
  }
  
  // Determine what to start based on mode
  const isRemote = config.mode === 'remote';
  const isDeployed = isRemote && config.deployed && config.deployedUrl;
  
  // Build services list
  const services: Service[] = [
    { name: 'Bridge', status: 'starting' },
  ];
  
  if (isRemote) {
    services.push({ name: 'Tunnel', status: 'starting' });
  }
  
  if (!isDeployed) {
    services.push({ name: 'Agent', status: 'starting' });
  }
  
  showStatus(services, config);
  
  // Check permissions (warn but don't block)
  if (!checkFullDiskAccess()) {
    showPermissionWarning();
    log(`${c.dim}Continuing anyway... some features may not work.${c.reset}`);
    log('');
    await sleep(2000);
  }
  
  // Start bridge
  const bridgeHost = isRemote ? '0.0.0.0' : '127.0.0.1';
  
  try {
    await startBridge(config, bridgeHost);
    services[0].status = 'running';
    services[0].url = 'http://localhost:3000';
    showStatus(services, config);
  } catch (e) {
    services[0].status = 'error';
    services[0].error = e instanceof Error ? e.message.slice(0, 50) : 'Failed to start';
    showStatus(services, config);
    
    log(`\n${c.red}Bridge failed to start.${c.reset}`);
    log(`${c.dim}Is port 3000 already in use?${c.reset}\n`);
    cleanup();
    return;
  }
  
  // Start tunnel if remote mode
  let bridgeUrl = 'http://localhost:3000';
  
  if (isRemote) {
    const tunnelIdx = services.findIndex(s => s.name === 'Tunnel');
    
    try {
      bridgeUrl = await startTunnel();
      services[tunnelIdx].status = 'running';
      services[tunnelIdx].url = bridgeUrl;
      showStatus(services, config);
      
      // Update deployed worker with new tunnel URL
      if (isDeployed) {
        await updateDeployedBridgeUrl(bridgeUrl, config.cloudflareAccountId);
      }
    } catch (e) {
      services[tunnelIdx].status = 'error';
      services[tunnelIdx].error = e instanceof Error ? e.message.slice(0, 50) : 'Failed';
      showStatus(services, config);
      
      log(`\n${c.yellow}Tunnel failed. Falling back to local mode.${c.reset}`);
      log(`${c.dim}Install cloudflared: brew install cloudflared${c.reset}\n`);
      
      // Continue without tunnel - still useful for local access
      bridgeUrl = 'http://localhost:3000';
    }
  }
  
  // Start local agent if not deployed
  if (!isDeployed) {
    const agentIdx = services.findIndex(s => s.name === 'Agent');
    
    try {
      await startLocalAgent(config, bridgeUrl);
      services[agentIdx].status = 'running';
      services[agentIdx].url = 'http://localhost:8787';
      showStatus(services, config);
    } catch (e) {
      services[agentIdx].status = 'error';
      services[agentIdx].error = e instanceof Error ? e.message.slice(0, 50) : 'Failed';
      showStatus(services, config);
      
      log(`\n${c.red}Agent failed to start.${c.reset}`);
      log(`${c.dim}Try: cd cloudflare-agent && npm install${c.reset}\n`);
    }
  }
  
  // Final summary
  log(`${c.dim}─────────────────────────────────────────────────────${c.reset}`);
  log('');
  
  if (isDeployed) {
    log(`  ${c.green}${c.bold}Open SYSTEM:${c.reset}  ${c.cyan}${config.deployedUrl}${c.reset}`);
    log(`  ${c.dim}API Secret:${c.reset}   ${c.white}${config.authToken.slice(0, 32)}${c.reset}`);
  } else {
    const agentUrl = services.find(s => s.name === 'Agent')?.url || 'http://localhost:8787';
    log(`  ${c.green}${c.bold}Open SYSTEM:${c.reset}  ${c.cyan}${agentUrl}${c.reset}`);
    log(`  ${c.dim}API Secret:${c.reset}   ${c.white}${config.authToken.slice(0, 32)}${c.reset}`);
  }
  
  log('');
  log(`${c.dim}─────────────────────────────────────────────────────${c.reset}`);
  log('');
  log(`${c.dim}Press Ctrl+C to stop${c.reset}`);
  
  // Keep alive
  await new Promise(() => {});
}

main().catch(e => {
  console.error(`\n${c.red}Error: ${e.message}${c.reset}\n`);
  cleanup();
});
