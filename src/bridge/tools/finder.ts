/**
 * Finder Tools - File system operations
 */

import type { SystemTool } from './types.js';
import { execCommand, runAppleScript } from './utils/command.js';

export const finderTools: SystemTool[] = [
  {
    name: 'finder_search',
    description: 'Search for files by name using Spotlight',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['query'],
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
    name: 'finder_downloads',
    description: 'List recent files in Downloads folder',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of files to list (default 10)' },
      },
    },
    handler: async (args) => {
      const count = Math.min(20, Math.max(1, Number(args.count) || 10));
      try {
        const { stdout } = await execCommand('ls', ['-t', '-1', `${process.env.HOME}/Downloads`]);
        const files = stdout.trim().split('\n').slice(0, count);
        return { content: [{ type: 'text', text: files.join('\n') || 'Downloads empty' }] };
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
    name: 'finder_desktop',
    description: 'List files on Desktop',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const { stdout } = await execCommand('ls', ['-1', `${process.env.HOME}/Desktop`]);
        const files = stdout.trim().split('\n').filter(Boolean);
        return { content: [{ type: 'text', text: files.join('\n') || 'Desktop empty' }] };
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
    name: 'finder_reveal',
    description: 'Reveal a file or folder in Finder',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File or folder path' },
      },
      required: ['path'],
    },
    handler: async (args) => {
      const path = String(args.path).replace(/"/g, '\\"');
      try {
        await runAppleScript(`tell application "Finder" to reveal POSIX file "${path}"`);
        await runAppleScript(`tell application "Finder" to activate`);
        return { content: [{ type: 'text', text: `Revealed: ${path}` }] };
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
    name: 'finder_trash',
    description: 'Move a file to Trash',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to trash' },
      },
      required: ['path'],
    },
    handler: async (args) => {
      const path = String(args.path).replace(/"/g, '\\"');
      try {
        await runAppleScript(`tell application "Finder" to delete POSIX file "${path}"`);
        return { content: [{ type: 'text', text: `Trashed: ${path}` }] };
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
