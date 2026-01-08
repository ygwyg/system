/**
 * Screenshot Tool - Screen capture
 */

import { spawn } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { SystemTool } from './types.js';

export const screenshotTools: SystemTool[] = [
  {
    name: 'screenshot',
    description: 'Take a screenshot of the current screen and return the image',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Type of screenshot: "full" for full screen, "window" for front window',
          enum: ['full', 'window'],
        },
      },
    },
    handler: async (args) => {
      const type = args.type === 'window' ? 'window' : 'full';
      const tmpFile = join(tmpdir(), `screenshot-${Date.now()}.png`);
      const resizedFile = join(tmpdir(), `screenshot-resized-${Date.now()}.jpg`);

      try {
        // Take screenshot using macOS screencapture
        await new Promise<void>((resolve, reject) => {
          const screencaptureArgs = type === 'window' ? ['-w', '-o', tmpFile] : ['-x', tmpFile];

          const proc = spawn('screencapture', screencaptureArgs, { timeout: 10000 });
          proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`screencapture failed with code ${code}`));
          });
          proc.on('error', reject);
        });

        // Resize image to fit within Claude's 5MB limit
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(
            'sips',
            [
              '--resampleWidth',
              '1920',
              '--setProperty',
              'format',
              'jpeg',
              '--setProperty',
              'formatOptions',
              '80',
              tmpFile,
              '--out',
              resizedFile,
            ],
            { timeout: 10000 }
          );
          proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`sips resize failed with code ${code}`));
          });
          proc.on('error', reject);
        });

        const imageBuffer = readFileSync(resizedFile);
        const base64Image = imageBuffer.toString('base64');

        // Save a copy to a dedicated folder
        const screenshotDir = join(process.env.HOME || '/tmp', 'Pictures', 'SYSTEM Screenshots');
        try {
          mkdirSync(screenshotDir, { recursive: true });
        } catch (error) {
          console.error('Failed to create screenshot directory:', error);
        }
        const savedPath = join(screenshotDir, `screenshot-${Date.now()}.jpg`);
        try {
          writeFileSync(savedPath, imageBuffer);
        } catch (error) {
          console.error('Failed to save screenshot:', error);
        }

        // Clean up temp files
        try {
          unlinkSync(tmpFile);
        } catch {
          /* temp file cleanup, ignore */
        }
        try {
          unlinkSync(resizedFile);
        } catch {
          /* temp file cleanup, ignore */
        }

        return {
          content: [
            {
              type: 'image',
              data: base64Image,
              mimeType: 'image/jpeg',
            },
          ],
          savedTo: savedPath,
        } as any;
      } catch (error) {
        try {
          unlinkSync(tmpFile);
        } catch {
          /* temp file cleanup, ignore */
        }
        try {
          unlinkSync(resizedFile);
        } catch {
          /* temp file cleanup, ignore */
        }
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
    name: 'get_screen_size',
    description: 'Get the screen dimensions (useful for calculating click coordinates).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const { spawn } = await import('child_process');
        const { stdout } = await new Promise<{ stdout: string; stderr: string }>(
          (resolve, reject) => {
            const proc = spawn('osascript', [
              '-e',
              `
            use framework "AppKit"
            set screenFrame to current application's NSScreen's mainScreen()'s frame()
            set screenWidth to item 1 of item 2 of screenFrame
            set screenHeight to item 2 of item 2 of screenFrame
            return (screenWidth as integer) & "x" & (screenHeight as integer)
          `,
            ]);
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (data) => {
              stdout += data.toString();
            });
            proc.stderr.on('data', (data) => {
              stderr += data.toString();
            });
            proc.on('close', () => resolve({ stdout, stderr }));
            proc.on('error', reject);
          }
        );
        const [width, height] = stdout.trim().split('x').map(Number);
        return { content: [{ type: 'text', text: `Screen size: ${width}x${height}` }] };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to get screen size: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  },
];
