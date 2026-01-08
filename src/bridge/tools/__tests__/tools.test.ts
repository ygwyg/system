/**
 * Tests for tool registry and types
 */

import { describe, it, expect } from 'vitest';
import { allTools } from '../index.js';
import type { SystemTool, ToolResult } from '../types.js';

describe('allTools registry', () => {
  it('should export an array of tools', () => {
    expect(Array.isArray(allTools)).toBe(true);
    expect(allTools.length).toBeGreaterThan(0);
  });

  it('all tools should have unique names', () => {
    const names = allTools.map((t) => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it('all tools should have required properties', () => {
    for (const tool of allTools) {
      expect(tool.name).toBeDefined();
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);

      expect(tool.description).toBeDefined();
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);

      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();

      expect(typeof tool.handler).toBe('function');
    }
  });

  it('all tools should have valid input schema structure', () => {
    for (const tool of allTools) {
      // Schema must be an object type
      expect(tool.inputSchema.type).toBe('object');

      // Properties must be an object
      expect(typeof tool.inputSchema.properties).toBe('object');

      // If required is defined, it must be an array
      if (tool.inputSchema.required !== undefined) {
        expect(Array.isArray(tool.inputSchema.required)).toBe(true);

        // All required fields must exist in properties
        for (const req of tool.inputSchema.required) {
          expect(tool.inputSchema.properties).toHaveProperty(req);
        }
      }
    }
  });

  describe('tool categories', () => {
    it('should have core tools', () => {
      const coreTools = allTools.filter(
        (t) =>
          t.name === 'open_url' ||
          t.name === 'open_app' ||
          t.name === 'run_applescript' ||
          t.name === 'run_shell'
      );
      expect(coreTools.length).toBeGreaterThanOrEqual(2);
    });

    it('should have volume tools', () => {
      const volumeTools = allTools.filter((t) => t.name.startsWith('volume_'));
      expect(volumeTools.length).toBeGreaterThanOrEqual(3);
    });

    it('should have music tools', () => {
      const musicTools = allTools.filter((t) => t.name.startsWith('music_'));
      expect(musicTools.length).toBeGreaterThanOrEqual(3);
    });

    it('should have screenshot tool', () => {
      const screenshotTools = allTools.filter((t) => t.name.includes('screenshot'));
      expect(screenshotTools.length).toBeGreaterThanOrEqual(1);
    });

    it('should have messaging tools', () => {
      const msgTools = allTools.filter(
        (t) => t.name.includes('imessage') || t.name.includes('message')
      );
      expect(msgTools.length).toBeGreaterThanOrEqual(1);
    });

    it('should have calendar tools', () => {
      const calTools = allTools.filter((t) => t.name.startsWith('calendar_'));
      expect(calTools.length).toBeGreaterThanOrEqual(1);
    });

    it('should have reminders tools', () => {
      const reminderTools = allTools.filter((t) => t.name.startsWith('reminder'));
      expect(reminderTools.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('ToolResult type', () => {
  it('should accept valid text result', () => {
    const result: ToolResult = {
      content: [{ type: 'text', text: 'Hello' }],
    };
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
  });

  it('should accept valid image result', () => {
    const result: ToolResult = {
      content: [{ type: 'image', data: 'base64data', mimeType: 'image/png' }],
    };
    expect(result.content[0].type).toBe('image');
    expect(result.content[0].data).toBeDefined();
  });

  it('should accept error result', () => {
    const result: ToolResult = {
      content: [{ type: 'text', text: 'Error occurred' }],
      isError: true,
    };
    expect(result.isError).toBe(true);
  });

  it('should accept mixed content', () => {
    const result: ToolResult = {
      content: [
        { type: 'text', text: 'Here is an image:' },
        { type: 'image', data: 'base64data', mimeType: 'image/jpeg' },
      ],
    };
    expect(result.content).toHaveLength(2);
  });
});

describe('SystemTool type', () => {
  it('should define a valid tool structure', () => {
    const tool: SystemTool = {
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: {
        type: 'object',
        properties: {
          param1: { type: 'string', description: 'A parameter' },
        },
        required: ['param1'],
      },
      handler: async (args) => {
        return {
          content: [{ type: 'text', text: `Received: ${args.param1}` }],
        };
      },
    };

    expect(tool.name).toBe('test_tool');
    expect(tool.inputSchema.required).toContain('param1');
  });
});
