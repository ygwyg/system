/**
 * Command Execution Utilities
 */

import { spawn } from 'child_process';

/**
 * Safe command execution using spawn (no shell interpolation)
 */
export function execCommand(command: string, args: string[] = []): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { timeout: 30000 });
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || `Command failed with code ${code}`));
      }
    });
    
    proc.on('error', reject);
  });
}

/**
 * Run AppleScript safely using spawn
 */
export function runAppleScript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('osascript', ['-e', script], { timeout: 30000 });
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr || `AppleScript failed with code ${code}`));
      }
    });
    
    proc.on('error', reject);
  });
}
