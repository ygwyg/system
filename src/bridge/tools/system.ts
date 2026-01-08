/**
 * System Tools - Notify, say, wait, clipboard
 */

import { spawn } from 'child_process';
import type { SystemTool } from './types.js';
import { execCommand, runAppleScript } from './utils/command.js';

export const systemTools: SystemTool[] = [
  {
    name: 'notify',
    description: 'Show a macOS notification',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Notification title' },
        message: { type: 'string', description: 'Notification message' },
      },
      required: ['message'],
    },
    handler: async (args) => {
      const title = String(args.title || 'SYSTEM')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
      const message = String(args.message).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      try {
        await runAppleScript(`display notification "${message}" with title "${title}"`);
        return { content: [{ type: 'text', text: 'Notification sent' }] };
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
    name: 'say',
    description: 'Make the Mac speak text aloud',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to speak' },
      },
      required: ['text'],
    },
    handler: async (args) => {
      const text = String(args.text);
      try {
        await execCommand('say', [text]);
        return { content: [{ type: 'text', text: `Spoke: "${text}"` }] };
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
    name: 'wait',
    description:
      'Wait/sleep for a specified number of seconds before continuing. Use this when you need to wait for an app to load or for a delay between actions.',
    inputSchema: {
      type: 'object',
      properties: {
        seconds: { type: 'number', description: 'Number of seconds to wait (max 30)' },
      },
      required: ['seconds'],
    },
    handler: async (args) => {
      const seconds = Math.min(30, Math.max(0.1, Number(args.seconds) || 1));
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      return { content: [{ type: 'text', text: `Waited ${seconds} seconds` }] };
    },
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
          content: [
            { type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` },
          ],
          isError: true,
        };
      }
    },
  },
  {
    name: 'clipboard_set',
    description: 'Set the clipboard contents',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to copy to clipboard' },
      },
      required: ['text'],
    },
    handler: async (args) => {
      const text = String(args.text);
      try {
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
          content: [
            { type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` },
          ],
          isError: true,
        };
      }
    },
  },
];
