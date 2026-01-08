/**
 * Tests for validation utilities and security functions
 */

import { describe, it, expect } from 'vitest';
import {
  validateShellCommand,
  containsBlockedPath,
  BLOCKED_PATHS,
  SAFE_SHELL_COMMANDS,
  DANGEROUS_PATTERNS,
  schemas,
} from '../utils/validation.js';

describe('validateShellCommand', () => {
  describe('safe commands', () => {
    it('should allow basic ls command', () => {
      const result = validateShellCommand('ls');
      expect(result.error).toBeUndefined();
      expect(result.command).toBe('ls');
      expect(result.args).toEqual([]);
    });

    it('should allow ls with arguments', () => {
      const result = validateShellCommand('ls -la');
      expect(result.error).toBeUndefined();
      expect(result.command).toBe('ls');
      expect(result.args).toEqual(['-la']);
    });

    it('should allow pwd', () => {
      const result = validateShellCommand('pwd');
      expect(result.error).toBeUndefined();
      expect(result.command).toBe('pwd');
    });

    it('should allow whoami', () => {
      const result = validateShellCommand('whoami');
      expect(result.error).toBeUndefined();
      expect(result.command).toBe('whoami');
    });

    it('should allow date with args', () => {
      const result = validateShellCommand('date +%Y-%m-%d');
      expect(result.error).toBeUndefined();
      expect(result.command).toBe('date');
    });

    it('should allow cat for reading files', () => {
      const result = validateShellCommand('cat /tmp/test.txt');
      expect(result.error).toBeUndefined();
      expect(result.command).toBe('cat');
    });

    it('should allow echo', () => {
      const result = validateShellCommand('echo "hello world"');
      expect(result.error).toBeUndefined();
      expect(result.command).toBe('echo');
      expect(result.args).toEqual(['hello world']);
    });

    it('should allow grep', () => {
      const result = validateShellCommand('grep pattern file.txt');
      expect(result.error).toBeUndefined();
      expect(result.command).toBe('grep');
    });
  });

  describe('pipe commands', () => {
    it('should allow safe pipes', () => {
      const result = validateShellCommand('ls | grep test');
      expect(result.error).toBeUndefined();
      expect(result.useShell).toBe(true);
      expect(result.command).toBe('/bin/sh');
      expect(result.args).toEqual(['-c', 'ls | grep test']);
    });

    it('should allow multiple pipes', () => {
      const result = validateShellCommand('cat file.txt | grep pattern | sort | uniq');
      expect(result.error).toBeUndefined();
      expect(result.useShell).toBe(true);
    });

    it('should block non-pipeable commands in pipe destination', () => {
      const result = validateShellCommand('ls | pwd');
      expect(result.error).toContain('cannot be used in a pipe');
    });
  });

  describe('blocked commands', () => {
    it('should block rm -rf', () => {
      const result = validateShellCommand('rm -rf /');
      expect(result.error).toContain('Blocked');
    });

    it('should block rm with wildcards', () => {
      const result = validateShellCommand('rm *');
      expect(result.error).toContain('Blocked');
    });

    it('should block sudo', () => {
      const result = validateShellCommand('sudo ls');
      expect(result.error).toContain('Blocked');
    });

    it('should block backtick execution', () => {
      const result = validateShellCommand('echo `whoami`');
      expect(result.error).toContain('Blocked');
    });

    it('should block command substitution', () => {
      const result = validateShellCommand('echo $(whoami)');
      expect(result.error).toContain('Blocked');
    });

    it('should block pipe to shell', () => {
      const result = validateShellCommand('echo test | sh');
      expect(result.error).toContain('Blocked');
    });

    it('should block commands not in safelist', () => {
      // Test an unlisted command
      const result = validateShellCommand('nc -l 1234');
      expect(result.error).toContain('not in safe list');
    });

    it('should block dd command', () => {
      const result = validateShellCommand('dd if=/dev/zero of=/dev/sda');
      expect(result.error).toContain('Blocked');
    });

    it('should block chained rm after &&', () => {
      const result = validateShellCommand('ls && rm file.txt');
      expect(result.error).toContain('Blocked');
    });
  });

  describe('blocked paths', () => {
    it('should block access to .env files', () => {
      const result = validateShellCommand('cat .env');
      expect(result.error).toContain('Blocked');
    });

    it('should block access to .ssh directory', () => {
      const result = validateShellCommand('cat ~/.ssh/id_rsa');
      expect(result.error).toContain('Blocked');
    });

    it('should block access to .aws directory', () => {
      const result = validateShellCommand('cat ~/.aws/credentials');
      expect(result.error).toContain('Blocked');
    });

    it('should block access to password files', () => {
      const result = validateShellCommand('cat passwords.txt');
      expect(result.error).toContain('Blocked');
    });

    it('should block access to keychain', () => {
      const result = validateShellCommand('cat keychain.db');
      expect(result.error).toContain('Blocked');
    });
  });

  describe('git commands', () => {
    it('should allow git status', () => {
      const result = validateShellCommand('git status');
      expect(result.error).toBeUndefined();
    });

    it('should allow git log', () => {
      const result = validateShellCommand('git log --oneline -10');
      expect(result.error).toBeUndefined();
    });

    it('should allow git diff', () => {
      const result = validateShellCommand('git diff HEAD~1');
      expect(result.error).toBeUndefined();
    });

    it('should block git push', () => {
      const result = validateShellCommand('git push origin main');
      expect(result.error).toContain('not allowed');
    });

    it('should block git reset', () => {
      const result = validateShellCommand('git reset --hard HEAD~1');
      expect(result.error).toContain('not allowed');
    });
  });

  describe('npm commands', () => {
    it('should allow npm list', () => {
      const result = validateShellCommand('npm list');
      expect(result.error).toBeUndefined();
    });

    it('should allow npm run test', () => {
      const result = validateShellCommand('npm run test');
      expect(result.error).toBeUndefined();
    });

    it('should block npm install', () => {
      const result = validateShellCommand('npm install malware');
      expect(result.error).toContain('not allowed');
    });
  });

  describe('edge cases', () => {
    it('should handle empty command', () => {
      const result = validateShellCommand('');
      expect(result.error).toBe('Empty command');
    });

    it('should handle whitespace-only command', () => {
      const result = validateShellCommand('   ');
      expect(result.error).toBe('Empty command');
    });

    it('should handle quoted arguments', () => {
      const result = validateShellCommand('echo "hello world"');
      expect(result.error).toBeUndefined();
      expect(result.args).toEqual(['hello world']);
    });

    it('should handle single-quoted arguments', () => {
      const result = validateShellCommand("echo 'hello world'");
      expect(result.error).toBeUndefined();
      expect(result.args).toEqual(['hello world']);
    });
  });
});

describe('containsBlockedPath', () => {
  it('should detect .env files', () => {
    expect(containsBlockedPath(['.env'])).toBe(true);
    expect(containsBlockedPath(['.env.local'])).toBe(true);
    expect(containsBlockedPath(['path/to/.env'])).toBe(true);
  });

  it('should detect SSH keys', () => {
    expect(containsBlockedPath(['~/.ssh/id_rsa'])).toBe(true);
    expect(containsBlockedPath(['.ssh'])).toBe(true);
    expect(containsBlockedPath(['id_ed25519'])).toBe(true);
  });

  it('should detect AWS credentials', () => {
    expect(containsBlockedPath(['~/.aws/credentials'])).toBe(true);
    expect(containsBlockedPath(['.aws'])).toBe(true);
  });

  it('should detect password/secret files', () => {
    expect(containsBlockedPath(['passwords.txt'])).toBe(true);
    expect(containsBlockedPath(['secrets.json'])).toBe(true);
    expect(containsBlockedPath(['api_token.txt'])).toBe(true);
  });

  it('should allow safe paths', () => {
    expect(containsBlockedPath(['/tmp/test.txt'])).toBe(false);
    expect(containsBlockedPath(['~/Documents/file.txt'])).toBe(false);
    expect(containsBlockedPath(['README.md'])).toBe(false);
  });
});

describe('BLOCKED_PATHS patterns', () => {
  it('should have patterns for all sensitive file types', () => {
    const sensitivePatterns = [
      '.env',
      '.ssh',
      '.aws',
      '.gnupg',
      'id_rsa',
      'password',
      'secret',
      'token',
    ];
    for (const pattern of sensitivePatterns) {
      const hasPattern = BLOCKED_PATHS.some((p) => p.test(pattern));
      expect(hasPattern).toBe(true);
    }
  });
});

describe('DANGEROUS_PATTERNS', () => {
  it('should catch rm -rf', () => {
    const hasMatch = DANGEROUS_PATTERNS.some((p) => p.test('rm -rf /'));
    expect(hasMatch).toBe(true);
  });

  it('should catch sudo', () => {
    const hasMatch = DANGEROUS_PATTERNS.some((p) => p.test('sudo anything'));
    expect(hasMatch).toBe(true);
  });

  it('should catch backticks', () => {
    const hasMatch = DANGEROUS_PATTERNS.some((p) => p.test('`whoami`'));
    expect(hasMatch).toBe(true);
  });

  it('should catch command substitution', () => {
    const hasMatch = DANGEROUS_PATTERNS.some((p) => p.test('$(whoami)'));
    expect(hasMatch).toBe(true);
  });
});

describe('SAFE_SHELL_COMMANDS', () => {
  it('should have common safe commands', () => {
    expect(SAFE_SHELL_COMMANDS).toHaveProperty('ls');
    expect(SAFE_SHELL_COMMANDS).toHaveProperty('pwd');
    expect(SAFE_SHELL_COMMANDS).toHaveProperty('whoami');
    expect(SAFE_SHELL_COMMANDS).toHaveProperty('cat');
    expect(SAFE_SHELL_COMMANDS).toHaveProperty('grep');
    expect(SAFE_SHELL_COMMANDS).toHaveProperty('git');
  });

  it('should have descriptions for all commands', () => {
    for (const [_cmd, config] of Object.entries(SAFE_SHELL_COMMANDS)) {
      expect(config.description).toBeDefined();
      expect(config.description.length).toBeGreaterThan(0);
    }
  });
});

describe('Zod schemas', () => {
  describe('openUrl schema', () => {
    it('should accept valid URLs', () => {
      expect(() => schemas.openUrl.parse({ url: 'https://example.com' })).not.toThrow();
      expect(() => schemas.openUrl.parse({ url: 'http://localhost:3000' })).not.toThrow();
    });

    it('should reject invalid URLs', () => {
      expect(() => schemas.openUrl.parse({ url: 'not-a-url' })).toThrow();
      expect(() => schemas.openUrl.parse({ url: '' })).toThrow();
    });
  });

  describe('openApp schema', () => {
    it('should accept valid app names', () => {
      expect(() => schemas.openApp.parse({ name: 'Safari' })).not.toThrow();
      expect(() => schemas.openApp.parse({ name: 'Visual Studio Code' })).not.toThrow();
    });

    it('should reject empty names', () => {
      expect(() => schemas.openApp.parse({ name: '' })).toThrow();
    });

    it('should reject too long names', () => {
      expect(() => schemas.openApp.parse({ name: 'a'.repeat(101) })).toThrow();
    });
  });

  describe('applescript schema', () => {
    it('should accept valid scripts', () => {
      expect(() =>
        schemas.applescript.parse({ script: 'tell application "Finder" to activate' })
      ).not.toThrow();
    });

    it('should reject empty scripts', () => {
      expect(() => schemas.applescript.parse({ script: '' })).toThrow();
    });

    it('should reject too long scripts', () => {
      expect(() => schemas.applescript.parse({ script: 'a'.repeat(10001) })).toThrow();
    });
  });

  describe('raycastCommand schema', () => {
    it('should accept valid commands', () => {
      expect(() =>
        schemas.raycastCommand.parse({
          extension: 'my-extension',
          command: 'run',
        })
      ).not.toThrow();
    });

    it('should accept commands with arguments', () => {
      expect(() =>
        schemas.raycastCommand.parse({
          extension: 'my-extension',
          command: 'run',
          arguments: { query: 'test' },
        })
      ).not.toThrow();
    });

    it('should reject missing extension', () => {
      expect(() =>
        schemas.raycastCommand.parse({
          command: 'run',
        })
      ).toThrow();
    });

    it('should reject missing command', () => {
      expect(() =>
        schemas.raycastCommand.parse({
          extension: 'my-extension',
        })
      ).toThrow();
    });
  });
});
