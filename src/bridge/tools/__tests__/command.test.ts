/**
 * Tests for command execution utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execCommand, runAppleScript } from '../utils/command.js';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

const mockSpawn = vi.mocked(spawn);

function createMockProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

describe('execCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should execute a command and return stdout', async () => {
    const mockProc = createMockProcess();
    mockSpawn.mockReturnValue(mockProc as ReturnType<typeof spawn>);

    const promise = execCommand('echo', ['hello']);

    // Simulate process output
    mockProc.stdout.emit('data', 'hello\n');
    mockProc.emit('close', 0);

    const result = await promise;
    expect(result.stdout).toBe('hello\n');
    expect(result.stderr).toBe('');
    expect(mockSpawn).toHaveBeenCalledWith('echo', ['hello'], { timeout: 30000 });
  });

  it('should capture stderr', async () => {
    const mockProc = createMockProcess();
    mockSpawn.mockReturnValue(mockProc as ReturnType<typeof spawn>);

    const promise = execCommand('some-command', []);

    mockProc.stdout.emit('data', 'output');
    mockProc.stderr.emit('data', 'warning');
    mockProc.emit('close', 0);

    const result = await promise;
    expect(result.stdout).toBe('output');
    expect(result.stderr).toBe('warning');
  });

  it('should reject on non-zero exit code', async () => {
    const mockProc = createMockProcess();
    mockSpawn.mockReturnValue(mockProc as ReturnType<typeof spawn>);

    const promise = execCommand('failing-command', []);

    mockProc.stderr.emit('data', 'Error message');
    mockProc.emit('close', 1);

    await expect(promise).rejects.toThrow('Error message');
  });

  it('should reject on process error', async () => {
    const mockProc = createMockProcess();
    mockSpawn.mockReturnValue(mockProc as ReturnType<typeof spawn>);

    const promise = execCommand('nonexistent', []);

    mockProc.emit('error', new Error('ENOENT'));

    await expect(promise).rejects.toThrow('ENOENT');
  });

  it('should handle empty args', async () => {
    const mockProc = createMockProcess();
    mockSpawn.mockReturnValue(mockProc as ReturnType<typeof spawn>);

    execCommand('pwd');

    expect(mockSpawn).toHaveBeenCalledWith('pwd', [], { timeout: 30000 });
    mockProc.emit('close', 0);
  });
});

describe('runAppleScript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should execute AppleScript and return trimmed output', async () => {
    const mockProc = createMockProcess();
    mockSpawn.mockReturnValue(mockProc as ReturnType<typeof spawn>);

    const promise = runAppleScript('tell application "Finder" to activate');

    mockProc.stdout.emit('data', 'result\n');
    mockProc.emit('close', 0);

    const result = await promise;
    expect(result).toBe('result');
    expect(mockSpawn).toHaveBeenCalledWith(
      'osascript',
      ['-e', 'tell application "Finder" to activate'],
      { timeout: 30000 }
    );
  });

  it('should reject on AppleScript error', async () => {
    const mockProc = createMockProcess();
    mockSpawn.mockReturnValue(mockProc as ReturnType<typeof spawn>);

    const promise = runAppleScript('invalid script');

    mockProc.stderr.emit('data', 'syntax error');
    mockProc.emit('close', 1);

    await expect(promise).rejects.toThrow('syntax error');
  });

  it('should handle AppleScript with special characters', async () => {
    const mockProc = createMockProcess();
    mockSpawn.mockReturnValue(mockProc as ReturnType<typeof spawn>);

    const script = 'display dialog "Hello \\"World\\""';
    runAppleScript(script);

    expect(mockSpawn).toHaveBeenCalledWith('osascript', ['-e', script], { timeout: 30000 });
    mockProc.emit('close', 0);
  });

  it('should trim whitespace from output', async () => {
    const mockProc = createMockProcess();
    mockSpawn.mockReturnValue(mockProc as ReturnType<typeof spawn>);

    const promise = runAppleScript('return "test"');

    mockProc.stdout.emit('data', '  test  \n  ');
    mockProc.emit('close', 0);

    const result = await promise;
    expect(result).toBe('test');
  });
});
