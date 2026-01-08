/**
 * Shortcuts Tools - Apple Shortcuts integration
 */

import type { SystemTool } from './types.js';
import { execCommand } from './utils/command.js';

export const shortcutsTools: SystemTool[] = [
  {
    name: 'shortcut_run',
    description: 'Run an Apple Shortcut by name',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Shortcut name' },
        input: { type: 'string', description: 'Optional input text' },
      },
      required: ['name'],
    },
    handler: async (args) => {
      const name = String(args.name);
      const input = args.input ? String(args.input) : undefined;
      try {
        const cmdArgs = ['run', name];
        if (input) cmdArgs.push('-i', input);
        await execCommand('shortcuts', cmdArgs);
        return { content: [{ type: 'text', text: `Ran shortcut: ${name}` }] };
      } catch (error) {
        return {
          content: [
            { type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` },
          ],
          isError: true,
        };
      }
    },
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
        return {
          content: [
            { type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` },
          ],
          isError: true,
        };
      }
    },
  },
];
