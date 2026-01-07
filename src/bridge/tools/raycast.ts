/**
 * Raycast Tools - Raycast integration and automation
 */

import open from 'open';
import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { SystemTool, BridgeConfig } from './types.js';
import { runAppleScript } from './utils/command.js';
import { schemas } from './utils/validation.js';

/**
 * Extension configuration types
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
  owner?: string;
  description?: string;
  commands: ExtensionCommand[];
}

/**
 * Load user's extension configuration
 */
export function loadConfig(): BridgeConfig {
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
export function generateExtensionTools(config: BridgeConfig): SystemTool[] {
  const tools: SystemTool[] = [];
  
  if (!config.extensions) return tools;
  
  for (const ext of config.extensions) {
    for (const cmd of ext.commands) {
      const toolName = `${ext.name.replace(/-/g, '_')}_${cmd.name.replace(/-/g, '_')}`;
      
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      
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
          const extensionOwner = ext.owner || ext.author;
          let url = `raycast://extensions/${extensionOwner}/${ext.name}/${cmd.name}`;
          const params = new URLSearchParams();
          
          const text = args['text'];
          const hasExplicitArguments = cmd.arguments && cmd.arguments.length > 0;
          
          const explicitArgs: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(args)) {
            if (key !== 'text' && value !== undefined && value !== null && value !== '') {
              explicitArgs[key] = value;
            }
          }
          
          if (text && !explicitArgs['title'] && cmd.arguments?.some(a => a.name === 'title')) {
            explicitArgs['title'] = text;
          }
          
          if (hasExplicitArguments) {
            if (Object.keys(explicitArgs).length > 0) {
              params.set('arguments', JSON.stringify(explicitArgs));
            }
          } else {
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

export const raycastTools: SystemTool[] = [
  {
    name: 'raycast_search',
    description: 'Open Raycast and type a search query. Raycast will find matching commands, apps, or actions. This is the easiest way to do anything on Mac.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to search for in Raycast (e.g., "tweet hello world", "create note", "play spotify", "open twitter")'
        },
        autoSend: {
          type: 'boolean', 
          description: 'Auto-submit with cmd+enter after a delay (default: true for tweets/posts)'
        }
      },
      required: ['query']
    },
    handler: async (args) => {
      const query = String(args.query);
      const autoSend = args.autoSend !== false;
      
      const url = `raycast://?fallbackText=${encodeURIComponent(query)}`;
      await open(url);
      
      if (autoSend) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        await runAppleScript(`
          tell application "System Events"
            key code 36 using {command down}
          end tell
        `);
      }
      
      return {
        content: [{
          type: 'text',
          text: `Opened Raycast with: "${query}"${autoSend ? ' (auto-sent)' : ''}`
        }]
      };
    }
  },
  {
    name: 'raycast_confetti',
    description: 'Trigger Raycast confetti celebration effect.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      await open('raycast://confetti');
      return { content: [{ type: 'text', text: 'Confetti!' }] };
    }
  },
  {
    name: 'raycast_ai',
    description: 'Ask Raycast AI a question or give it a task.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Question or task for Raycast AI' }
      },
      required: ['prompt']
    },
    handler: async (args) => {
      const prompt = String(args.prompt);
      const url = `raycast://ai?prompt=${encodeURIComponent(prompt)}`;
      await open(url);
      return { content: [{ type: 'text', text: `Asked Raycast AI: "${prompt}"` }] };
    }
  },
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
  }
];
