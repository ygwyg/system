/**
 * Calendar Tools - Apple Calendar management
 */

import { SystemTool } from './types.js';
import { runAppleScript } from './utils/command.js';

export const calendarTools: SystemTool[] = [
  {
    name: 'calendar_today',
    description: 'Get today\'s calendar events',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const script = `
          tell application "Calendar"
            set today to current date
            set todayStart to today - (time of today)
            set todayEnd to todayStart + (1 * days) - 1
            set output to ""
            repeat with cal in calendars
              set evts to (every event of cal whose start date ≥ todayStart and start date ≤ todayEnd)
              repeat with evt in evts
                set evtStart to start date of evt
                set timeStr to (time string of evtStart)
                set output to output & timeStr & " - " & (summary of evt) & "\\n"
              end repeat
            end repeat
            if output = "" then return "No events today"
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
    name: 'calendar_upcoming',
    description: 'Get upcoming events for the next few days',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Number of days to look ahead (default 3)' }
      }
    },
    handler: async (args) => {
      const days = Math.min(7, Math.max(1, Number(args.days) || 3));
      try {
        const script = `
          tell application "Calendar"
            set today to current date
            set startDate to today - (time of today)
            set endDate to startDate + (${days} * days)
            set output to ""
            repeat with cal in calendars
              set evts to (every event of cal whose start date ≥ startDate and start date ≤ endDate)
              repeat with evt in evts
                set evtStart to start date of evt
                set dateStr to (short date string of evtStart)
                set timeStr to (time string of evtStart)
                set output to output & dateStr & " " & timeStr & " - " & (summary of evt) & "\\n"
              end repeat
            end repeat
            if output = "" then return "No upcoming events"
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
    name: 'calendar_create',
    description: 'Create a new calendar event',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title' },
        date: { type: 'string', description: 'Date (e.g., "tomorrow", "2024-01-15")' },
        time: { type: 'string', description: 'Start time (e.g., "2pm", "14:00")' },
        duration: { type: 'number', description: 'Duration in minutes (default 60)' }
      },
      required: ['title', 'date', 'time']
    },
    handler: async (args) => {
      const title = String(args.title).replace(/"/g, '\\"');
      const duration = Math.min(480, Math.max(15, Number(args.duration) || 60));
      try {
        const script = `
          tell application "Calendar"
            set theCalendar to first calendar whose name is "Calendar"
            set startDate to current date
            set hours of startDate to 14
            set minutes of startDate to 0
            set seconds of startDate to 0
            set endDate to startDate + (${duration} * minutes)
            make new event at end of events of theCalendar with properties {summary:"${title}", start date:startDate, end date:endDate}
            return "Created: ${title}"
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
    name: 'calendar_next',
    description: 'Get your next upcoming meeting/event',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const script = `
          tell application "Calendar"
            set now to current date
            set nextEvent to missing value
            set nextStart to now + (30 * days)
            repeat with cal in calendars
              set evts to (every event of cal whose start date > now)
              repeat with evt in evts
                if start date of evt < nextStart then
                  set nextStart to start date of evt
                  set nextEvent to evt
                end if
              end repeat
            end repeat
            if nextEvent is missing value then return "No upcoming events"
            set dateStr to (short date string of (start date of nextEvent))
            set timeStr to (time string of (start date of nextEvent))
            return dateStr & " " & timeStr & " - " & (summary of nextEvent)
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
