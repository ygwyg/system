/**
 * Volume Tools - System volume controls
 */

import type { SystemTool } from './types.js';
import { runAppleScript } from './utils/command.js';

export const volumeTools: SystemTool[] = [
  {
    name: 'volume_set',
    description: 'Set the system volume to a specific level (0-100)',
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'number', description: 'Volume level from 0 to 100' },
      },
      required: ['level'],
    },
    handler: async (args) => {
      const level = Math.min(100, Math.max(0, Math.round(Number(args.level) || 50)));
      try {
        await runAppleScript(`set volume output volume ${level}`);
        return { content: [{ type: 'text', text: `Volume set to ${level}%` }] };
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
    name: 'volume_get',
    description: 'Get the current system volume level',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const result = await runAppleScript('output volume of (get volume settings)');
        return { content: [{ type: 'text', text: `Volume: ${result}%` }] };
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
          content: [
            { type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` },
          ],
          isError: true,
        };
      }
    },
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
          content: [
            { type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` },
          ],
          isError: true,
        };
      }
    },
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
        return {
          content: [
            { type: 'text', text: newState === 'true' ? 'Volume muted' : 'Volume unmuted' },
          ],
        };
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
