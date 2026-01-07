/**
 * Status Tools - System monitoring
 */

import { SystemTool } from './types.js';
import { execCommand, runAppleScript } from './utils/command.js';

export const statusTools: SystemTool[] = [
  {
    name: 'battery_status',
    description: 'Get battery level and charging status',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const { stdout } = await execCommand('pmset', ['-g', 'batt']);
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
