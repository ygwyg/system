#!/usr/bin/env node

/**
 * SYSTEM Start
 * 
 * Starts all services based on configuration.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { spawn, ChildProcess, execSync } from 'child_process';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface Config {
  authToken: string;
  anthropicKey: string;
  mode: 'ui' | 'api';
  access: 'local' | 'remote';
  deployed?: boolean;
  deployedUrl?: string;
  cloudflareAccountId?: string;
  extensions: unknown[];
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

const write = (s: string) => process.stdout.write(s);
const log = (s: string) => console.log(s);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════════
// ASCII Art
// ═══════════════════════════════════════════════════════════════

const LOGO = `${c.dim}┌───────────────────────────┐${c.reset}
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
    proc.kill();
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
    
    proc.stdout.on('data', (data) => {
      const str = data.toString();
      if (str.includes('listening on') && !started) {
        started = true;
        resolve();
      }
    });
    
    proc.stderr.on('data', (data) => {
      if (!started) {
        const str = data.toString();
        if (str.includes('Error') || str.includes('error')) {
          reject(new Error(str));
        }
      }
    });
    
    proc.on('error', reject);
    
    // Timeout
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
    
    proc.on('error', reject);
    
    setTimeout(() => {
      if (!resolved) reject(new Error('Tunnel timeout'));
    }, 30000);
  });
}

async function updateDeployedBridgeUrl(bridgeUrl: string, accountId?: string): Promise<void> {
  const agentDir = join(process.cwd(), 'cloudflare-agent');
  try {
    const env = accountId ? { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId } : process.env;
    execSync(`echo "${bridgeUrl}" | npx wrangler secret put BRIDGE_URL`, {
      cwd: agentDir,
      stdio: 'pipe',
      env,
    });
    log(`${c.dim}Updated BRIDGE_URL secret${c.reset}`);
  } catch (e) {
    log(`${c.yellow}Warning: Could not update BRIDGE_URL secret${c.reset}`);
  }
}

async function startAgent(config: Config, bridgeUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Write .dev.vars for local agent
    const devVars = `ANTHROPIC_API_KEY=${config.anthropicKey}
BRIDGE_URL=${bridgeUrl}
BRIDGE_AUTH_TOKEN=${config.authToken}
API_SECRET=${config.authToken.slice(0, 32)}
`;
    
    const agentDir = join(process.cwd(), 'cloudflare-agent');
    writeFileSync(join(agentDir, '.dev.vars'), devVars);
    
    const proc = spawn('npm', ['run', 'dev'], {
      cwd: agentDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });
    
    processes.push(proc);
    
    let started = false;
    
    proc.stdout.on('data', (data) => {
      const str = data.toString();
      if ((str.includes('Ready') || str.includes('localhost:8787')) && !started) {
        started = true;
        resolve();
      }
    });
    
    proc.stderr.on('data', (data) => {
      const str = data.toString();
      if ((str.includes('Ready') || str.includes('localhost:8787')) && !started) {
        started = true;
        resolve();
      }
    });
    
    proc.on('error', reject);
    
    setTimeout(() => {
      if (!started) resolve();
    }, 10000);
  });
}

// ═══════════════════════════════════════════════════════════════
// Status Display
// ═══════════════════════════════════════════════════════════════

function showStatus(services: { name: string; status: string; url?: string }[]) {
  console.clear();
  log(LOGO);
  log('');
  
  const maxName = Math.max(...services.map(s => s.name.length));
  
  for (const svc of services) {
    const name = svc.name.padEnd(maxName);
    let status = '';
    
    switch (svc.status) {
      case 'starting':
        status = `${c.yellow}⠋ starting${c.reset}`;
        break;
      case 'running':
        status = `${c.green}● running${c.reset}`;
        break;
      case 'error':
        status = `${c.red}✗ error${c.reset}`;
        break;
    }
    
    if (svc.url) {
      log(`  ${c.white}${name}${c.reset}  ${status}  ${c.cyan}${svc.url}${c.reset}`);
    } else {
      log(`  ${c.white}${name}${c.reset}  ${status}`);
    }
  }
  
  log('');
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function main() {
  // Load config
  const configPath = join(process.cwd(), 'bridge.config.json');
  
  if (!existsSync(configPath)) {
    log(`${c.red}Error: bridge.config.json not found${c.reset}`);
    log(`${c.dim}Run: npm run setup${c.reset}`);
    process.exit(1);
  }
  
  let config: Config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (e) {
    log(`${c.red}Error: Invalid bridge.config.json${c.reset}`);
    process.exit(1);
  }
  
  // Validate config
  if (!config.authToken) {
    log(`${c.red}Error: No auth token in config${c.reset}`);
    log(`${c.dim}Run: npm run setup${c.reset}`);
    process.exit(1);
  }
  
  if (!config.anthropicKey) {
    log(`${c.red}Error: No Anthropic API key in config${c.reset}`);
    log(`${c.dim}Run: npm run setup${c.reset}`);
    process.exit(1);
  }
  
  // Determine what to start
  const needsTunnel = config.access === 'remote';
  const needsLocalAgent = config.mode === 'ui' && !config.deployed;
  const isDeployed = config.deployed && config.deployedUrl;
  
  const services: { name: string; status: string; url?: string }[] = [
    { name: 'Bridge', status: 'starting' },
  ];
  
  if (needsTunnel) {
    services.push({ name: 'Tunnel', status: 'starting' });
  }
  
  if (needsLocalAgent) {
    services.push({ name: 'Agent', status: 'starting' });
  }
  
  if (isDeployed) {
    services.push({ name: 'Deployed', status: 'running', url: config.deployedUrl });
  }
  
  showStatus(services);
  
  // Start bridge
  try {
    const bridgeHost = needsTunnel ? '0.0.0.0' : '127.0.0.1';
    await startBridge(config, bridgeHost);
    services[0].status = 'running';
    services[0].url = 'http://localhost:3000';
    showStatus(services);
  } catch (e) {
    services[0].status = 'error';
    showStatus(services);
    log(`${c.red}Bridge error: ${e}${c.reset}`);
    cleanup();
    return;
  }
  
  // Start tunnel if needed
  let bridgeUrl = 'http://localhost:3000';
  
  if (needsTunnel) {
    try {
      bridgeUrl = await startTunnel();
      services[1].status = 'running';
      services[1].url = bridgeUrl;
      showStatus(services);
      
      // If deployed, update the worker's BRIDGE_URL secret
      if (isDeployed) {
        log(`${c.dim}Updating deployed worker with tunnel URL...${c.reset}`);
        await updateDeployedBridgeUrl(bridgeUrl, config.cloudflareAccountId);
      }
    } catch (e) {
      services[1].status = 'error';
      showStatus(services);
      log(`${c.yellow}Tunnel failed, using local mode${c.reset}`);
      bridgeUrl = 'http://localhost:3000';
    }
  }
  
  // Start local agent if needed (not deployed)
  if (needsLocalAgent) {
    try {
      await startAgent(config, bridgeUrl);
      const agentIdx = services.findIndex(s => s.name === 'Agent');
      services[agentIdx].status = 'running';
      services[agentIdx].url = 'http://localhost:8787';
      showStatus(services);
    } catch (e) {
      const agentIdx = services.findIndex(s => s.name === 'Agent');
      services[agentIdx].status = 'error';
      showStatus(services);
      log(`${c.red}Agent error: ${e}${c.reset}`);
    }
  }
  
  // Final display
  log('');
  log(`${c.dim}─────────────────────────────────────────────────────${c.reset}`);
  log('');
  
  if (isDeployed) {
    log(`  ${c.green}${c.bold}Open SYSTEM:${c.reset} ${c.cyan}${config.deployedUrl}${c.reset}`);
    log('');
    log(`  ${c.dim}API Secret:${c.reset} ${c.white}${config.authToken.slice(0, 32)}${c.reset}`);
  } else if (needsLocalAgent) {
    log(`  ${c.green}${c.bold}Open SYSTEM:${c.reset} ${c.cyan}http://localhost:8787${c.reset}`);
    log('');
    log(`  ${c.dim}API Secret:${c.reset} ${c.white}${config.authToken.slice(0, 32)}${c.reset}`);
  } else {
    log(`  ${c.green}${c.bold}Bridge API:${c.reset} ${c.cyan}${bridgeUrl}${c.reset}`);
    log('');
    log(`  ${c.dim}Auth Token:${c.reset} ${c.white}${config.authToken.slice(0, 16)}...${c.reset}`);
  }
  
  log('');
  log(`${c.dim}─────────────────────────────────────────────────────${c.reset}`);
  log('');
  log(`${c.dim}Press Ctrl+C to stop${c.reset}`);
  
  // Keep alive
  await new Promise(() => {});
}

main().catch(e => {
  console.error(`${c.red}Error: ${e.message}${c.reset}`);
  cleanup();
});

