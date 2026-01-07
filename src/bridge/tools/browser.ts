/**
 * Browser Tools - Browser URL and tabs
 */

import { SystemTool } from './types.js';
import { runAppleScript } from './utils/command.js';

export const browserTools: SystemTool[] = [
  {
    name: 'browser_url',
    description: 'Get the current URL from the active browser tab',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
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
      } catch {
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
      } catch {
        return { content: [{ type: 'text', text: 'Could not get browser tabs' }] };
      }
    }
  }
];
