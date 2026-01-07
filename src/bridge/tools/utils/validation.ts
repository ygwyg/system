/**
 * Validation Utilities and Security
 */

import { z } from 'zod';

// Input validation schemas
export const schemas = {
  openUrl: z.object({ url: z.string().url() }),
  openApp: z.object({ name: z.string().min(1).max(100) }),
  applescript: z.object({ script: z.string().min(1).max(10000) }),
  raycastCommand: z.object({
    extension: z.string().min(1),
    command: z.string().min(1),
    arguments: z.record(z.string()).optional(),
    fallbackText: z.string().optional(),
  }),
};

/**
 * Paths that should never be accessed
 */
export const BLOCKED_PATHS = [
  /\.env/i,
  /\.dev\.vars/i,
  /\.ssh/,
  /\.aws/,
  /\.gnupg/,
  /\.gitconfig/,
  /\.npmrc/,
  /\.netrc/,
  /id_rsa/,
  /id_ed25519/,
  /\.pem$/,
  /\.key$/,
  /password/i,
  /secret/i,
  /token/i,
  /credential/i,
  /\/etc\/passwd/,
  /\/etc\/shadow/,
  /keychain/i,
];

export function containsBlockedPath(args: string[]): boolean {
  const fullArgs = args.join(' ');
  return BLOCKED_PATHS.some(pattern => pattern.test(fullArgs));
}

/**
 * Safe shell commands allowlist
 */
export const SAFE_SHELL_COMMANDS: Record<string, {
  description: string;
  allowArgs?: boolean;
  argPattern?: RegExp;
}> = {
  // System info
  'pwd': { description: 'Print working directory', allowArgs: false },
  'whoami': { description: 'Print current user', allowArgs: false },
  'hostname': { description: 'Print hostname', allowArgs: false },
  'date': { description: 'Print date/time', allowArgs: true },
  'cal': { description: 'Show calendar', allowArgs: true },
  'uptime': { description: 'Show system uptime', allowArgs: false },
  'sw_vers': { description: 'macOS version', allowArgs: false },
  'uname': { description: 'System info', allowArgs: true },
  
  // File listing (read-only)
  'ls': { description: 'List directory contents', allowArgs: true },
  'which': { description: 'Locate a command', allowArgs: true },
  'find': { description: 'Find files', allowArgs: true },
  'file': { description: 'Determine file type', allowArgs: true },
  'wc': { description: 'Word/line count', allowArgs: true },
  'head': { description: 'Show first lines', allowArgs: true },
  'tail': { description: 'Show last lines', allowArgs: true },
  'cat': { description: 'Display file contents', allowArgs: true },
  
  // Text processing
  'grep': { description: 'Search text', allowArgs: true },
  'sort': { description: 'Sort lines', allowArgs: true },
  'uniq': { description: 'Filter unique lines', allowArgs: true },
  'cut': { description: 'Cut fields', allowArgs: true },
  'tr': { description: 'Translate characters', allowArgs: true },
  'sed': { description: 'Stream editor', allowArgs: true },
  'awk': { description: 'Text processing', allowArgs: true },
  'jq': { description: 'JSON processor', allowArgs: true },
  
  // Disk info
  'df': { description: 'Disk space usage', allowArgs: true },
  'du': { description: 'Directory size', allowArgs: true },
  'diskutil': { description: 'Disk utility', allowArgs: true, argPattern: /^(list|info)/ },
  
  // Process info
  'ps': { description: 'Process status', allowArgs: true },
  'top': { description: 'Process monitor', allowArgs: true, argPattern: /^-l\s*\d+/ },
  
  // Network
  'ifconfig': { description: 'Network interfaces', allowArgs: true },
  'ping': { description: 'Ping host', allowArgs: true },
  'host': { description: 'DNS lookup', allowArgs: true },
  'dig': { description: 'DNS lookup', allowArgs: true },
  'curl': { description: 'HTTP requests (GET only)', allowArgs: true },
  'wget': { description: 'Download files', allowArgs: true },
  
  // Dev tools (read-only)
  'git': { description: 'Git commands', allowArgs: true, argPattern: /^(status|log|diff|branch|remote|show|ls-files|rev-parse)/ },
  'node': { description: 'Node.js', allowArgs: true },
  'npm': { description: 'npm', allowArgs: true, argPattern: /^(list|ls|outdated|version|--version|run|test)/ },
  'python3': { description: 'Python', allowArgs: true },
  
  // Simple output
  'echo': { description: 'Print text', allowArgs: true },
  'printf': { description: 'Print formatted', allowArgs: true },
  
  // Database
  'sqlite3': { description: 'SQLite database', allowArgs: true },
};

/**
 * Commands that are safe for use in pipes
 */
export const PIPEABLE_COMMANDS = new Set([
  'grep', 'sort', 'uniq', 'cut', 'tr', 'sed', 'awk', 'jq', 'head', 'tail', 'wc', 'cat'
]);

/**
 * Dangerous patterns that should never be allowed
 */
export const DANGEROUS_PATTERNS = [
  /rm\s+(-rf?|--recursive)/, // rm -r, rm -rf
  /rm\s+.*[/*]/, // rm with wildcards or paths
  /sudo/,
  /su\s/,
  /chmod\s+777/,
  /mkfs/,
  /dd\s+/,
  />\s*\/dev\//, // writing to devices
  /\/etc\/passwd/,
  /\/etc\/shadow/,
  /\|\s*sh/,
  /\|\s*bash/,
  /`.*`/, // backtick execution
  /\$\(.*\)/, // command substitution
  /&&\s*(rm|sudo|su|chmod|chown)/,
  /;\s*(rm|sudo|su|chmod|chown)/,
];

/**
 * Validate and parse a shell command (supports pipes between safe commands)
 */
export function validateShellCommand(fullCommand: string): { command: string; args: string[]; error?: string; useShell?: boolean } {
  const trimmed = fullCommand.trim();
  
  // Check for dangerous patterns first
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { command: '', args: [], error: `Blocked: dangerous pattern detected` };
    }
  }
  
  // Check for blocked paths
  if (containsBlockedPath([trimmed])) {
    return { command: '', args: [], error: `Blocked: access to sensitive paths not allowed` };
  }
  
  // Check if this is a piped command
  if (trimmed.includes('|')) {
    const pipeSegments = trimmed.split('|').map(s => s.trim());
    
    // Validate each segment of the pipe
    for (let i = 0; i < pipeSegments.length; i++) {
      const segment = pipeSegments[i];
      const parts = segment.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
      if (parts.length === 0 || !parts[0]) {
        return { command: '', args: [], error: 'Empty command in pipe' };
      }
      
      const cmd = parts[0];
      const config = SAFE_SHELL_COMMANDS[cmd];
      
      if (!config) {
        return { command: '', args: [], error: `Command "${cmd}" not in safe list` };
      }
      
      // For pipe destinations (not first command), must be pipeable
      if (i > 0 && !PIPEABLE_COMMANDS.has(cmd)) {
        return { command: '', args: [], error: `Command "${cmd}" cannot be used in a pipe` };
      }
      
      // Check arg pattern if specified
      const argsString = parts.slice(1).join(' ');
      if (config.argPattern && argsString && !config.argPattern.test(argsString)) {
        return { command: '', args: [], error: `Arguments not allowed for "${cmd}"` };
      }
    }
    
    // All pipe segments validated - execute via shell
    return { command: '/bin/sh', args: ['-c', trimmed], useShell: true };
  }
  
  // Simple command (no pipe)
  const parts = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  if (parts.length === 0 || !parts[0]) {
    return { command: '', args: [], error: 'Empty command' };
  }
  
  const command: string = parts[0];
  const args = parts.slice(1).map(arg => 
    arg.replace(/^["']|["']$/g, '') // Remove surrounding quotes
  );
  const argsString = parts.slice(1).join(' ');
  
  // Check if command is in allowlist
  const config = SAFE_SHELL_COMMANDS[command];
  if (!config) {
    const available = Object.keys(SAFE_SHELL_COMMANDS).slice(0, 10).join(', ') + '...';
    return { 
      command: '', 
      args: [], 
      error: `Command "${command}" not in safe list. Examples: ${available}` 
    };
  }
  
  // Check if args are allowed
  if (args.length > 0 && !config.allowArgs) {
    return { command: '', args: [], error: `Command "${command}" does not accept arguments` };
  }
  
  // Check arg pattern if specified
  if (config.argPattern && argsString && !config.argPattern.test(argsString)) {
    return { command: '', args: [], error: `Arguments not allowed for "${command}": ${argsString}` };
  }
  
  return { command, args };
}
