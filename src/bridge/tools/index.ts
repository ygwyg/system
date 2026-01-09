/**
 * Tools Index - Export all tools and types
 */

// Types
export { ToolResult, SystemTool, BridgeConfig } from './types.js';

// Utils
export { execCommand, runAppleScript } from './utils/command.js';
export {
  schemas,
  validateShellCommand,
  SAFE_SHELL_COMMANDS,
  BLOCKED_PATHS,
  containsBlockedPath,
} from './utils/validation.js';

// Tool categories
export { coreTools } from './core.js';
export { raycastTools, generateExtensionTools, loadConfig } from './raycast.js';
export { musicTools } from './music.js';
export { volumeTools } from './volume.js';
export { calendarTools } from './calendar.js';
export { reminderTools } from './reminders.js';
export { statusTools } from './status.js';
export { displayTools } from './display.js';
export { screenTools } from './screen.js';
export { notesTools } from './notes.js';
export { finderTools } from './finder.js';
export { shortcutsTools } from './shortcuts.js';
export { browserTools } from './browser.js';
export { systemTools } from './system.js';
export { screenshotTools } from './screenshot.js';
export { inputTools } from './input.js';

// Load config and generate extension-specific tools
import { loadConfig, generateExtensionTools } from './raycast.js';
import { coreTools } from './core.js';
import { raycastTools } from './raycast.js';
import { musicTools } from './music.js';
import { volumeTools } from './volume.js';
import { calendarTools } from './calendar.js';
import { reminderTools } from './reminders.js';
import { statusTools } from './status.js';
import { displayTools } from './display.js';
import { screenTools } from './screen.js';
import { notesTools } from './notes.js';
import { finderTools } from './finder.js';
import { shortcutsTools } from './shortcuts.js';
import { browserTools } from './browser.js';
import { systemTools } from './system.js';
import { screenshotTools } from './screenshot.js';
import { inputTools } from './input.js';

const config = loadConfig();
const configuredExtensionTools = generateExtensionTools(config);

// Export all tools - organized by category
export const allTools = [
  ...coreTools, // open_url, open_app, applescript, shell, shell_list
  ...raycastTools, // raycast_search, raycast_confetti, raycast_ai, raycast
  ...musicTools, // music_play, pause, next, previous, current
  ...volumeTools, // volume_set, get, up, down, mute
  ...systemTools, // notify, say, wait, clipboard_get, clipboard_set
  ...screenshotTools, // screenshot, get_screen_size
  ...inputTools, // mouse_click, mouse_move, keyboard_type, keyboard_key, mouse_drag, scroll
  ...calendarTools, // calendar_today, upcoming, create, next
  ...reminderTools, // reminders_list, create, complete
  ...statusTools, // battery, wifi, storage, running_apps, front_app
  ...displayTools, // brightness, dark_mode, dnd
  ...screenTools, // lock_screen, sleep_display, sleep_mac
  ...notesTools, // notes_list, search, create, read, append
  ...finderTools, // finder_search, downloads, desktop, reveal, trash
  ...shortcutsTools, // shortcut_run, list
  ...browserTools, // browser_url, tabs
  ...configuredExtensionTools, // user's raycast extensions
];
