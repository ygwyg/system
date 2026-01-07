/**
 * Input Tools - Mouse and keyboard control
 */

import { SystemTool } from './types.js';
import { execCommand, runAppleScript } from './utils/command.js';

export const inputTools: SystemTool[] = [
  {
    name: 'mouse_click',
    description: 'Click at specific x,y coordinates. Low-level fallback - prefer raycast_search for most tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate (pixels from left)' },
        y: { type: 'number', description: 'Y coordinate (pixels from top)' },
        button: { type: 'string', enum: ['left', 'right'], description: 'Mouse button (default: left)' },
        clicks: { type: 'number', description: 'Number of clicks (1 for single, 2 for double)' }
      },
      required: ['x', 'y']
    },
    handler: async (args) => {
      const x = Math.round(Number(args.x));
      const y = Math.round(Number(args.y));
      const button = args.button === 'right' ? 'right' : 'left';
      const clicks = args.clicks === 2 ? 2 : 1;
      
      try {
        try {
          const clickCmd = button === 'right' ? 'rc' : (clicks === 2 ? 'dc' : 'c');
          await execCommand('cliclick', [`${clickCmd}:${x},${y}`]);
          return { content: [{ type: 'text', text: `Clicked at (${x}, ${y})` }] };
        } catch {
          const script = `
            do shell script "python3 -c \\"
import Quartz
point = (${x}, ${y})
event = Quartz.CGEventCreateMouseEvent(None, ${button === 'right' ? 'Quartz.kCGEventRightMouseDown' : 'Quartz.kCGEventLeftMouseDown'}, point, ${button === 'right' ? 'Quartz.kCGMouseButtonRight' : 'Quartz.kCGMouseButtonLeft'})
Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
event = Quartz.CGEventCreateMouseEvent(None, ${button === 'right' ? 'Quartz.kCGEventRightMouseUp' : 'Quartz.kCGEventLeftMouseUp'}, point, ${button === 'right' ? 'Quartz.kCGMouseButtonRight' : 'Quartz.kCGMouseButtonLeft'})
Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
${clicks === 2 ? `
event = Quartz.CGEventCreateMouseEvent(None, ${button === 'right' ? 'Quartz.kCGEventRightMouseDown' : 'Quartz.kCGEventLeftMouseDown'}, point, ${button === 'right' ? 'Quartz.kCGMouseButtonRight' : 'Quartz.kCGMouseButtonLeft'})
Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
event = Quartz.CGEventCreateMouseEvent(None, ${button === 'right' ? 'Quartz.kCGEventRightMouseUp' : 'Quartz.kCGEventLeftMouseUp'}, point, ${button === 'right' ? 'Quartz.kCGMouseButtonRight' : 'Quartz.kCGMouseButtonLeft'})
Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
` : ''}\\""
          `;
          await runAppleScript(script);
          return { content: [{ type: 'text', text: `Clicked at (${x}, ${y})` }] };
        }
      } catch (error) {
        return { 
          content: [{ type: 'text', text: `Click failed: ${error instanceof Error ? error.message : 'Unknown error'}` }], 
          isError: true 
        };
      }
    }
  },
  {
    name: 'mouse_move',
    description: 'Move mouse to specific x,y coordinates without clicking.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate (pixels from left)' },
        y: { type: 'number', description: 'Y coordinate (pixels from top)' }
      },
      required: ['x', 'y']
    },
    handler: async (args) => {
      const x = Math.round(Number(args.x));
      const y = Math.round(Number(args.y));
      
      try {
        try {
          await execCommand('cliclick', [`m:${x},${y}`]);
          return { content: [{ type: 'text', text: `Moved mouse to (${x}, ${y})` }] };
        } catch {
          const script = `
            do shell script "python3 -c \\"
import Quartz
point = (${x}, ${y})
event = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventMouseMoved, point, Quartz.kCGMouseButtonLeft)
Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
\\""
          `;
          await runAppleScript(script);
          return { content: [{ type: 'text', text: `Moved mouse to (${x}, ${y})` }] };
        }
      } catch (error) {
        return { 
          content: [{ type: 'text', text: `Mouse move failed: ${error instanceof Error ? error.message : 'Unknown error'}` }], 
          isError: true 
        };
      }
    }
  },
  {
    name: 'keyboard_type',
    description: 'Type text at the current cursor position. Use after clicking into a text field.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type' }
      },
      required: ['text']
    },
    handler: async (args) => {
      const text = String(args.text);
      
      try {
        try {
          await execCommand('cliclick', [`t:${text}`]);
          return { content: [{ type: 'text', text: `Typed: "${text}"` }] };
        } catch {
          const escapedText = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          const script = `
            tell application "System Events"
              keystroke "${escapedText}"
            end tell
          `;
          await runAppleScript(script);
          return { content: [{ type: 'text', text: `Typed: "${text}"` }] };
        }
      } catch (error) {
        return { 
          content: [{ type: 'text', text: `Type failed: ${error instanceof Error ? error.message : 'Unknown error'}` }], 
          isError: true 
        };
      }
    }
  },
  {
    name: 'keyboard_key',
    description: 'Press a key or key combination (e.g., "return", "cmd+a", "cmd+shift+s").',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to press (e.g., "return", "escape", "tab", "space", "delete", "up", "down", "left", "right")' },
        modifiers: { 
          type: 'array', 
          items: { type: 'string', enum: ['cmd', 'ctrl', 'alt', 'shift'] },
          description: 'Modifier keys to hold (e.g., ["cmd", "shift"])'
        }
      },
      required: ['key']
    },
    handler: async (args) => {
      const key = String(args.key).toLowerCase();
      const modifiers = (args.modifiers as string[] || []).map(m => String(m).toLowerCase());
      
      const keyMap: Record<string, string> = {
        'return': 'return', 'enter': 'return',
        'escape': 'escape', 'esc': 'escape',
        'tab': 'tab',
        'space': 'space',
        'delete': 'delete', 'backspace': 'delete',
        'up': 'up arrow', 'down': 'down arrow', 'left': 'left arrow', 'right': 'right arrow',
        'home': 'home', 'end': 'end',
        'pageup': 'page up', 'pagedown': 'page down',
      };
      
      const appleKey = keyMap[key] || key;
      const modifierStr = modifiers.map(m => {
        if (m === 'cmd' || m === 'command') return 'command down';
        if (m === 'ctrl' || m === 'control') return 'control down';
        if (m === 'alt' || m === 'option') return 'option down';
        if (m === 'shift') return 'shift down';
        return '';
      }).filter(Boolean).join(', ');
      
      try {
        const isSpecialKey = ['return', 'escape', 'tab', 'delete', 'up arrow', 'down arrow', 'left arrow', 'right arrow', 'home', 'end', 'page up', 'page down', 'space'].includes(appleKey);
        
        if (isSpecialKey) {
          const keyCodes: Record<string, number> = {
            'return': 36, 'escape': 53, 'tab': 48, 'delete': 51, 'space': 49,
            'up arrow': 126, 'down arrow': 125, 'left arrow': 123, 'right arrow': 124,
            'home': 115, 'end': 119, 'page up': 116, 'page down': 121,
          };
          const code = keyCodes[appleKey] || 36;
          const keyScript = modifierStr
            ? `tell application "System Events" to key code ${code} using {${modifierStr}}`
            : `tell application "System Events" to key code ${code}`;
          await runAppleScript(keyScript);
        } else {
          const keyScript = modifierStr
            ? `tell application "System Events" to keystroke "${appleKey}" using {${modifierStr}}`
            : `tell application "System Events" to keystroke "${appleKey}"`;
          await runAppleScript(keyScript);
        }
        
        const displayKey = modifiers.length > 0 ? `${modifiers.join('+')}+${key}` : key;
        return { content: [{ type: 'text', text: `Pressed: ${displayKey}` }] };
      } catch (error) {
        return { 
          content: [{ type: 'text', text: `Key press failed: ${error instanceof Error ? error.message : 'Unknown error'}` }], 
          isError: true 
        };
      }
    }
  },
  {
    name: 'mouse_drag',
    description: 'Click and drag from one point to another.',
    inputSchema: {
      type: 'object',
      properties: {
        fromX: { type: 'number', description: 'Starting X coordinate' },
        fromY: { type: 'number', description: 'Starting Y coordinate' },
        toX: { type: 'number', description: 'Ending X coordinate' },
        toY: { type: 'number', description: 'Ending Y coordinate' }
      },
      required: ['fromX', 'fromY', 'toX', 'toY']
    },
    handler: async (args) => {
      const fromX = Math.round(Number(args.fromX));
      const fromY = Math.round(Number(args.fromY));
      const toX = Math.round(Number(args.toX));
      const toY = Math.round(Number(args.toY));
      
      try {
        try {
          await execCommand('cliclick', [`dd:${fromX},${fromY}`, `du:${toX},${toY}`]);
          return { content: [{ type: 'text', text: `Dragged from (${fromX}, ${fromY}) to (${toX}, ${toY})` }] };
        } catch {
          const script = `
            do shell script "python3 -c \\"
import Quartz
import time
event = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseDown, (${fromX}, ${fromY}), Quartz.kCGMouseButtonLeft)
Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
time.sleep(0.1)
event = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseDragged, (${toX}, ${toY}), Quartz.kCGMouseButtonLeft)
Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
time.sleep(0.1)
event = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseUp, (${toX}, ${toY}), Quartz.kCGMouseButtonLeft)
Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
\\""
          `;
          await runAppleScript(script);
          return { content: [{ type: 'text', text: `Dragged from (${fromX}, ${fromY}) to (${toX}, ${toY})` }] };
        }
      } catch (error) {
        return { 
          content: [{ type: 'text', text: `Drag failed: ${error instanceof Error ? error.message : 'Unknown error'}` }], 
          isError: true 
        };
      }
    }
  },
  {
    name: 'scroll',
    description: 'Scroll up or down at current mouse position.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down'], description: 'Scroll direction' },
        amount: { type: 'number', description: 'Scroll amount (default: 3 lines)' }
      },
      required: ['direction']
    },
    handler: async (args) => {
      const direction = args.direction === 'up' ? 'up' : 'down';
      const amount = Math.abs(Number(args.amount) || 3);
      const scrollValue = direction === 'up' ? amount : -amount;
      
      try {
        try {
          await execCommand('cliclick', [`w:${direction === 'up' ? '' : '-'}${amount}`]);
          return { content: [{ type: 'text', text: `Scrolled ${direction} ${amount} units` }] };
        } catch {
          const script = `
            do shell script "python3 -c \\"
import Quartz
event = Quartz.CGEventCreateScrollWheelEvent(None, Quartz.kCGScrollEventUnitLine, 1, ${scrollValue})
Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
\\""
          `;
          await runAppleScript(script);
          return { content: [{ type: 'text', text: `Scrolled ${direction} ${amount} units` }] };
        }
      } catch (error) {
        return { 
          content: [{ type: 'text', text: `Scroll failed: ${error instanceof Error ? error.message : 'Unknown error'}` }], 
          isError: true 
        };
      }
    }
  }
];
