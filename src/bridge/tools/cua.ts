/**
 * Computer Use Agent (CUA) Tools
 *
 * Advanced tools for visual-based computer control.
 * These tools enable AI to interact with ANY application by:
 * 1. Taking screenshots to see the current state
 * 2. Analyzing the UI to find elements
 * 3. Clicking, typing, and interacting based on visual understanding
 * 4. Verifying actions completed successfully
 */

import { spawn } from 'child_process';
import { readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { SystemTool } from './types.js';
import { execCommand, runAppleScript } from './utils/command.js';

/**
 * Capture a screenshot and return as base64
 */
async function captureScreenshot(type: 'full' | 'window' = 'full'): Promise<{
  data: string;
  mimeType: string;
  width: number;
  height: number;
}> {
  const tmpFile = join(tmpdir(), `cua-screenshot-${Date.now()}.png`);
  const resizedFile = join(tmpdir(), `cua-screenshot-resized-${Date.now()}.jpg`);

  try {
    await new Promise<void>((resolve, reject) => {
      const args = type === 'window' ? ['-w', '-o', tmpFile] : ['-x', tmpFile];
      const proc = spawn('screencapture', args, { timeout: 10000 });
      let stderr = '';
      proc.stderr?.on('data', (d) => (stderr += d.toString()));
      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `screencapture failed (code ${code}): ${stderr || 'Check Screen Recording permission in System Settings > Privacy & Security'}`
            )
          );
        }
      });
      proc.on('error', (err) => reject(new Error(`screencapture error: ${err.message}`)));
    });

    // Get original dimensions
    const sizeOutput = await new Promise<string>((resolve, reject) => {
      const proc = spawn('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', tmpFile]);
      let stdout = '';
      proc.stdout.on('data', (d) => (stdout += d.toString()));
      proc.on('close', () => resolve(stdout));
      proc.on('error', reject);
    });

    const widthMatch = sizeOutput.match(/pixelWidth:\s*(\d+)/);
    const heightMatch = sizeOutput.match(/pixelHeight:\s*(\d+)/);
    const originalWidth = widthMatch ? parseInt(widthMatch[1]) : 1920;
    const originalHeight = heightMatch ? parseInt(heightMatch[1]) : 1080;

    // Resize for Claude (max 1568 on longest edge, ~1.15MP total)
    const scale = Math.min(
      1,
      1568 / Math.max(originalWidth, originalHeight),
      Math.sqrt(1150000 / (originalWidth * originalHeight))
    );
    const targetWidth = Math.round(originalWidth * scale);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        'sips',
        [
          '--resampleWidth',
          String(targetWidth),
          '--setProperty',
          'format',
          'jpeg',
          '--setProperty',
          'formatOptions',
          '85',
          tmpFile,
          '--out',
          resizedFile,
        ],
        { timeout: 10000 }
      );
      proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`sips failed`))));
      proc.on('error', reject);
    });

    const imageBuffer = readFileSync(resizedFile);
    const base64Image = imageBuffer.toString('base64');

    // Cleanup
    try {
      unlinkSync(tmpFile);
    } catch {}
    try {
      unlinkSync(resizedFile);
    } catch {}

    return {
      data: base64Image,
      mimeType: 'image/jpeg',
      width: originalWidth,
      height: originalHeight,
    };
  } catch (error) {
    try {
      unlinkSync(tmpFile);
    } catch {}
    try {
      unlinkSync(resizedFile);
    } catch {}
    throw error;
  }
}

/**
 * Get the frontmost application info
 */
async function getFrontmostApp(): Promise<{ name: string; bundleId: string }> {
  const script = `
    tell application "System Events"
      set frontApp to first application process whose frontmost is true
      set appName to name of frontApp
      set bundleId to bundle identifier of frontApp
      return appName & "|" & bundleId
    end tell
  `;
  const result = await runAppleScript(script);
  const [name, bundleId] = result.trim().split('|');
  return { name: name || 'Unknown', bundleId: bundleId || '' };
}

/**
 * Get all visible windows
 */
async function getVisibleWindows(): Promise<
  Array<{
    app: string;
    title: string;
    position: { x: number; y: number };
    size: { width: number; height: number };
  }>
> {
  const script = `
    set windowList to {}
    tell application "System Events"
      repeat with proc in (every process whose visible is true)
        try
          repeat with win in (every window of proc)
            set winName to name of win
            set winPos to position of win
            set winSize to size of win
            set end of windowList to (name of proc) & "|||" & winName & "|||" & (item 1 of winPos as text) & "," & (item 2 of winPos as text) & "|||" & (item 1 of winSize as text) & "," & (item 2 of winSize as text)
          end repeat
        end try
      end repeat
    end tell
    set AppleScript's text item delimiters to "~~~"
    return windowList as text
  `;

  try {
    const result = await runAppleScript(script);
    if (!result.trim()) return [];

    return result
      .split('~~~')
      .filter(Boolean)
      .map((line) => {
        const [app, title, pos, size] = line.split('|||');
        const [x, y] = (pos || '0,0').split(',').map(Number);
        const [width, height] = (size || '0,0').split(',').map(Number);
        return { app, title, position: { x, y }, size: { width, height } };
      });
  } catch {
    return [];
  }
}

export const cuaTools: SystemTool[] = [
  {
    name: 'cua_screenshot',
    description:
      "Take a screenshot for visual analysis. Returns the image and screen dimensions. Use this to see what's currently on screen before taking actions.",
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['full', 'window'],
          description:
            'Type of screenshot: "full" for entire screen, "window" for frontmost window',
        },
      },
    },
    handler: async (args) => {
      try {
        const type = args.type === 'window' ? 'window' : 'full';
        const screenshot = await captureScreenshot(type);
        const frontApp = await getFrontmostApp();

        return {
          content: [
            {
              type: 'image',
              data: screenshot.data,
              mimeType: screenshot.mimeType,
            },
            {
              type: 'text',
              text: JSON.stringify({
                screenSize: { width: screenshot.width, height: screenshot.height },
                frontmostApp: frontApp,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Screenshot failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  {
    name: 'cua_click',
    description:
      'Click at specific screen coordinates. Coordinates should be based on the screen dimensions from cua_screenshot.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate (pixels from left edge of screen)' },
        y: { type: 'number', description: 'Y coordinate (pixels from top edge of screen)' },
        button: {
          type: 'string',
          enum: ['left', 'right'],
          description: 'Mouse button (default: left)',
        },
        clicks: {
          type: 'number',
          enum: [1, 2, 3],
          description: 'Number of clicks (1=single, 2=double, 3=triple)',
        },
        modifiers: {
          type: 'array',
          items: { type: 'string', enum: ['cmd', 'ctrl', 'alt', 'shift'] },
          description: 'Modifier keys to hold during click',
        },
      },
      required: ['x', 'y'],
    },
    handler: async (args) => {
      const x = Math.round(Number(args.x));
      const y = Math.round(Number(args.y));
      const button = args.button === 'right' ? 'right' : 'left';
      const clicks = [1, 2, 3].includes(Number(args.clicks)) ? Number(args.clicks) : 1;
      const modifiers = (args.modifiers as string[]) || [];

      try {
        // Try cliclick first (faster, more reliable)
        try {
          const clickCmd =
            button === 'right' ? 'rc' : clicks === 2 ? 'dc' : clicks === 3 ? 'tc' : 'c';
          const cliclickArgs = [`${clickCmd}:${x},${y}`];
          await execCommand('cliclick', cliclickArgs);
          return { content: [{ type: 'text', text: `Clicked at (${x}, ${y})` }] };
        } catch {
          // Fallback to AppleScript with System Events
          const modifierScript =
            modifiers.length > 0
              ? `using {${modifiers.map((m) => (m === 'cmd' ? 'command down' : m === 'ctrl' ? 'control down' : m === 'alt' ? 'option down' : 'shift down')).join(', ')}}`
              : '';

          const script = `
            tell application "System Events"
              click at {${x}, ${y}} ${modifierScript}
            end tell
          `;
          await runAppleScript(script);
          return { content: [{ type: 'text', text: `Clicked at (${x}, ${y})` }] };
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Click failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  {
    name: 'cua_type',
    description:
      'Type text at the current cursor position. Make sure to click into a text field first.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type' },
        delay: {
          type: 'number',
          description: 'Delay between keystrokes in ms (default: 0 for instant)',
        },
      },
      required: ['text'],
    },
    handler: async (args) => {
      const text = String(args.text);
      const delay = Number(args.delay) || 0;

      try {
        if (delay > 0) {
          // Type character by character with delay
          for (const char of text) {
            const escaped = char.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            await runAppleScript(`tell application "System Events" to keystroke "${escaped}"`);
            await new Promise((r) => setTimeout(r, delay));
          }
        } else {
          // Type all at once using cliclick or AppleScript
          try {
            await execCommand('cliclick', [`t:${text}`]);
          } catch {
            const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            await runAppleScript(`tell application "System Events" to keystroke "${escaped}"`);
          }
        }
        return {
          content: [
            {
              type: 'text',
              text: `Typed: "${text.length > 50 ? text.slice(0, 50) + '...' : text}"`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Type failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  {
    name: 'cua_key',
    description:
      'Press a key or key combination (e.g., "return", "cmd+a", "cmd+shift+s"). For special keys: return, escape, tab, space, delete, up, down, left, right, f1-f12.',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Key or key combination (e.g., "return", "cmd+c", "cmd+shift+z")',
        },
      },
      required: ['key'],
    },
    handler: async (args) => {
      const keyInput = String(args.key).toLowerCase();
      const parts = keyInput.split('+').map((p) => p.trim());
      const key = parts.pop() || '';
      const modifiers = parts;

      const keyCodes: Record<string, number> = {
        return: 36,
        enter: 36,
        escape: 53,
        esc: 53,
        tab: 48,
        space: 49,
        delete: 51,
        backspace: 51,
        up: 126,
        down: 125,
        left: 123,
        right: 124,
        home: 115,
        end: 119,
        pageup: 116,
        pagedown: 121,
        f1: 122,
        f2: 120,
        f3: 99,
        f4: 118,
        f5: 96,
        f6: 97,
        f7: 98,
        f8: 100,
        f9: 101,
        f10: 109,
        f11: 103,
        f12: 111,
      };

      const modifierStr = modifiers
        .map((m) => {
          if (m === 'cmd' || m === 'command') return 'command down';
          if (m === 'ctrl' || m === 'control') return 'control down';
          if (m === 'alt' || m === 'option') return 'option down';
          if (m === 'shift') return 'shift down';
          return '';
        })
        .filter(Boolean)
        .join(', ');

      try {
        const code = keyCodes[key];
        if (code !== undefined) {
          const script = modifierStr
            ? `tell application "System Events" to key code ${code} using {${modifierStr}}`
            : `tell application "System Events" to key code ${code}`;
          await runAppleScript(script);
        } else {
          const script = modifierStr
            ? `tell application "System Events" to keystroke "${key}" using {${modifierStr}}`
            : `tell application "System Events" to keystroke "${key}"`;
          await runAppleScript(script);
        }
        return { content: [{ type: 'text', text: `Pressed: ${keyInput}` }] };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Key press failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  {
    name: 'cua_scroll',
    description: 'Scroll up or down at the current mouse position or specified coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: 'Scroll direction',
        },
        amount: { type: 'number', description: 'Scroll amount (1-10, default: 3)' },
        x: { type: 'number', description: 'Optional X coordinate to scroll at' },
        y: { type: 'number', description: 'Optional Y coordinate to scroll at' },
      },
      required: ['direction'],
    },
    handler: async (args) => {
      const direction = args.direction as string;
      const amount = Math.min(10, Math.max(1, Number(args.amount) || 3));
      const x = args.x !== undefined ? Math.round(Number(args.x)) : undefined;
      const y = args.y !== undefined ? Math.round(Number(args.y)) : undefined;

      try {
        if (x !== undefined && y !== undefined) {
          try {
            await execCommand('cliclick', [`m:${x},${y}`]);
          } catch {}
        }

        const cliclickDir =
          direction === 'up' ? 'u' : direction === 'down' ? 'd' : direction === 'left' ? 'l' : 'r';
        const scrollCmd = `kd:${cliclickDir}:${amount}`;

        try {
          await execCommand('cliclick', [scrollCmd]);
        } catch {
          const keyCode =
            direction === 'up'
              ? 126
              : direction === 'down'
                ? 125
                : direction === 'left'
                  ? 123
                  : 124;
          for (let i = 0; i < amount; i++) {
            await runAppleScript(`tell application "System Events" to key code ${keyCode}`);
          }
        }

        return { content: [{ type: 'text', text: `Scrolled ${direction} ${amount} units` }] };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Scroll failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  {
    name: 'cua_drag',
    description: 'Click and drag from one point to another.',
    inputSchema: {
      type: 'object',
      properties: {
        fromX: { type: 'number', description: 'Starting X coordinate' },
        fromY: { type: 'number', description: 'Starting Y coordinate' },
        toX: { type: 'number', description: 'Ending X coordinate' },
        toY: { type: 'number', description: 'Ending Y coordinate' },
        duration: { type: 'number', description: 'Duration of drag in ms (default: 500)' },
      },
      required: ['fromX', 'fromY', 'toX', 'toY'],
    },
    handler: async (args) => {
      const fromX = Math.round(Number(args.fromX));
      const fromY = Math.round(Number(args.fromY));
      const toX = Math.round(Number(args.toX));
      const toY = Math.round(Number(args.toY));
      const duration = Number(args.duration) || 500;

      try {
        try {
          await execCommand('cliclick', [`dd:${fromX},${fromY}`, `du:${toX},${toY}`]);
        } catch {
          const durationSec = duration / 1000;
          const script = `
            do shell script "python3 -c \\"
import Quartz
import time
event = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseDown, (${fromX}, ${fromY}), Quartz.kCGMouseButtonLeft)
Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
time.sleep(${durationSec})
event = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseDragged, (${toX}, ${toY}), Quartz.kCGMouseButtonLeft)
Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
time.sleep(0.05)
event = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseUp, (${toX}, ${toY}), Quartz.kCGMouseButtonLeft)
Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
\\""
          `;
          await runAppleScript(script);
        }
        return {
          content: [
            { type: 'text', text: `Dragged from (${fromX}, ${fromY}) to (${toX}, ${toY})` },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Drag failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  {
    name: 'cua_wait',
    description: 'Wait for a specified duration. Use this between actions to allow UI to update.',
    inputSchema: {
      type: 'object',
      properties: {
        seconds: { type: 'number', description: 'Number of seconds to wait (0.1 to 30)' },
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
    name: 'cua_get_windows',
    description: 'Get information about all visible windows including their positions and sizes.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      try {
        const windows = await getVisibleWindows();
        const frontApp = await getFrontmostApp();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ frontmostApp: frontApp, windows }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to get windows: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  {
    name: 'cua_focus_app',
    description: 'Bring an application to the front and focus it.',
    inputSchema: {
      type: 'object',
      properties: {
        app: {
          type: 'string',
          description: 'Application name (e.g., "Safari", "Finder", "Figma")',
        },
      },
      required: ['app'],
    },
    handler: async (args) => {
      const appName = String(args.app);
      try {
        await runAppleScript(`tell application "${appName}" to activate`);
        // Small delay to let the app come to front
        await new Promise((r) => setTimeout(r, 300));
        return { content: [{ type: 'text', text: `Focused: ${appName}` }] };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to focus ${appName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  {
    name: 'cua_window_manage',
    description: 'Manage window position, size, or state.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Application name' },
        action: {
          type: 'string',
          enum: ['move', 'resize', 'minimize', 'maximize', 'close'],
          description: 'Window action to perform',
        },
        x: { type: 'number', description: 'X position (for move)' },
        y: { type: 'number', description: 'Y position (for move)' },
        width: { type: 'number', description: 'Width (for resize)' },
        height: { type: 'number', description: 'Height (for resize)' },
      },
      required: ['app', 'action'],
    },
    handler: async (args) => {
      const appName = String(args.app);
      const action = String(args.action);

      try {
        let script: string;

        switch (action) {
          case 'move': {
            const x = Math.round(Number(args.x) || 0);
            const y = Math.round(Number(args.y) || 0);
            script = `
              tell application "System Events"
                tell process "${appName}"
                  set position of window 1 to {${x}, ${y}}
                end tell
              end tell
            `;
            await runAppleScript(script);
            return { content: [{ type: 'text', text: `Moved ${appName} window to (${x}, ${y})` }] };
          }

          case 'resize': {
            const width = Math.round(Number(args.width) || 800);
            const height = Math.round(Number(args.height) || 600);
            script = `
              tell application "System Events"
                tell process "${appName}"
                  set size of window 1 to {${width}, ${height}}
                end tell
              end tell
            `;
            await runAppleScript(script);
            return {
              content: [{ type: 'text', text: `Resized ${appName} window to ${width}x${height}` }],
            };
          }

          case 'minimize':
            script = `tell application "${appName}" to set miniaturized of window 1 to true`;
            await runAppleScript(script);
            return { content: [{ type: 'text', text: `Minimized ${appName}` }] };

          case 'maximize':
            // macOS doesn't have true maximize, so we use fullscreen or zoom
            script = `
              tell application "System Events"
                tell process "${appName}"
                  click button 2 of window 1
                end tell
              end tell
            `;
            await runAppleScript(script);
            return { content: [{ type: 'text', text: `Maximized ${appName}` }] };

          case 'close':
            script = `tell application "${appName}" to close window 1`;
            await runAppleScript(script);
            return { content: [{ type: 'text', text: `Closed ${appName} window` }] };

          default:
            return {
              content: [{ type: 'text', text: `Unknown action: ${action}` }],
              isError: true,
            };
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Window manage failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  {
    name: 'cua_open_url',
    description: 'Open a URL in the default browser.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to open' },
      },
      required: ['url'],
    },
    handler: async (args) => {
      const url = String(args.url);
      try {
        await execCommand('open', [url]);
        await new Promise((r) => setTimeout(r, 500));
        return { content: [{ type: 'text', text: `Opened: ${url}` }] };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to open URL: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  {
    name: 'cua_launch_app',
    description: 'Launch an application by name or bundle ID.',
    inputSchema: {
      type: 'object',
      properties: {
        app: {
          type: 'string',
          description: 'App name (e.g., "Figma") or bundle ID (e.g., "com.figma.Desktop")',
        },
      },
      required: ['app'],
    },
    handler: async (args) => {
      const app = String(args.app);
      try {
        if (app.includes('.')) {
          await execCommand('open', ['-b', app]);
        } else {
          await execCommand('open', ['-a', app]);
        }
        await new Promise((r) => setTimeout(r, 1000));
        return { content: [{ type: 'text', text: `Launched: ${app}` }] };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to launch ${app}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  {
    name: 'cua_mouse_position',
    description: 'Get the current mouse cursor position.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      try {
        // Try cliclick first (if installed)
        try {
          const { stdout } = await execCommand('cliclick', ['p:.']);
          const match = stdout.match(/(\d+),(\d+)/);
          if (match) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ x: Number(match[1]), y: Number(match[2]) }),
                },
              ],
            };
          }
        } catch {}

        // Use JXA (JavaScript for Automation) - no Python required
        const jxaScript = `
          ObjC.import("Cocoa");
          var point = $.NSEvent.mouseLocation;
          var screenHeight = $.NSScreen.mainScreen.frame.size.height;
          // Convert from bottom-left origin to top-left origin
          var x = Math.round(point.x);
          var y = Math.round(screenHeight - point.y);
          JSON.stringify({ x: x, y: y });
        `;

        const result = await new Promise<string>((resolve, reject) => {
          const proc = spawn('osascript', ['-l', 'JavaScript', '-e', jxaScript]);
          let stdout = '';
          let stderr = '';
          proc.stdout.on('data', (d) => (stdout += d.toString()));
          proc.stderr.on('data', (d) => (stderr += d.toString()));
          proc.on('close', (code) => {
            if (code === 0) resolve(stdout.trim());
            else reject(new Error(stderr || 'JXA failed'));
          });
          proc.on('error', reject);
        });

        return { content: [{ type: 'text', text: result }] };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to get mouse position: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  {
    name: 'cua_double_click',
    description: 'Double-click at specific coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
      },
      required: ['x', 'y'],
    },
    handler: async (args) => {
      const x = Math.round(Number(args.x));
      const y = Math.round(Number(args.y));
      try {
        await execCommand('cliclick', [`dc:${x},${y}`]);
        return { content: [{ type: 'text', text: `Double-clicked at (${x}, ${y})` }] };
      } catch {
        const script = `
          tell application "System Events"
            click at {${x}, ${y}}
            delay 0.1
            click at {${x}, ${y}}
          end tell
        `;
        await runAppleScript(script);
        return { content: [{ type: 'text', text: `Double-clicked at (${x}, ${y})` }] };
      }
    },
  },

  {
    name: 'cua_right_click',
    description: 'Right-click (context menu) at specific coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
      },
      required: ['x', 'y'],
    },
    handler: async (args) => {
      const x = Math.round(Number(args.x));
      const y = Math.round(Number(args.y));
      try {
        await execCommand('cliclick', [`rc:${x},${y}`]);
        return { content: [{ type: 'text', text: `Right-clicked at (${x}, ${y})` }] };
      } catch {
        const script = `
          tell application "System Events"
            set savedPos to do shell script "cliclick p:." 
            do shell script "cliclick m:${x},${y}"
            key code 36 using control down
          end tell
        `;
        try {
          await runAppleScript(script);
        } catch {
          await runAppleScript(
            `tell application "System Events" to key code 36 using control down`
          );
        }
        return { content: [{ type: 'text', text: `Right-clicked at (${x}, ${y})` }] };
      }
    },
  },

  {
    name: 'cua_select_all',
    description: 'Select all content (Cmd+A).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      await runAppleScript(`tell application "System Events" to keystroke "a" using command down`);
      return { content: [{ type: 'text', text: 'Selected all (Cmd+A)' }] };
    },
  },

  {
    name: 'cua_copy',
    description: 'Copy selected content to clipboard (Cmd+C).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      await runAppleScript(`tell application "System Events" to keystroke "c" using command down`);
      await new Promise((r) => setTimeout(r, 100));
      return { content: [{ type: 'text', text: 'Copied (Cmd+C)' }] };
    },
  },

  {
    name: 'cua_paste',
    description: 'Paste clipboard content (Cmd+V).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      await runAppleScript(`tell application "System Events" to keystroke "v" using command down`);
      return { content: [{ type: 'text', text: 'Pasted (Cmd+V)' }] };
    },
  },

  {
    name: 'cua_undo',
    description: 'Undo last action (Cmd+Z).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      await runAppleScript(`tell application "System Events" to keystroke "z" using command down`);
      return { content: [{ type: 'text', text: 'Undo (Cmd+Z)' }] };
    },
  },

  {
    name: 'cua_save',
    description: 'Save current document (Cmd+S).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      await runAppleScript(`tell application "System Events" to keystroke "s" using command down`);
      return { content: [{ type: 'text', text: 'Saved (Cmd+S)' }] };
    },
  },

  {
    name: 'cua_close_window',
    description: 'Close current window (Cmd+W).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      await runAppleScript(`tell application "System Events" to keystroke "w" using command down`);
      return { content: [{ type: 'text', text: 'Closed window (Cmd+W)' }] };
    },
  },

  {
    name: 'cua_new_tab',
    description: 'Open new tab (Cmd+T).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      await runAppleScript(`tell application "System Events" to keystroke "t" using command down`);
      return { content: [{ type: 'text', text: 'New tab (Cmd+T)' }] };
    },
  },

  {
    name: 'cua_switch_tab',
    description: 'Switch to a specific tab by number (Cmd+1-9).',
    inputSchema: {
      type: 'object',
      properties: {
        tab: { type: 'number', description: 'Tab number (1-9)' },
      },
      required: ['tab'],
    },
    handler: async (args) => {
      const tab = Math.min(9, Math.max(1, Math.round(Number(args.tab))));
      await runAppleScript(
        `tell application "System Events" to keystroke "${tab}" using command down`
      );
      return { content: [{ type: 'text', text: `Switched to tab ${tab}` }] };
    },
  },

  {
    name: 'cua_screen_info',
    description: 'Get information about connected displays.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const { stdout } = await execCommand('system_profiler', ['SPDisplaysDataType', '-json']);
        const data = JSON.parse(stdout);
        const displays = data.SPDisplaysDataType?.[0]?.spdisplays_ndrvs || [];
        const screens = displays.map(
          (
            d: { _name: string; _spdisplays_resolution: string; _spdisplays_pixels: string },
            i: number
          ) => ({
            screen: i + 1,
            name: d._name,
            resolution: d._spdisplays_resolution,
            pixels: d._spdisplays_pixels,
          })
        );
        return { content: [{ type: 'text', text: JSON.stringify(screens, null, 2) }] };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  {
    name: 'cua_menu_click',
    description: 'Click a menu item by path (e.g., "File > Save As...").',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Application name' },
        menu: { type: 'string', description: 'Menu name (e.g., "File")' },
        item: { type: 'string', description: 'Menu item name (e.g., "Save As...")' },
        submenu: { type: 'string', description: 'Optional submenu item' },
      },
      required: ['app', 'menu', 'item'],
    },
    handler: async (args) => {
      const app = String(args.app);
      const menu = String(args.menu);
      const item = String(args.item);
      const submenu = args.submenu ? String(args.submenu) : null;

      try {
        let script: string;
        if (submenu) {
          script = `
            tell application "System Events"
              tell process "${app}"
                click menu item "${submenu}" of menu of menu item "${item}" of menu "${menu}" of menu bar 1
              end tell
            end tell
          `;
        } else {
          script = `
            tell application "System Events"
              tell process "${app}"
                click menu item "${item}" of menu "${menu}" of menu bar 1
              end tell
            end tell
          `;
        }
        await runAppleScript(script);
        const path = submenu ? `${menu} > ${item} > ${submenu}` : `${menu} > ${item}`;
        return { content: [{ type: 'text', text: `Clicked menu: ${path}` }] };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Menu click failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  {
    name: 'cua_wait_for',
    description:
      'Wait for a UI element to appear or disappear. Useful for waiting for loading spinners, dialogs, or buttons to become available.',
    inputSchema: {
      type: 'object',
      properties: {
        role: {
          type: 'string',
          description:
            'UI element role to wait for (e.g., "AXButton", "AXTextField", "AXProgressIndicator")',
        },
        title: {
          type: 'string',
          description: 'Title or description text to match (partial match)',
        },
        condition: {
          type: 'string',
          enum: ['appear', 'disappear'],
          description: 'Wait for element to appear or disappear (default: appear)',
        },
        timeout: {
          type: 'number',
          description: 'Maximum time to wait in seconds (default: 10, max: 60)',
        },
        pollInterval: {
          type: 'number',
          description: 'How often to check in seconds (default: 0.5)',
        },
      },
      required: ['role'],
    },
    handler: async (args) => {
      const role = String(args.role);
      const title = args.title ? String(args.title) : undefined;
      const condition = args.condition === 'disappear' ? 'disappear' : 'appear';
      const timeout = Math.min(60, Math.max(1, Number(args.timeout) || 10));
      const pollInterval = Math.min(5, Math.max(0.1, Number(args.pollInterval) || 0.5));

      const startTime = Date.now();
      const timeoutMs = timeout * 1000;
      const pollMs = pollInterval * 1000;

      const findScript = `
        tell application "System Events"
          tell (first application process whose frontmost is true)
            try
              repeat with win in windows
                try
                  set allElems to entire contents of win
                  repeat with elem in allElems
                    try
                      if role of elem is "${role}" then
                        ${
                          title
                            ? `
                        set elemTitle to ""
                        set elemDesc to ""
                        try
                          set elemTitle to title of elem
                        end try
                        try
                          set elemDesc to description of elem
                        end try
                        if elemTitle contains "${title}" or elemDesc contains "${title}" then
                          return "FOUND"
                        end if
                        `
                            : 'return "FOUND"'
                        }
                      end if
                    end try
                  end repeat
                end try
              end repeat
            on error
              return "NOT_FOUND"
            end try
          end tell
        end tell
        return "NOT_FOUND"
      `;

      try {
        while (Date.now() - startTime < timeoutMs) {
          const result = await runAppleScript(findScript);
          const found = result.trim() === 'FOUND';

          if (condition === 'appear' && found) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Element appeared: ${role}${title ? ` matching "${title}"` : ''} (waited ${Math.round((Date.now() - startTime) / 1000)}s)`,
                },
              ],
            };
          }

          if (condition === 'disappear' && !found) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Element disappeared: ${role}${title ? ` matching "${title}"` : ''} (waited ${Math.round((Date.now() - startTime) / 1000)}s)`,
                },
              ],
            };
          }

          await new Promise((r) => setTimeout(r, pollMs));
        }

        return {
          content: [
            {
              type: 'text',
              text: `Timeout after ${timeout}s: element ${condition === 'appear' ? 'did not appear' : 'did not disappear'}`,
            },
          ],
          isError: true,
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Wait failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  },
];
