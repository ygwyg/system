/**
 * Core Tools - Fundamental system operations
 * open_url, open_app, applescript, shell, shell_list
 */

import open from 'open';
import { z } from 'zod';
import type { SystemTool } from './types.js';
import { execCommand, runAppleScript } from './utils/command.js';
import { schemas, validateShellCommand, SAFE_SHELL_COMMANDS } from './utils/validation.js';

export const coreTools: SystemTool[] = [
  {
    name: 'open_url',
    description: 'Open any URL in the default browser',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to open',
        },
      },
      required: ['url'],
    },
    handler: async (args) => {
      const { url } = schemas.openUrl.parse(args);
      await open(url);
      return {
        content: [
          {
            type: 'text',
            text: `Opened: ${url}`,
          },
        ],
      };
    },
  },
  {
    name: 'open_app',
    description: 'Open any application on the Mac',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'Application name (e.g., "Safari", "Slack", "Visual Studio Code", "Spotify")',
        },
      },
      required: ['name'],
    },
    handler: async (args) => {
      const { name } = schemas.openApp.parse(args);

      try {
        await execCommand('open', ['-a', name]);
        return {
          content: [
            {
              type: 'text',
              text: `Opened: ${name}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to open "${name}": ${error instanceof Error ? error.message : 'App not found'}`,
            },
          ],
          isError: true,
        };
      }
    },
  },
  {
    name: 'applescript',
    description:
      '⚠️ POWERFUL: Run AppleScript for Mac automation. Can control apps and system. Use with caution.',
    inputSchema: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description: 'AppleScript code to execute (avoid "do shell script" for security)',
        },
      },
      required: ['script'],
    },
    handler: async (args) => {
      const { script } = schemas.applescript.parse(args);

      // Block dangerous AppleScript patterns
      const dangerousPatterns = [
        /do\s+shell\s+script/i,
        /system\s+events.*keystroke.*password/i,
        /keychain/i,
        /delete\s+(every|all)/i,
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(script)) {
          return {
            content: [
              {
                type: 'text',
                text: 'AppleScript blocked: contains dangerous patterns (shell execution, keychain access, etc.)',
              },
            ],
            isError: true,
          };
        }
      }

      try {
        const result = await runAppleScript(script);
        return {
          content: [
            {
              type: 'text',
              text: result || 'Script executed',
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `AppleScript error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  },
  {
    name: 'shell',
    description: `Run a safe shell command on the Mac. Allowed commands: ${Object.keys(SAFE_SHELL_COMMANDS).join(', ')}`,
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to execute (must be in safe list)',
        },
      },
      required: ['command'],
    },
    handler: async (args) => {
      const fullCommand = z.object({ command: z.string().min(1).max(2000) }).parse(args).command;

      const { command, args: cmdArgs, error } = validateShellCommand(fullCommand);

      if (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Shell command blocked: ${error}`,
            },
          ],
          isError: true,
        };
      }

      try {
        const { stdout, stderr } = await execCommand(command, cmdArgs);
        return {
          content: [
            {
              type: 'text',
              text: stdout.trim() || stderr.trim() || 'Command executed',
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  },
  {
    name: 'shell_list',
    description: 'List all available safe shell commands',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const list = Object.entries(SAFE_SHELL_COMMANDS)
        .map(([cmd, config]) => `• ${cmd}: ${config.description}`)
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Available safe commands:\n${list}`,
          },
        ],
      };
    },
  },
];
