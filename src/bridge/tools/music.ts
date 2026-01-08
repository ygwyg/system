/**
 * Music Tools - Apple Music control
 */

import type { SystemTool } from './types.js';
import { runAppleScript } from './utils/command.js';

export const musicTools: SystemTool[] = [
  {
    name: 'music_play',
    description: 'Play music in Apple Music. Optionally search for a specific song/artist.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional song, artist, or album to search and play',
        },
      },
    },
    handler: async (args) => {
      const query = args.query as string | undefined;

      try {
        if (query) {
          const escapedQuery = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          const script = `tell application "Music"
            activate
            set searchResults to search playlist "Library" for "${escapedQuery}"
            if (count of searchResults) > 0 then
              play item 1 of searchResults
              return "Playing: " & name of item 1 of searchResults
            else
              return "No results found for: ${escapedQuery}"
            end if
          end tell`;
          const result = await runAppleScript(script);
          return { content: [{ type: 'text', text: result }] };
        } else {
          await runAppleScript('tell application "Music" to activate');
          await runAppleScript('tell application "Music" to play');
          return { content: [{ type: 'text', text: 'Music playing' }] };
        }
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
    name: 'music_pause',
    description: 'Pause Apple Music',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        await runAppleScript('tell application "Music" to pause');
        return { content: [{ type: 'text', text: 'Music paused' }] };
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
    name: 'music_next',
    description: 'Skip to next track in Apple Music',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        await runAppleScript('tell application "Music" to next track');
        await new Promise((resolve) => setTimeout(resolve, 500));
        const track = await runAppleScript(
          'tell application "Music" to return name of current track'
        );
        return { content: [{ type: 'text', text: `Next track: ${track}` }] };
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
    name: 'music_previous',
    description: 'Go to previous track in Apple Music',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        await runAppleScript('tell application "Music" to previous track');
        await new Promise((resolve) => setTimeout(resolve, 500));
        const track = await runAppleScript(
          'tell application "Music" to return name of current track'
        );
        return { content: [{ type: 'text', text: `Previous track: ${track}` }] };
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
    name: 'music_current',
    description: 'Get info about the currently playing track',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const result = await runAppleScript(
          'tell application "Music" to return name of current track & " by " & artist of current track'
        );
        return { content: [{ type: 'text', text: result }] };
      } catch {
        return { content: [{ type: 'text', text: 'No track playing' }] };
      }
    },
  },
];
