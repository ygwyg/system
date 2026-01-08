/**
 * Notes Tools - Apple Notes management
 */

import type { SystemTool } from './types.js';
import { runAppleScript } from './utils/command.js';

export const notesTools: SystemTool[] = [
  {
    name: 'notes_list',
    description: 'List recent notes',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of notes to list (default 10)' },
      },
    },
    handler: async (args) => {
      const count = Math.min(20, Math.max(1, Number(args.count) || 10));
      try {
        const result = await runAppleScript(`
          tell application "Notes"
            set output to ""
            set noteList to notes 1 thru ${count} of default account
            repeat with n in noteList
              set output to output & "• " & (name of n) & "\\n"
            end repeat
            return output
          end tell
        `);
        return { content: [{ type: 'text', text: result || 'No notes found' }] };
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
    name: 'notes_search',
    description: 'Search notes by keyword',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term' },
      },
      required: ['query'],
    },
    handler: async (args) => {
      const query = String(args.query).replace(/"/g, '\\"');
      try {
        const result = await runAppleScript(`
          tell application "Notes"
            set output to ""
            set matchingNotes to (notes of default account whose name contains "${query}" or body contains "${query}")
            repeat with n in matchingNotes
              set output to output & "• " & (name of n) & "\\n"
            end repeat
            if output = "" then return "No notes found matching '${query}'"
            return output
          end tell
        `);
        return { content: [{ type: 'text', text: result }] };
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
    name: 'notes_create',
    description: 'Create a new note',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Note title' },
        body: { type: 'string', description: 'Note content' },
      },
      required: ['title'],
    },
    handler: async (args) => {
      const title = String(args.title).replace(/"/g, '\\"');
      const body = String(args.body || '').replace(/"/g, '\\"');
      try {
        await runAppleScript(`
          tell application "Notes"
            make new note at default account with properties {name:"${title}", body:"${body}"}
          end tell
        `);
        return { content: [{ type: 'text', text: `Created note: ${title}` }] };
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
    name: 'notes_read',
    description: 'Read the content of a note by name',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Note title (partial match)' },
      },
      required: ['title'],
    },
    handler: async (args) => {
      const title = String(args.title).replace(/"/g, '\\"');
      try {
        const result = await runAppleScript(`
          tell application "Notes"
            set matchingNotes to (notes of default account whose name contains "${title}")
            if (count of matchingNotes) = 0 then return "Note not found"
            return plaintext of (item 1 of matchingNotes)
          end tell
        `);
        return { content: [{ type: 'text', text: result }] };
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
    name: 'notes_append',
    description: 'Append text to an existing note',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Note title (partial match)' },
        text: { type: 'string', description: 'Text to append' },
      },
      required: ['title', 'text'],
    },
    handler: async (args) => {
      const title = String(args.title).replace(/"/g, '\\"');
      const text = String(args.text).replace(/"/g, '\\"');
      try {
        await runAppleScript(`
          tell application "Notes"
            set matchingNotes to (notes of default account whose name contains "${title}")
            if (count of matchingNotes) = 0 then return "Note not found"
            set theNote to item 1 of matchingNotes
            set body of theNote to (body of theNote) & "\\n" & "${text}"
          end tell
        `);
        return { content: [{ type: 'text', text: `Appended to: ${title}` }] };
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
