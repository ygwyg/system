/**
 * Screen Tools - Lock, sleep controls
 */

import { SystemTool } from './types.js';
import { execCommand, runAppleScript } from './utils/command.js';

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
