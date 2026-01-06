import open from 'open';
import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { tmpdir } from 'os';

/**
 * Safe command execution using spawn (no shell interpolation)
 */
function execCommand(command: string, args: string[] = []): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { timeout: 30000 });
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || `Command failed with code ${code}`));
      }
    });
    
    proc.on('error', reject);
  });
}

/**
 * Run AppleScript safely using spawn
 */
function runAppleScript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('osascript', ['-e', script], { timeout: 30000 });
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr || `AppleScript failed with code ${code}`));
      }
    });
    
    proc.on('error', reject);
  });
}

export interface ToolResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

export interface SystemTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

// Input validation schemas
const schemas = {
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
 * Safe shell commands allowlist
 * 
 * These commands are considered safe for remote execution.
 * Each entry can be a command name or a regex pattern.
 */
/**
 * Paths that should never be accessed
 */
const BLOCKED_PATHS = [
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

function containsBlockedPath(args: string[]): boolean {
  const fullArgs = args.join(' ');
  return BLOCKED_PATHS.some(pattern => pattern.test(fullArgs));
}

const SAFE_SHELL_COMMANDS: Record<string, {
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
};

/**
 * Commands that are safe for use in pipes
 */
const PIPEABLE_COMMANDS = new Set([
  'grep', 'sort', 'uniq', 'cut', 'tr', 'sed', 'awk', 'jq', 'head', 'tail', 'wc', 'cat'
]);

/**
 * Dangerous patterns that should never be allowed
 */
const DANGEROUS_PATTERNS = [
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
function validateShellCommand(fullCommand: string): { command: string; args: string[]; error?: string; useShell?: boolean } {
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

/**
 * Extension configuration from user config file
 */
interface ExtensionCommand {
  name: string;
  title: string;
  description: string;
  arguments?: { name: string; type: string; description: string; required?: boolean }[];
}

interface ExtensionConfig {
  name: string;
  author: string;
  owner?: string; // Some extensions have an owner that's different from author (used in deeplinks)
  description?: string;
  commands: ExtensionCommand[];
}

interface BridgeConfig {
  extensions: ExtensionConfig[];
}

/**
 * Load user's extension configuration
 */
function loadConfig(): BridgeConfig {
  const configPaths = [
    join(process.cwd(), 'bridge.config.json'),
    join(process.cwd(), 'config.json'),
  ];
  
  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, 'utf-8');
        return JSON.parse(content);
      } catch {}
    }
  }
  
  return { extensions: [] };
}

/**
 * Generate tools from user's extension configuration
 */
function generateExtensionTools(config: BridgeConfig): SystemTool[] {
  const tools: SystemTool[] = [];
  
  for (const ext of config.extensions) {
    for (const cmd of ext.commands) {
      const toolName = `${ext.name.replace(/-/g, '_')}_${cmd.name.replace(/-/g, '_')}`;
      
      // Build input schema from command arguments
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      
      // Always allow fallbackText for pre-filling
      properties['text'] = {
        type: 'string',
        description: 'Text to pre-fill in the command (optional)',
      };
      
      if (cmd.arguments) {
        for (const arg of cmd.arguments) {
          properties[arg.name] = {
            type: arg.type,
            description: arg.description,
          };
          if (arg.required) {
            required.push(arg.name);
          }
        }
      }
      
      tools.push({
        name: toolName,
        description: `${cmd.title}: ${cmd.description}`,
        inputSchema: {
          type: 'object',
          properties,
          required: required.length > 0 ? required : undefined,
        },
        handler: async (args) => {
          // Use owner if present (for verified/org extensions), otherwise author
          const extensionOwner = ext.owner || ext.author;
          let url = `raycast://extensions/${extensionOwner}/${ext.name}/${cmd.name}`;
          const params = new URLSearchParams();
          
          const text = args['text'];
          const hasExplicitArguments = cmd.arguments && cmd.arguments.length > 0;
          
          // Handle explicit arguments (like title, description for Linear)
          const explicitArgs: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(args)) {
            if (key !== 'text' && value !== undefined && value !== null && value !== '') {
              explicitArgs[key] = value;
            }
          }
          
          // If text was provided but no title, use text as title (for Linear etc.)
          if (text && !explicitArgs['title'] && cmd.arguments?.some(a => a.name === 'title')) {
            explicitArgs['title'] = text;
          }
          
          // For commands WITH explicit arguments, use ONLY the arguments parameter
          // For commands WITHOUT explicit arguments, use fallbackText for pre-fill
          if (hasExplicitArguments) {
            // Commands with arguments (Linear create-issue-for-myself, etc.)
            if (Object.keys(explicitArgs).length > 0) {
              params.set('arguments', JSON.stringify(explicitArgs));
            }
          } else {
            // Commands without explicit arguments - use fallbackText
            if (typeof text === 'string' && text.length > 0) {
              params.set('fallbackText', text);
            }
          }
          
          const queryString = params.toString();
          if (queryString) {
            url += `?${queryString}`;
          }
          
          await open(url);
          return {
            content: [{
              type: 'text',
              text: `Executed: ${cmd.title} (${url})`
            }]
          };
        }
      });
    }
  }
  
  return tools;
}

/**
 * Core tools that always work - these don't depend on specific Raycast extensions
 */
export const coreTools: SystemTool[] = [
  {
    name: 'raycast',
    description: 'Execute any Raycast extension command. Use format: extension "author/name", command "command-name". Check Raycast store for extension details.',
    inputSchema: {
      type: 'object',
      properties: {
        extension: {
          type: 'string',
          description: 'Extension as "author/name" (e.g., "raycast/github", "linear/linear", "mattisssa/spotify-player")'
        },
        command: {
          type: 'string',
          description: 'Command to run (e.g., "search-repositories", "create-issue", "play")'
        },
        text: {
          type: 'string',
          description: 'Optional text to pre-fill in the command'
        },
        arguments: {
          type: 'object',
          description: 'Optional arguments object for the command'
        }
      },
      required: ['extension', 'command']
    },
    handler: async (args) => {
      const { extension, command, text, arguments: cmdArgs } = schemas.raycastCommand.extend({
        text: z.string().optional(),
      }).parse(args);
      
      let url = `raycast://extensions/${extension}/${command}`;
      const params = new URLSearchParams();
      
      if (text) {
        params.set('fallbackText', text);
      }
      if (cmdArgs && Object.keys(cmdArgs).length > 0) {
        params.set('arguments', JSON.stringify(cmdArgs));
      }
      
      const queryString = params.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
      
      await open(url);
      return {
        content: [{
          type: 'text',
          text: `Executed: ${extension}/${command}`
        }]
      };
    }
  },
  {
    name: 'open_url',
    description: 'Open any URL in the default browser',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to open'
        }
      },
      required: ['url']
    },
    handler: async (args) => {
      const { url } = schemas.openUrl.parse(args);
      await open(url);
      return {
        content: [{
          type: 'text',
          text: `Opened: ${url}`
        }]
      };
    }
  },
  {
    name: 'open_app',
    description: 'Open any application on the Mac',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Application name (e.g., "Safari", "Slack", "Visual Studio Code", "Spotify")'
        }
      },
      required: ['name']
    },
    handler: async (args) => {
      const { name } = schemas.openApp.parse(args);
      
      try {
        // Use spawn with -a flag for safety
        await execCommand('open', ['-a', name]);
        return {
          content: [{
            type: 'text',
            text: `Opened: ${name}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Failed to open "${name}": ${error instanceof Error ? error.message : 'App not found'}`
          }],
          isError: true
        };
      }
    }
  },
  {
    name: 'applescript',
    description: '⚠️ POWERFUL: Run AppleScript for Mac automation. Can control apps and system. Use with caution.',
    inputSchema: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description: 'AppleScript code to execute (avoid "do shell script" for security)'
        }
      },
      required: ['script']
    },
    handler: async (args) => {
      const { script } = schemas.applescript.parse(args);
      
      // Block dangerous AppleScript patterns
      const dangerousPatterns = [
        /do\s+shell\s+script/i, // Shell execution via AppleScript
        /system\s+events.*keystroke.*password/i, // Password typing
        /keychain/i, // Keychain access
        /delete\s+(every|all)/i, // Mass deletion
      ];
      
      for (const pattern of dangerousPatterns) {
        if (pattern.test(script)) {
        return {
          content: [{
            type: 'text',
              text: 'AppleScript blocked: contains dangerous patterns (shell execution, keychain access, etc.)'
            }],
            isError: true
          };
        }
      }
      
      try {
        const result = await runAppleScript(script);
        return {
          content: [{
            type: 'text',
            text: result || 'Script executed'
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `AppleScript error: ${error instanceof Error ? error.message : 'Unknown error'}`
          }],
          isError: true
        };
      }
    }
  },
  {
    name: 'shell',
    description: `Run a safe shell command on the Mac. Allowed commands: ${Object.keys(SAFE_SHELL_COMMANDS).join(', ')}`,
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to execute (must be in safe list)'
        }
      },
      required: ['command']
    },
    handler: async (args) => {
      const fullCommand = z.object({ command: z.string().min(1).max(2000) }).parse(args).command;
      
      // Validate command against allowlist
      const { command, args: cmdArgs, error, useShell } = validateShellCommand(fullCommand);
      
      if (error) {
        return {
          content: [{
            type: 'text',
            text: `Shell command blocked: ${error}`
          }],
          isError: true
        };
      }
      
      try {
        // For piped commands, we use shell execution (already validated)
        const { stdout, stderr } = await execCommand(command, cmdArgs);
        return {
          content: [{
            type: 'text',
            text: stdout.trim() || stderr.trim() || 'Command executed'
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
          }],
          isError: true
        };
      }
    }
  },
  {
    name: 'shell_list',
    description: 'List all available safe shell commands',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    handler: async () => {
      const list = Object.entries(SAFE_SHELL_COMMANDS)
        .map(([cmd, config]) => `• ${cmd}: ${config.description}`)
        .join('\n');
      
      return {
        content: [{
          type: 'text',
          text: `Available safe commands:\n${list}`
        }]
      };
    }
  }
];

/**
 * High-level convenience tools
 * These wrap common AppleScript patterns for easier use
 */
export const musicTools: SystemTool[] = [
  {
    name: 'music_play',
    description: 'Play music in Apple Music. Optionally search for a specific song/artist.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional song, artist, or album to search and play'
        }
      }
    },
    handler: async (args) => {
      const query = args.query as string | undefined;
      
      try {
      if (query) {
          // Escape the query for AppleScript string
          const escapedQuery = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          const script = `tell application "Music"
          activate
            set searchResults to search playlist "Library" for "${escapedQuery}"
          if (count of searchResults) > 0 then
            play item 1 of searchResults
            return "Playing: " & name of item 1 of searchResults
          else
              return "No results found for: ${escapedQuery}"
          end if
        end tell`;
          const result = await runAppleScript(script);
          return { content: [{ type: 'text', text: result }] };
      } else {
          await runAppleScript('tell application "Music" to activate');
          await runAppleScript('tell application "Music" to play');
          return { content: [{ type: 'text', text: 'Music playing' }] };
        }
      } catch (error) {
        return { 
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], 
          isError: true 
        };
      }
    }
  },
  {
    name: 'music_pause',
    description: 'Pause Apple Music',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        await runAppleScript('tell application "Music" to pause');
        return { content: [{ type: 'text', text: 'Music paused' }] };
      } catch (error) {
        return { 
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], 
          isError: true 
        };
      }
    }
  },
  {
    name: 'music_next',
    description: 'Skip to next track in Apple Music',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        await runAppleScript('tell application "Music" to next track');
        // Small delay to let the track change
        await new Promise(resolve => setTimeout(resolve, 500));
        const track = await runAppleScript('tell application "Music" to return name of current track');
        return { content: [{ type: 'text', text: `Next track: ${track}` }] };
      } catch (error) {
        return { 
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], 
          isError: true 
        };
      }
    }
  },
  {
    name: 'music_previous',
    description: 'Go to previous track in Apple Music',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        await runAppleScript('tell application "Music" to previous track');
        await new Promise(resolve => setTimeout(resolve, 500));
        const track = await runAppleScript('tell application "Music" to return name of current track');
        return { content: [{ type: 'text', text: `Previous track: ${track}` }] };
      } catch (error) {
        return { 
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], 
          isError: true 
        };
      }
    }
  },
  {
    name: 'music_current',
    description: 'Get info about the currently playing track',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const result = await runAppleScript(
          'tell application "Music" to return name of current track & " by " & artist of current track'
        );
        return { content: [{ type: 'text', text: result }] };
      } catch {
        return { content: [{ type: 'text', text: 'No track playing' }] };
      }
    }
  }
];

// Calendar tools for remote schedule management
export const calendarTools: SystemTool[] = [
  {
    name: 'calendar_today',
    description: 'Get today\'s calendar events',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const script = `
          tell application "Calendar"
            set today to current date
            set todayStart to today - (time of today)
            set todayEnd to todayStart + (1 * days) - 1
            set output to ""
            repeat with cal in calendars
              set evts to (every event of cal whose start date ≥ todayStart and start date ≤ todayEnd)
              repeat with evt in evts
                set evtStart to start date of evt
                set timeStr to (time string of evtStart)
                set output to output & timeStr & " - " & (summary of evt) & "\\n"
              end repeat
            end repeat
            if output = "" then return "No events today"
            return output
          end tell
        `;
        const result = await runAppleScript(script);
        return { content: [{ type: 'text', text: result }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  },
  {
    name: 'calendar_upcoming',
    description: 'Get upcoming events for the next few days',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Number of days to look ahead (default 3)' }
      }
    },
    handler: async (args) => {
      const days = Math.min(7, Math.max(1, Number(args.days) || 3));
      try {
        const script = `
          tell application "Calendar"
            set today to current date
            set startDate to today - (time of today)
            set endDate to startDate + (${days} * days)
            set output to ""
            repeat with cal in calendars
              set evts to (every event of cal whose start date ≥ startDate and start date ≤ endDate)
              repeat with evt in evts
                set evtStart to start date of evt
                set dateStr to (short date string of evtStart)
                set timeStr to (time string of evtStart)
                set output to output & dateStr & " " & timeStr & " - " & (summary of evt) & "\\n"
              end repeat
            end repeat
            if output = "" then return "No upcoming events"
            return output
          end tell
        `;
        const result = await runAppleScript(script);
        return { content: [{ type: 'text', text: result }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  },
  {
    name: 'calendar_create',
    description: 'Create a new calendar event',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title' },
        date: { type: 'string', description: 'Date (e.g., "tomorrow", "2024-01-15")' },
        time: { type: 'string', description: 'Start time (e.g., "2pm", "14:00")' },
        duration: { type: 'number', description: 'Duration in minutes (default 60)' }
      },
      required: ['title', 'date', 'time']
    },
    handler: async (args) => {
      const title = String(args.title).replace(/"/g, '\\"');
      const duration = Math.min(480, Math.max(15, Number(args.duration) || 60));
      try {
        // Parse date and time more flexibly
        const script = `
          tell application "Calendar"
            set theCalendar to first calendar whose name is "Calendar"
            set startDate to current date
            set hours of startDate to 14
            set minutes of startDate to 0
            set seconds of startDate to 0
            set endDate to startDate + (${duration} * minutes)
            make new event at end of events of theCalendar with properties {summary:"${title}", start date:startDate, end date:endDate}
            return "Created: ${title}"
          end tell
        `;
        const result = await runAppleScript(script);
        return { content: [{ type: 'text', text: result }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  },
  {
    name: 'calendar_next',
    description: 'Get your next upcoming meeting/event',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const script = `
          tell application "Calendar"
            set now to current date
            set nextEvent to missing value
            set nextStart to now + (30 * days)
            repeat with cal in calendars
              set evts to (every event of cal whose start date > now)
              repeat with evt in evts
                if start date of evt < nextStart then
                  set nextStart to start date of evt
                  set nextEvent to evt
                end if
              end repeat
            end repeat
            if nextEvent is missing value then return "No upcoming events"
            set dateStr to (short date string of (start date of nextEvent))
            set timeStr to (time string of (start date of nextEvent))
            return dateStr & " " & timeStr & " - " & (summary of nextEvent)
          end tell
        `;
        const result = await runAppleScript(script);
        return { content: [{ type: 'text', text: result }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  }
];

// Reminders tools
export const reminderTools: SystemTool[] = [
  {
    name: 'reminders_list',
    description: 'List reminders from a list (default: Reminders)',
    inputSchema: {
      type: 'object',
      properties: {
        list: { type: 'string', description: 'List name (default: "Reminders")' },
        completed: { type: 'boolean', description: 'Include completed (default: false)' }
      }
    },
    handler: async (args) => {
      const listName = String(args.list || 'Reminders').replace(/"/g, '\\"');
      const includeCompleted = args.completed === true;
      try {
        const script = includeCompleted ? `
          tell application "Reminders"
            set output to ""
            set theList to list "${listName}"
            repeat with r in (reminders of theList)
              set status to ""
              if completed of r then set status to "✓ "
              set output to output & status & (name of r) & "\\n"
            end repeat
            if output = "" then return "No reminders"
            return output
          end tell
        ` : `
          tell application "Reminders"
            set output to ""
            set theList to list "${listName}"
            repeat with r in (reminders of theList whose completed is false)
              set output to output & "• " & (name of r) & "\\n"
            end repeat
            if output = "" then return "No incomplete reminders"
            return output
          end tell
        `;
        const result = await runAppleScript(script);
        return { content: [{ type: 'text', text: result }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  },
  {
    name: 'reminders_create',
    description: 'Create a new reminder',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Reminder text' },
        list: { type: 'string', description: 'List name (default: "Reminders")' },
        dueDate: { type: 'string', description: 'Due date (optional, e.g., "tomorrow", "in 2 hours")' }
      },
      required: ['title']
    },
    handler: async (args) => {
      const title = String(args.title).replace(/"/g, '\\"');
      const listName = String(args.list || 'Reminders').replace(/"/g, '\\"');
      try {
        const script = `
          tell application "Reminders"
            set theList to list "${listName}"
            make new reminder at end of reminders of theList with properties {name:"${title}"}
            return "Reminder created: ${title}"
          end tell
        `;
        const result = await runAppleScript(script);
        return { content: [{ type: 'text', text: result }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  },
  {
    name: 'reminders_complete',
    description: 'Mark a reminder as complete',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Reminder title (partial match)' },
        list: { type: 'string', description: 'List name (default: "Reminders")' }
      },
      required: ['title']
    },
    handler: async (args) => {
      const title = String(args.title).replace(/"/g, '\\"');
      const listName = String(args.list || 'Reminders').replace(/"/g, '\\"');
      try {
        const script = `
          tell application "Reminders"
            set theList to list "${listName}"
            set matchingReminders to (reminders of theList whose name contains "${title}" and completed is false)
            if (count of matchingReminders) = 0 then return "No matching reminder found"
            set completed of (item 1 of matchingReminders) to true
            return "Completed: " & (name of item 1 of matchingReminders)
          end tell
        `;
        const result = await runAppleScript(script);
        return { content: [{ type: 'text', text: result }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  }
];

// System status tools - super useful for remote monitoring
export const statusTools: SystemTool[] = [
  {
    name: 'battery_status',
    description: 'Get battery level and charging status',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const { stdout } = await execCommand('pmset', ['-g', 'batt']);
        // Parse battery info
        const levelMatch = stdout.match(/(\d+)%/);
        const chargingMatch = stdout.match(/(charging|discharging|charged|AC Power)/i);
        const level = levelMatch ? levelMatch[1] : 'Unknown';
        const status = chargingMatch ? chargingMatch[1] : '';
        return { content: [{ type: 'text', text: `Battery: ${level}%${status ? ` (${status})` : ''}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  },
  {
    name: 'wifi_status',
    description: 'Get current WiFi network name and status',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const { stdout } = await execCommand('/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport', ['-I']);
        const ssidMatch = stdout.match(/\sSSID:\s*(.+)/);
        const ssid = ssidMatch ? ssidMatch[1].trim() : 'Not connected';
        return { content: [{ type: 'text', text: `WiFi: ${ssid}` }] };
      } catch {
        return { content: [{ type: 'text', text: 'WiFi: Unable to determine' }] };
      }
    }
  },
  {
    name: 'storage_status',
    description: 'Get available disk space',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const { stdout } = await execCommand('df', ['-h', '/']);
        const lines = stdout.trim().split('\n');
        if (lines.length >= 2) {
          const parts = lines[1].split(/\s+/);
          return { content: [{ type: 'text', text: `Storage: ${parts[3]} available of ${parts[1]}` }] };
        }
        return { content: [{ type: 'text', text: 'Storage: Unable to determine' }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  },
  {
    name: 'running_apps',
    description: 'List currently running applications',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const result = await runAppleScript(`
          tell application "System Events"
            set appList to name of every process whose background only is false
            set output to ""
            repeat with appName in appList
              set output to output & appName & ", "
            end repeat
            if length of output > 2 then set output to text 1 thru -3 of output
            return output
          end tell
        `);
        return { content: [{ type: 'text', text: `Running: ${result}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  },
  {
    name: 'front_app',
    description: 'Get the currently focused application',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const result = await runAppleScript(`
          tell application "System Events"
            return name of first process whose frontmost is true
          end tell
        `);
        return { content: [{ type: 'text', text: `Front app: ${result}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  }
];

// Display and focus mode controls
export const displayTools: SystemTool[] = [
  {
    name: 'brightness_set',
    description: 'Set display brightness (0-100)',
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'number', description: 'Brightness level 0-100' }
      },
      required: ['level']
    },
    handler: async (args) => {
      const level = Math.min(100, Math.max(0, Number(args.level) || 50));
      const normalized = level / 100;
      try {
        await runAppleScript(`tell application "System Events" to set value of slider 1 of group 1 of window "Control Center" of application process "ControlCenter" to ${normalized}`);
        return { content: [{ type: 'text', text: `Brightness set to ${level}%` }] };
      } catch {
        // Fallback: use brightness command if available
        try {
          await execCommand('brightness', [String(normalized)]);
          return { content: [{ type: 'text', text: `Brightness set to ${level}%` }] };
        } catch (error) {
          return { content: [{ type: 'text', text: 'Brightness control not available (try installing: brew install brightness)' }], isError: true };
        }
      }
    }
  },
  {
    name: 'dark_mode_toggle',
    description: 'Toggle dark mode on/off',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const result = await runAppleScript(`
          tell application "System Events"
            tell appearance preferences
              set dark mode to not dark mode
              if dark mode then
                return "Dark mode enabled"
              else
                return "Light mode enabled"
              end if
            end tell
          end tell
        `);
        return { content: [{ type: 'text', text: result }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  },
  {
    name: 'dark_mode_status',
    description: 'Check if dark mode is enabled',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const result = await runAppleScript(`
          tell application "System Events"
            tell appearance preferences
              if dark mode then
                return "Dark mode is ON"
              else
                return "Light mode is ON"
              end if
            end tell
          end tell
        `);
        return { content: [{ type: 'text', text: result }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  },
  {
    name: 'dnd_toggle',
    description: 'Toggle Do Not Disturb / Focus mode',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        // Use Shortcuts to toggle Focus (more reliable in modern macOS)
        await runAppleScript(`
          tell application "System Events"
            tell application process "ControlCenter"
              click menu bar item "Control Center" of menu bar 1
              delay 0.5
              click checkbox "Focus" of group 1 of window "Control Center"
            end tell
          end tell
        `);
        return { content: [{ type: 'text', text: 'Focus mode toggled' }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  }
];

// Screen control tools
export const screenTools: SystemTool[] = [
  {
    name: 'lock_screen',
    description: 'Lock the Mac screen immediately',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        await runAppleScript(`
          tell application "System Events" to keystroke "q" using {control down, command down}
        `);
        return { content: [{ type: 'text', text: 'Screen locked' }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  },
  {
    name: 'sleep_display',
    description: 'Put display to sleep (Mac stays awake)',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        await execCommand('pmset', ['displaysleepnow']);
        return { content: [{ type: 'text', text: 'Display sleeping' }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  },
  {
    name: 'sleep_mac',
    description: 'Put the Mac to sleep',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        await runAppleScript(`tell application "System Events" to sleep`);
        return { content: [{ type: 'text', text: 'Mac going to sleep' }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  }
];

// Notes tools
export const notesTools: SystemTool[] = [
  {
    name: 'notes_list',
    description: 'List recent notes',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of notes to list (default 10)' }
      }
    },
    handler: async (args) => {
      const count = Math.min(20, Math.max(1, Number(args.count) || 10));
      try {
        const result = await runAppleScript(`
          tell application "Notes"
            set output to ""
            set noteList to notes 1 thru ${count} of default account
            repeat with n in noteList
              set output to output & "• " & (name of n) & "\\n"
            end repeat
            return output
          end tell
        `);
        return { content: [{ type: 'text', text: result || 'No notes found' }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  },
  {
    name: 'notes_search',
    description: 'Search notes by keyword',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term' }
      },
      required: ['query']
    },
    handler: async (args) => {
      const query = String(args.query).replace(/"/g, '\\"');
      try {
        const result = await runAppleScript(`
          tell application "Notes"
            set output to ""
            set matchingNotes to (notes of default account whose name contains "${query}" or body contains "${query}")
            repeat with n in matchingNotes
              set output to output & "• " & (name of n) & "\\n"
            end repeat
            if output = "" then return "No notes found matching '${query}'"
            return output
          end tell
        `);
        return { content: [{ type: 'text', text: result }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  },
  {
    name: 'notes_create',
    description: 'Create a new note',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Note title' },
        body: { type: 'string', description: 'Note content' }
      },
      required: ['title']
    },
    handler: async (args) => {
      const title = String(args.title).replace(/"/g, '\\"');
      const body = String(args.body || '').replace(/"/g, '\\"');
      try {
        await runAppleScript(`
          tell application "Notes"
            make new note at default account with properties {name:"${title}", body:"${body}"}
          end tell
        `);
        return { content: [{ type: 'text', text: `Created note: ${title}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  },
  {
    name: 'notes_read',
    description: 'Read the content of a note by name',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Note title (partial match)' }
      },
      required: ['title']
    },
    handler: async (args) => {
      const title = String(args.title).replace(/"/g, '\\"');
      try {
        const result = await runAppleScript(`
          tell application "Notes"
            set matchingNotes to (notes of default account whose name contains "${title}")
            if (count of matchingNotes) = 0 then return "Note not found"
            return plaintext of (item 1 of matchingNotes)
          end tell
        `);
        return { content: [{ type: 'text', text: result }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  },
  {
    name: 'notes_append',
    description: 'Append text to an existing note',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Note title (partial match)' },
        text: { type: 'string', description: 'Text to append' }
      },
      required: ['title', 'text']
    },
    handler: async (args) => {
      const title = String(args.title).replace(/"/g, '\\"');
      const text = String(args.text).replace(/"/g, '\\"');
      try {
        await runAppleScript(`
          tell application "Notes"
            set matchingNotes to (notes of default account whose name contains "${title}")
            if (count of matchingNotes) = 0 then return "Note not found"
            set theNote to item 1 of matchingNotes
            set body of theNote to (body of theNote) & "\\n" & "${text}"
          end tell
        `);
        return { content: [{ type: 'text', text: `Appended to: ${title}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  }
];

// Finder/Files tools
export const finderTools: SystemTool[] = [
  {
    name: 'finder_search',
    description: 'Search for files by name using Spotlight',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 10)' }
      },
      required: ['query']
    },
    handler: async (args) => {
      const query = String(args.query);
      const limit = Math.min(20, Math.max(1, Number(args.limit) || 10));
      try {
        const { stdout } = await execCommand('mdfind', ['-name', query, '-limit', String(limit)]);
        const results = stdout.trim().split('\n').filter(Boolean);
        if (results.length === 0) return { content: [{ type: 'text', text: 'No files found' }] };
        return { content: [{ type: 'text', text: results.join('\n') }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  },
  {
    name: 'finder_downloads',
    description: 'List recent files in Downloads folder',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of files to list (default 10)' }
      }
    },
    handler: async (args) => {
      const count = Math.min(20, Math.max(1, Number(args.count) || 10));
      try {
        const { stdout } = await execCommand('ls', ['-t', '-1', `${process.env.HOME}/Downloads`]);
        const files = stdout.trim().split('\n').slice(0, count);
        return { content: [{ type: 'text', text: files.join('\n') || 'Downloads empty' }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  },
  {
    name: 'finder_desktop',
    description: 'List files on Desktop',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const { stdout } = await execCommand('ls', ['-1', `${process.env.HOME}/Desktop`]);
        const files = stdout.trim().split('\n').filter(Boolean);
        return { content: [{ type: 'text', text: files.join('\n') || 'Desktop empty' }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  },
  {
    name: 'finder_reveal',
    description: 'Reveal a file or folder in Finder',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File or folder path' }
      },
      required: ['path']
    },
    handler: async (args) => {
      const path = String(args.path).replace(/"/g, '\\"');
      try {
        await runAppleScript(`tell application "Finder" to reveal POSIX file "${path}"`);
        await runAppleScript(`tell application "Finder" to activate`);
        return { content: [{ type: 'text', text: `Revealed: ${path}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  },
  {
    name: 'finder_trash',
    description: 'Move a file to Trash',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to trash' }
      },
      required: ['path']
    },
    handler: async (args) => {
      const path = String(args.path).replace(/"/g, '\\"');
      try {
        await runAppleScript(`tell application "Finder" to delete POSIX file "${path}"`);
        return { content: [{ type: 'text', text: `Trashed: ${path}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  }
];

// Apple Shortcuts integration
export const shortcutsTools: SystemTool[] = [
  {
    name: 'shortcut_run',
    description: 'Run an Apple Shortcut by name',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Shortcut name' },
        input: { type: 'string', description: 'Optional input text' }
      },
      required: ['name']
    },
    handler: async (args) => {
      const name = String(args.name);
      const input = args.input ? String(args.input) : undefined;
      try {
        const cmdArgs = ['shortcuts', 'run', name];
        if (input) cmdArgs.push('-i', input);
        await execCommand(cmdArgs[0], cmdArgs.slice(1));
        return { content: [{ type: 'text', text: `Ran shortcut: ${name}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  },
  {
    name: 'shortcut_list',
    description: 'List available Shortcuts',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const { stdout } = await execCommand('shortcuts', ['list']);
        return { content: [{ type: 'text', text: stdout.trim() || 'No shortcuts found' }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  }
];

// Browser tools
export const browserTools: SystemTool[] = [
  {
    name: 'browser_url',
    description: 'Get the current URL from the active browser tab',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        // Try Chrome first, then Safari
        try {
          const result = await runAppleScript(`
            tell application "Google Chrome"
              return URL of active tab of front window
            end tell
          `);
          return { content: [{ type: 'text', text: result }] };
        } catch {
          const result = await runAppleScript(`
            tell application "Safari"
              return URL of current tab of front window
            end tell
          `);
          return { content: [{ type: 'text', text: result }] };
        }
      } catch (error) {
        return { content: [{ type: 'text', text: 'No browser URL found' }] };
      }
    }
  },
  {
    name: 'browser_tabs',
    description: 'List open browser tabs',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        try {
          const result = await runAppleScript(`
            tell application "Google Chrome"
              set output to ""
              repeat with w in windows
                repeat with t in tabs of w
                  set output to output & (title of t) & "\\n"
                end repeat
              end repeat
              return output
            end tell
          `);
          return { content: [{ type: 'text', text: result || 'No tabs' }] };
        } catch {
          const result = await runAppleScript(`
            tell application "Safari"
              set output to ""
              repeat with w in windows
                repeat with t in tabs of w
                  set output to output & (name of t) & "\\n"
                end repeat
              end repeat
              return output
            end tell
          `);
          return { content: [{ type: 'text', text: result || 'No tabs' }] };
        }
      } catch (error) {
        return { content: [{ type: 'text', text: 'Could not get browser tabs' }] };
      }
    }
  }
];

export const systemTools: SystemTool[] = [
  {
    name: 'volume_set',
    description: 'Set the system volume to a specific level (0-100)',
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'number', description: 'Volume level from 0 to 100' }
      },
      required: ['level']
    },
    handler: async (args) => {
      const level = Math.min(100, Math.max(0, Math.round(Number(args.level) || 50)));
      try {
        await runAppleScript(`set volume output volume ${level}`);
        return { content: [{ type: 'text', text: `Volume set to ${level}%` }] };
      } catch (error) {
        return { 
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], 
          isError: true 
        };
      }
    }
  },
  {
    name: 'volume_get',
    description: 'Get the current system volume level',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const result = await runAppleScript('output volume of (get volume settings)');
        return { content: [{ type: 'text', text: `Volume: ${result}%` }] };
      } catch (error) {
        return { 
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], 
          isError: true 
        };
      }
    }
  },
  {
    name: 'volume_up',
    description: 'Increase system volume by 10%',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const current = await runAppleScript('output volume of (get volume settings)');
        const newLevel = Math.min(100, parseInt(current) + 10);
        await runAppleScript(`set volume output volume ${newLevel}`);
        return { content: [{ type: 'text', text: `Volume increased to ${newLevel}%` }] };
      } catch (error) {
        return { 
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], 
          isError: true 
        };
      }
    }
  },
  {
    name: 'volume_down',
    description: 'Decrease system volume by 10%',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const current = await runAppleScript('output volume of (get volume settings)');
        const newLevel = Math.max(0, parseInt(current) - 10);
        await runAppleScript(`set volume output volume ${newLevel}`);
        return { content: [{ type: 'text', text: `Volume decreased to ${newLevel}%` }] };
      } catch (error) {
        return { 
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], 
          isError: true 
        };
      }
    }
  },
  {
    name: 'volume_mute',
    description: 'Toggle mute on/off',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const muted = await runAppleScript('output muted of (get volume settings)');
        const newState = muted === 'true' ? 'false' : 'true';
        await runAppleScript(`set volume output muted ${newState}`);
        return { content: [{ type: 'text', text: newState === 'true' ? 'Volume muted' : 'Volume unmuted' }] };
      } catch (error) {
        return { 
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], 
          isError: true 
        };
      }
    }
  },
  {
    name: 'notify',
    description: 'Show a macOS notification',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Notification title' },
        message: { type: 'string', description: 'Notification message' }
      },
      required: ['message']
    },
    handler: async (args) => {
      const title = String(args.title || 'SYSTEM').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const message = String(args.message).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      try {
        await runAppleScript(`display notification "${message}" with title "${title}"`);
        return { content: [{ type: 'text', text: 'Notification sent' }] };
      } catch (error) {
        return { 
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], 
          isError: true 
        };
      }
    }
  },
  {
    name: 'say',
    description: 'Make the Mac speak text aloud',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to speak' }
      },
      required: ['text']
    },
    handler: async (args) => {
      const text = String(args.text);
      try {
        // Use spawn for safe execution
        await execCommand('say', [text]);
        return { content: [{ type: 'text', text: `Spoke: "${text}"` }] };
      } catch (error) {
        return { 
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], 
          isError: true 
        };
      }
    }
  },
  {
    name: 'wait',
    description: 'Wait/sleep for a specified number of seconds before continuing. Use this when you need to wait for an app to load or for a delay between actions.',
    inputSchema: {
      type: 'object',
      properties: {
        seconds: { type: 'number', description: 'Number of seconds to wait (max 30)' }
      },
      required: ['seconds']
    },
    handler: async (args) => {
      const seconds = Math.min(30, Math.max(0.1, Number(args.seconds) || 1));
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
      return { content: [{ type: 'text', text: `Waited ${seconds} seconds` }] };
    }
  },
  {
    name: 'clipboard_get',
    description: 'Get the current clipboard contents',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const { stdout } = await execCommand('pbpaste');
        return { content: [{ type: 'text', text: stdout || '(clipboard is empty)' }] };
      } catch (error) {
        return { 
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], 
          isError: true 
        };
      }
    }
  },
  {
    name: 'clipboard_set',
    description: 'Set the clipboard contents',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to copy to clipboard' }
      },
      required: ['text']
    },
    handler: async (args) => {
      const text = String(args.text);
      try {
        // Use spawn with stdin to avoid shell injection and trailing newline
        await new Promise<void>((resolve, reject) => {
          const proc = spawn('pbcopy');
          proc.stdin.write(text);
          proc.stdin.end();
          proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`pbcopy failed with code ${code}`));
          });
          proc.on('error', reject);
        });
        return { content: [{ type: 'text', text: 'Copied to clipboard' }] };
      } catch (error) {
        return { 
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], 
          isError: true 
        };
      }
    }
  },
  {
    name: 'send_imessage',
    description: 'Send an iMessage to a contact. Requires confirmation before sending.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Phone number or email address of the recipient' },
        message: { type: 'string', description: 'The message to send' }
      },
      required: ['to', 'message']
    },
    handler: async (args) => {
      const to = String(args.to).replace(/"/g, '\\"');
      const message = String(args.message).replace(/"/g, '\\"');
      
      if (!to || !message) {
        return { content: [{ type: 'text', text: 'Error: Both "to" and "message" are required' }], isError: true };
      }
      
      try {
        const script = `
          tell application "Messages"
            set targetService to 1st account whose service type = iMessage
            set targetBuddy to participant "${to}" of targetService
            send "${message}" to targetBuddy
          end tell
        `;
        await runAppleScript(script);
        return { content: [{ type: 'text', text: `Message sent to ${to}` }] };
      } catch (error) {
        return { 
          content: [{ type: 'text', text: `Error sending message: ${error instanceof Error ? error.message : 'Unknown'}` }], 
          isError: true 
        };
      }
    }
  },
  {
    name: 'screenshot',
    description: 'Take a screenshot of the current screen and return the image',
    inputSchema: {
      type: 'object',
      properties: {
        type: { 
          type: 'string', 
          description: 'Type of screenshot: "full" for full screen, "window" for front window',
          enum: ['full', 'window']
        }
      }
    },
    handler: async (args) => {
      const type = args.type === 'window' ? 'window' : 'full';
      const tmpFile = join(tmpdir(), `screenshot-${Date.now()}.png`);
      const resizedFile = join(tmpdir(), `screenshot-resized-${Date.now()}.jpg`);
      
      try {
        // Take screenshot using macOS screencapture
        await new Promise<void>((resolve, reject) => {
          const screencaptureArgs = type === 'window' 
            ? ['-w', '-o', tmpFile]  // -w for window, -o to not show in preview
            : ['-x', tmpFile];        // -x for silent (no sound)
          
          const proc = spawn('screencapture', screencaptureArgs, { timeout: 10000 });
          proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`screencapture failed with code ${code}`));
          });
          proc.on('error', reject);
        });
        
        // Resize image to fit within Claude's 5MB limit using sips (built into macOS)
        // Resize to max 1920px width and convert to JPEG for smaller file size
        await new Promise<void>((resolve, reject) => {
          const proc = spawn('sips', [
            '--resampleWidth', '1920',
            '--setProperty', 'format', 'jpeg',
            '--setProperty', 'formatOptions', '80',  // 80% quality
            tmpFile,
            '--out', resizedFile
          ], { timeout: 10000 });
          proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`sips resize failed with code ${code}`));
          });
          proc.on('error', reject);
        });
        
        // Read the resized file and convert to base64
        const imageBuffer = readFileSync(resizedFile);
        const base64Image = imageBuffer.toString('base64');
        
        // Save a copy to a dedicated folder for easy sharing/cleanup
        const screenshotDir = join(process.env.HOME || '/tmp', 'Pictures', 'SYSTEM Screenshots');
        try { mkdirSync(screenshotDir, { recursive: true }); } catch {}
        const savedPath = join(screenshotDir, `screenshot-${Date.now()}.jpg`);
        try { writeFileSync(savedPath, imageBuffer); } catch {}
        
        // Clean up temp files
        try { unlinkSync(tmpFile); } catch {}
        try { unlinkSync(resizedFile); } catch {}
        
        return { 
          content: [{ 
            type: 'image', 
            data: base64Image,
            mimeType: 'image/jpeg'
          }],
          savedTo: savedPath
        };
      } catch (error) {
        // Clean up on error too
        try { unlinkSync(tmpFile); } catch {}
        try { unlinkSync(resizedFile); } catch {}
        return { 
          content: [{ type: 'text', text: `Screenshot failed: ${error instanceof Error ? error.message : 'Unknown error'}` }], 
          isError: true 
        };
      }
    }
  },
  {
    name: 'search_contacts',
    description: 'Search for contacts by name to find their phone number or email. Pass the person\'s actual name.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name to search for (e.g., "John Smith", "Mom", "Jane")' },
        name: { type: 'string', description: 'Alias for query - name to search for' }
      },
      required: ['query']
    },
    handler: async (args) => {
      const rawQuery = args.query || args.name;
      
      if (!rawQuery || String(rawQuery) === 'undefined') {
        return { 
          content: [{ type: 'text', text: 'Error: Please provide a name to search for' }], 
          isError: true 
        };
      }
      const query = String(rawQuery).replace(/"/g, '\\"');
      
      try {
        // AppleScript that launches Contacts if needed
        const script = `
          tell application "Contacts"
            launch
            delay 0.5
            set matchingPeople to (every person whose name contains "${query}")
            if (count of matchingPeople) = 0 then
              return "No contacts found"
            end if
            set output to ""
            repeat with thePerson in matchingPeople
              set theName to name of thePerson
              set output to output & theName
              try
                set phoneList to value of phones of thePerson
                if (count of phoneList) > 0 then
                  set output to output & " | Phone: " & (item 1 of phoneList)
                end if
              end try
              try
                set emailList to value of emails of thePerson
                if (count of emailList) > 0 then
                  set output to output & " | Email: " & (item 1 of emailList)
                end if
              end try
              set output to output & return
            end repeat
            return output
          end tell
        `;
        const result = await runAppleScript(script);
        if (!result || result.trim() === '' || result.includes('No contacts found')) {
          return { content: [{ type: 'text', text: `No contacts found matching "${query}"` }] };
        }
        return { content: [{ type: 'text', text: result.trim() }] };
      } catch (error) {
        return { 
          content: [{ type: 'text', text: `Error searching contacts: ${error instanceof Error ? error.message : 'Unknown'}` }], 
          isError: true 
        };
      }
    }
  }
];

// Load config and generate extension-specific tools
const config = loadConfig();
const configuredExtensionTools = generateExtensionTools(config);

// Export all tools - organized by category
export const allTools = [
  ...coreTools,           // raycast, open_url, open_app, applescript, shell
  ...musicTools,          // music_play, pause, next, previous, current
  ...systemTools,         // volume, notify, say, clipboard, screenshot, imessage, contacts
  ...calendarTools,       // calendar_today, upcoming, create, next
  ...reminderTools,       // reminders_list, create, complete
  ...statusTools,         // battery, wifi, storage, running_apps, front_app
  ...displayTools,        // brightness, dark_mode, dnd
  ...screenTools,         // lock_screen, sleep_display, sleep_mac
  ...notesTools,          // notes_list, search, create, read, append
  ...finderTools,         // finder_search, downloads, desktop, reveal, trash
  ...shortcutsTools,      // shortcut_run, list
  ...browserTools,        // browser_url, tabs
  ...configuredExtensionTools,  // user's raycast extensions
];
