#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { allTools } from './tools.js';

/**
 * Raycast MCP Bridge Server
 * 
 * This server exposes Raycast deep links as MCP tools, allowing
 * AI agents (like Cloudflare Agents) to control Raycast extensions.
 */
class RaycastBridgeServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'raycast-bridge',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: allTools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Find the tool
      const tool = allTools.find(t => t.name === name);
      
      if (!tool) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error: Tool "${name}" not found. Available tools: ${allTools.map(t => t.name).join(', ')}`
          }],
          isError: true,
        };
      }

      try {
        // Execute the tool
        const result = await tool.handler(args || {});
        return {
          content: result.content.map(c => ({
            type: 'text' as const,
            text: c.text
          })),
          isError: result.isError,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error executing "${name}": ${errorMessage}`
          }],
          isError: true,
        };
      }
    });
  }

  private setupErrorHandling() {
    this.server.onerror = (error) => {
      console.error('[MCP Error]', error);
    };

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    // Log to stderr so it doesn't interfere with MCP protocol on stdout
    console.error('Raycast Bridge MCP Server running...');
    console.error(`Available tools: ${allTools.length}`);
    console.error('Tools:', allTools.map(t => t.name).join(', '));
  }
}

// Start the server
const server = new RaycastBridgeServer();
server.run().catch(console.error);
