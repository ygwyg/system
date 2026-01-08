#!/usr/bin/env node

/**
 * SYSTEM Check
 *
 * Pre-flight checks for permissions and dependencies.
 * Run this before setup or when things aren't working.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

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
const _sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════════
// Check Functions
// ═══════════════════════════════════════════════════════════════

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  fix?: string;
  fixCommand?: string;
}

// Node.js version
function checkNodeVersion(): CheckResult {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0]);

  if (major >= 18) {
    return {
      name: 'Node.js',
      status: 'pass',
      message: `${version} (>= 18 required)`,
    };
  }

  return {
    name: 'Node.js',
    status: 'fail',
    message: `${version} is too old`,
    fix: 'Install Node.js 18 or later',
    fixCommand: 'brew install node@20',
  };
}

// cloudflared
function checkCloudflared(): CheckResult {
  try {
    const version = execSync('cloudflared --version 2>&1', { encoding: 'utf-8' }).trim();
    const versionMatch = version.match(/cloudflared version (\S+)/);
    return {
      name: 'cloudflared',
      status: 'pass',
      message: versionMatch ? versionMatch[1] : 'installed',
    };
  } catch {
    return {
      name: 'cloudflared',
      status: 'warn',
      message: 'Not installed (required for remote access)',
      fix: 'Install cloudflared for remote access',
      fixCommand: 'brew install cloudflared',
    };
  }
}

// wrangler auth
function checkWranglerAuth(): CheckResult {
  try {
    const output = execSync('npx wrangler whoami 2>&1', {
      encoding: 'utf-8',
      timeout: 30000,
    });

    // Check if logged in by looking for account info
    if (output.includes('You are logged in') || output.includes('Account Name')) {
      // Extract account name if possible
      const match = output.match(/│\s*([^│]+?)\s*│\s*([a-f0-9]{32})\s*│/i);
      const accountName = match ? match[1].trim() : 'Cloudflare';
      return {
        name: 'Wrangler',
        status: 'pass',
        message: `Logged in (${accountName.slice(0, 20)})`,
      };
    }

    return {
      name: 'Wrangler',
      status: 'warn',
      message: 'Not logged in (required for deploy)',
      fix: 'Login to Cloudflare',
      fixCommand: 'npx wrangler login',
    };
  } catch {
    return {
      name: 'Wrangler',
      status: 'warn',
      message: 'Not logged in (required for deploy)',
      fix: 'Login to Cloudflare',
      fixCommand: 'npx wrangler login',
    };
  }
}

// Dependencies installed
function checkDependencies(): CheckResult {
  const rootModules = join(process.cwd(), 'node_modules');
  const agentModules = join(process.cwd(), 'cloudflare-agent', 'node_modules');

  const hasRoot = existsSync(rootModules);
  const hasAgent = existsSync(agentModules);

  if (hasRoot && hasAgent) {
    return {
      name: 'Dependencies',
      status: 'pass',
      message: 'All installed',
    };
  }

  if (!hasRoot && !hasAgent) {
    return {
      name: 'Dependencies',
      status: 'fail',
      message: 'Not installed',
      fix: 'Install dependencies',
      fixCommand: 'npm install && cd cloudflare-agent && npm install',
    };
  }

  if (!hasAgent) {
    return {
      name: 'Dependencies',
      status: 'fail',
      message: 'cloudflare-agent/node_modules missing',
      fix: 'Install agent dependencies',
      fixCommand: 'cd cloudflare-agent && npm install',
    };
  }

  return {
    name: 'Dependencies',
    status: 'fail',
    message: 'node_modules missing',
    fix: 'Install dependencies',
    fixCommand: 'npm install',
  };
}

// Config exists
function checkConfig(): CheckResult {
  const configPath = join(process.cwd(), 'bridge.config.json');

  if (!existsSync(configPath)) {
    return {
      name: 'Config',
      status: 'warn',
      message: 'Not configured yet',
      fix: 'Run setup',
      fixCommand: 'npm run setup',
    };
  }

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));

    if (!config.authToken) {
      return {
        name: 'Config',
        status: 'fail',
        message: 'Missing auth token',
        fix: 'Re-run setup',
        fixCommand: 'npm run setup',
      };
    }

    if (!config.anthropicKey) {
      return {
        name: 'Config',
        status: 'fail',
        message: 'Missing Anthropic API key',
        fix: 'Re-run setup',
        fixCommand: 'npm run setup',
      };
    }

    return {
      name: 'Config',
      status: 'pass',
      message: 'Valid',
    };
  } catch {
    return {
      name: 'Config',
      status: 'fail',
      message: 'Invalid JSON',
      fix: 'Re-run setup',
      fixCommand: 'npm run setup',
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// Permission Checks (macOS)
// ═══════════════════════════════════════════════════════════════

function getTerminalAppName(): string {
  const termProgram = process.env.TERM_PROGRAM || '';

  if (termProgram.includes('iTerm')) return 'iTerm';
  if (termProgram.includes('Apple_Terminal')) return 'Terminal';
  if (termProgram.includes('vscode') || termProgram.includes('Code')) return 'Visual Studio Code';
  if (termProgram.includes('cursor')) return 'Cursor';
  if (termProgram.includes('Warp')) return 'Warp';

  try {
    let pid = process.ppid;
    for (let i = 0; i < 5; i++) {
      const comm = execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf-8' }).trim();
      const name = comm.split('/').pop() || '';

      if (name.includes('Terminal')) return 'Terminal';
      if (name.includes('iTerm')) return 'iTerm';
      if (name.includes('Code')) return 'Visual Studio Code';
      if (name.includes('Cursor')) return 'Cursor';
      if (name.includes('Warp')) return 'Warp';

      const ppid = execSync(`ps -p ${pid} -o ppid=`, { encoding: 'utf-8' }).trim();
      if (!ppid || ppid === '1' || ppid === '0') break;
      pid = parseInt(ppid);
    }
  } catch {
    // Process tree walk failed, fall back to default
  }

  return 'Terminal';
}

function checkFullDiskAccess(): CheckResult {
  try {
    const dbPath = join(homedir(), 'Library', 'Messages', 'chat.db');
    execSync(`sqlite3 "${dbPath}" "SELECT 1 LIMIT 1" 2>/dev/null`, { stdio: 'pipe' });
    return {
      name: 'Full Disk Access',
      status: 'pass',
      message: 'Granted - iMessages will work',
    };
  } catch {
    const app = getTerminalAppName();
    return {
      name: 'Full Disk Access',
      status: 'fail',
      message: `Not granted - add ${app}`,
      fix: `Add "${app}" to Full Disk Access in System Settings`,
      fixCommand: 'open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"',
    };
  }
}

function checkAccessibility(): CheckResult {
  try {
    execSync(
      `osascript -e 'tell application "System Events" to return name of first process' 2>/dev/null`,
      { stdio: 'pipe' }
    );
    return {
      name: 'Accessibility',
      status: 'pass',
      message: 'Granted - keyboard/mouse will work',
    };
  } catch {
    const app = getTerminalAppName();
    return {
      name: 'Accessibility',
      status: 'fail',
      message: `Not granted - add ${app}`,
      fix: `Add "${app}" to Accessibility in System Settings`,
      fixCommand:
        'open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"',
    };
  }
}

function checkContacts(): CheckResult {
  try {
    execSync(`osascript -e 'tell application "Contacts" to return count of people' 2>/dev/null`, {
      stdio: 'pipe',
    });
    return {
      name: 'Contacts',
      status: 'pass',
      message: 'Granted - contact lookup will work',
    };
  } catch {
    const app = getTerminalAppName();
    return {
      name: 'Contacts',
      status: 'warn',
      message: `Not granted - add ${app}`,
      fix: `Add "${app}" to Contacts in System Settings`,
      fixCommand: 'open "x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts"',
    };
  }
}

function checkAutomation(): CheckResult {
  try {
    // Try to get the name of the frontmost app - requires Automation permission
    execSync(
      `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true' 2>/dev/null`,
      { stdio: 'pipe' }
    );
    return {
      name: 'Automation',
      status: 'pass',
      message: 'Granted - app control will work',
    };
  } catch {
    const app = getTerminalAppName();
    return {
      name: 'Automation',
      status: 'warn',
      message: `May need setup - allow when prompted`,
      fix: `Allow "${app}" to control other apps when prompted`,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// Display
// ═══════════════════════════════════════════════════════════════

function displayResult(result: CheckResult, showFix = true): void {
  const icon =
    result.status === 'pass'
      ? `${c.green}✓`
      : result.status === 'fail'
        ? `${c.red}✗`
        : `${c.yellow}⚠`;

  const statusColor =
    result.status === 'pass' ? c.green : result.status === 'fail' ? c.red : c.yellow;

  log(
    `  ${icon} ${c.white}${result.name.padEnd(18)}${c.reset} ${statusColor}${result.message}${c.reset}`
  );

  if (showFix && result.fix && result.status !== 'pass') {
    log(`    ${c.dim}→ ${result.fix}${c.reset}`);
    if (result.fixCommand) {
      log(`    ${c.dim}  ${c.cyan}${result.fixCommand}${c.reset}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const fixMode = args.includes('--fix');
  const _quietMode = args.includes('--quiet');

  log('');
  log(`${c.green}┌─────────────────────────────────────┐${c.reset}`);
  log(
    `${c.green}│${c.reset} ${c.bright}${c.bold}SYSTEM${c.reset} ${c.dim}Pre-flight Check${c.reset}            ${c.green}│${c.reset}`
  );
  log(`${c.green}└─────────────────────────────────────┘${c.reset}`);
  log('');

  // System checks
  log(`${c.white}${c.bold}System${c.reset}`);
  log('');

  const systemChecks = [
    checkNodeVersion(),
    checkDependencies(),
    checkCloudflared(),
    checkWranglerAuth(),
    checkConfig(),
  ];

  for (const result of systemChecks) {
    displayResult(result);
  }

  log('');

  // Permission checks (macOS only)
  if (process.platform === 'darwin') {
    log(`${c.white}${c.bold}macOS Permissions${c.reset}`);
    log('');

    const permissionChecks = [
      checkFullDiskAccess(),
      checkAccessibility(),
      checkContacts(),
      checkAutomation(),
    ];

    for (const result of permissionChecks) {
      displayResult(result);
    }

    log('');
  }

  // Summary
  const allChecks = [
    ...systemChecks,
    ...(process.platform === 'darwin'
      ? [checkFullDiskAccess(), checkAccessibility(), checkContacts(), checkAutomation()]
      : []),
  ];

  const failures = allChecks.filter((r) => r.status === 'fail');
  const warnings = allChecks.filter((r) => r.status === 'warn');

  if (failures.length === 0 && warnings.length === 0) {
    log(
      `${c.green}${c.bold}All checks passed!${c.reset} Run ${c.cyan}npm start${c.reset} to begin.`
    );
    log('');
    process.exit(0);
  }

  if (failures.length > 0) {
    log(`${c.red}${c.bold}${failures.length} issue(s) need fixing${c.reset}`);

    if (fixMode) {
      log('');
      log(`${c.dim}Attempting to fix...${c.reset}`);

      for (const failure of failures) {
        if (failure.fixCommand) {
          log(`${c.dim}Running: ${failure.fixCommand}${c.reset}`);
          try {
            if (failure.fixCommand.startsWith('open ')) {
              execSync(failure.fixCommand, { stdio: 'ignore' });
              log(
                `${c.yellow}→ Opened System Settings. Grant permission and re-run this check.${c.reset}`
              );
            } else {
              execSync(failure.fixCommand, { stdio: 'inherit' });
              log(`${c.green}✓ Fixed${c.reset}`);
            }
          } catch {
            log(`${c.red}✗ Failed to fix automatically${c.reset}`);
          }
        }
      }
    } else {
      log(
        `${c.dim}Run ${c.cyan}npm run check -- --fix${c.reset}${c.dim} to attempt automatic fixes${c.reset}`
      );
    }
    log('');
    process.exit(1);
  }

  if (warnings.length > 0) {
    log(
      `${c.yellow}${warnings.length} warning(s)${c.reset} ${c.dim}(non-blocking, some features may not work)${c.reset}`
    );
    log('');
    process.exit(0);
  }
}

main().catch((e) => {
  console.error(`${c.red}Error: ${e.message}${c.reset}`);
  process.exit(1);
});
