/**
 * Display Tools - Brightness, dark mode, DND controls
 */

import { SystemTool } from './types.js';
import { execCommand, runAppleScript } from './utils/command.js';

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
        try {
          await execCommand('brightness', [String(normalized)]);
          return { content: [{ type: 'text', text: `Brightness set to ${level}%` }] };
        } catch {
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
