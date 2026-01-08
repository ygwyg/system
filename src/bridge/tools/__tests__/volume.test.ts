/**
 * Tests for volume tool handlers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { volumeTools } from '../volume.js';

// Mock the command module
vi.mock('../utils/command.js', () => ({
  runAppleScript: vi.fn(),
}));

import { runAppleScript } from '../utils/command.js';

const mockRunAppleScript = vi.mocked(runAppleScript);

describe('volumeTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('volume_set', () => {
    const volumeSet = volumeTools.find((t) => t.name === 'volume_set')!;

    it('should have correct metadata', () => {
      expect(volumeSet).toBeDefined();
      expect(volumeSet.description).toContain('volume');
      expect(volumeSet.inputSchema.required).toContain('level');
    });

    it('should set volume to specified level', async () => {
      mockRunAppleScript.mockResolvedValue('');
      const result = await volumeSet.handler({ level: 50 });

      expect(mockRunAppleScript).toHaveBeenCalledWith('set volume output volume 50');
      expect(result.content[0].text).toContain('50%');
      expect(result.isError).toBeUndefined();
    });

    it('should clamp volume to 0-100 range (high)', async () => {
      mockRunAppleScript.mockResolvedValue('');
      await volumeSet.handler({ level: 150 });

      expect(mockRunAppleScript).toHaveBeenCalledWith('set volume output volume 100');
    });

    it('should clamp volume to 0-100 range (low)', async () => {
      mockRunAppleScript.mockResolvedValue('');
      await volumeSet.handler({ level: -50 });

      expect(mockRunAppleScript).toHaveBeenCalledWith('set volume output volume 0');
    });

    it('should handle invalid input', async () => {
      mockRunAppleScript.mockResolvedValue('');
      await volumeSet.handler({ level: 'invalid' });

      // Should default to 50 when parsing fails
      expect(mockRunAppleScript).toHaveBeenCalledWith('set volume output volume 50');
    });

    it('should return error on AppleScript failure', async () => {
      mockRunAppleScript.mockRejectedValue(new Error('AppleScript failed'));
      const result = await volumeSet.handler({ level: 50 });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });
  });

  describe('volume_get', () => {
    const volumeGet = volumeTools.find((t) => t.name === 'volume_get')!;

    it('should have correct metadata', () => {
      expect(volumeGet).toBeDefined();
      expect(volumeGet.description).toContain('current');
    });

    it('should return current volume level', async () => {
      mockRunAppleScript.mockResolvedValue('75');
      const result = await volumeGet.handler({});

      expect(mockRunAppleScript).toHaveBeenCalledWith('output volume of (get volume settings)');
      expect(result.content[0].text).toContain('75%');
    });

    it('should return error on failure', async () => {
      mockRunAppleScript.mockRejectedValue(new Error('Failed'));
      const result = await volumeGet.handler({});

      expect(result.isError).toBe(true);
    });
  });

  describe('volume_up', () => {
    const volumeUp = volumeTools.find((t) => t.name === 'volume_up')!;

    it('should increase volume by 10', async () => {
      mockRunAppleScript.mockResolvedValueOnce('50').mockResolvedValueOnce('');

      const result = await volumeUp.handler({});

      expect(mockRunAppleScript).toHaveBeenNthCalledWith(
        1,
        'output volume of (get volume settings)'
      );
      expect(mockRunAppleScript).toHaveBeenNthCalledWith(2, 'set volume output volume 60');
      expect(result.content[0].text).toContain('60%');
    });

    it('should not exceed 100', async () => {
      mockRunAppleScript.mockResolvedValueOnce('95').mockResolvedValueOnce('');

      await volumeUp.handler({});

      expect(mockRunAppleScript).toHaveBeenNthCalledWith(2, 'set volume output volume 100');
    });
  });

  describe('volume_down', () => {
    const volumeDown = volumeTools.find((t) => t.name === 'volume_down')!;

    it('should decrease volume by 10', async () => {
      mockRunAppleScript.mockResolvedValueOnce('50').mockResolvedValueOnce('');

      const result = await volumeDown.handler({});

      expect(mockRunAppleScript).toHaveBeenNthCalledWith(2, 'set volume output volume 40');
      expect(result.content[0].text).toContain('40%');
    });

    it('should not go below 0', async () => {
      mockRunAppleScript.mockResolvedValueOnce('5').mockResolvedValueOnce('');

      await volumeDown.handler({});

      expect(mockRunAppleScript).toHaveBeenNthCalledWith(2, 'set volume output volume 0');
    });
  });

  describe('volume_mute', () => {
    const volumeMute = volumeTools.find((t) => t.name === 'volume_mute')!;

    it('should mute when currently unmuted', async () => {
      mockRunAppleScript.mockResolvedValueOnce('false').mockResolvedValueOnce('');

      const result = await volumeMute.handler({});

      expect(mockRunAppleScript).toHaveBeenNthCalledWith(2, 'set volume output muted true');
      expect(result.content[0].text).toContain('muted');
    });

    it('should unmute when currently muted', async () => {
      mockRunAppleScript.mockResolvedValueOnce('true').mockResolvedValueOnce('');

      const result = await volumeMute.handler({});

      expect(mockRunAppleScript).toHaveBeenNthCalledWith(2, 'set volume output muted false');
      expect(result.content[0].text).toContain('unmuted');
    });
  });
});

describe('volumeTools structure', () => {
  it('should export all volume tools', () => {
    expect(volumeTools).toHaveLength(5);
  });

  it('all tools should have required properties', () => {
    for (const tool of volumeTools) {
      expect(tool.name).toBeDefined();
      expect(tool.name.startsWith('volume_')).toBe(true);
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.handler).toBe('function');
    }
  });

  it('all tools should have valid input schemas', () => {
    for (const tool of volumeTools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });
});
