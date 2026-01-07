/**
 * Reminders Tools - Apple Reminders management
 */

import { SystemTool } from './types.js';
import { runAppleScript } from './utils/command.js';

export const reminderTools: SystemTool[] = [
  {
    name: 'reminders_list',
    description: 'List reminders from a list (default: Reminders)',
    inputSchema: {
      type: 'object',
      properties: {
        list: { type: 'string', description: 'List name (default: "Reminders")' },
        completed: { type: 'boolean', description: 'Include completed (default: false)' }
      }
    },
    handler: async (args) => {
      const listName = String(args.list || 'Reminders').replace(/"/g, '\\"');
      const includeCompleted = args.completed === true;
      try {
        const script = includeCompleted ? `
          tell application "Reminders"
            set output to ""
            set theList to list "${listName}"
            repeat with r in (reminders of theList)
              set status to ""
              if completed of r then set status to "✓ "
              set output to output & status & (name of r) & "\\n"
            end repeat
            if output = "" then return "No reminders"
            return output
          end tell
        ` : `
          tell application "Reminders"
            set output to ""
            set theList to list "${listName}"
            repeat with r in (reminders of theList whose completed is false)
              set output to output & "• " & (name of r) & "\\n"
            end repeat
            if output = "" then return "No incomplete reminders"
            return output
          end tell
        `;
        const result = await runAppleScript(script);
        return { content: [{ type: 'text', text: result }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  },
  {
    name: 'reminders_create',
    description: 'Create a new reminder',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Reminder text' },
        list: { type: 'string', description: 'List name (default: "Reminders")' },
        dueDate: { type: 'string', description: 'Due date (optional, e.g., "tomorrow", "in 2 hours")' }
      },
      required: ['title']
    },
    handler: async (args) => {
      const title = String(args.title).replace(/"/g, '\\"');
      const listName = String(args.list || 'Reminders').replace(/"/g, '\\"');
      try {
        const script = `
          tell application "Reminders"
            set theList to list "${listName}"
            make new reminder at end of reminders of theList with properties {name:"${title}"}
            return "Reminder created: ${title}"
          end tell
        `;
        const result = await runAppleScript(script);
        return { content: [{ type: 'text', text: result }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  },
  {
    name: 'reminders_complete',
    description: 'Mark a reminder as complete',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Reminder title (partial match)' },
        list: { type: 'string', description: 'List name (default: "Reminders")' }
      },
      required: ['title']
    },
    handler: async (args) => {
      const title = String(args.title).replace(/"/g, '\\"');
      const listName = String(args.list || 'Reminders').replace(/"/g, '\\"');
      try {
        const script = `
          tell application "Reminders"
            set theList to list "${listName}"
            set matchingReminders to (reminders of theList whose name contains "${title}" and completed is false)
            if (count of matchingReminders) = 0 then return "No matching reminder found"
            set completed of (item 1 of matchingReminders) to true
            return "Completed: " & (name of item 1 of matchingReminders)
          end tell
        `;
        const result = await runAppleScript(script);
        return { content: [{ type: 'text', text: result }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true };
      }
    }
  }
];
