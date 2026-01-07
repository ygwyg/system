/**
 * Tool Types and Interfaces
 */

export interface ToolResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

export interface SystemTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface BridgeConfig {
  extensions?: Array<{
    name: string;
    author: string;
    owner?: string;
    commands: Array<{
      name: string;
      title: string;
      description?: string;
      arguments?: Array<{
        name: string;
        type: string;
        description?: string;
        required?: boolean;
      }>;
    }>;
  }>;
}
