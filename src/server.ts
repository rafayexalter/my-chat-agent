import { routeAgentRequest, type Schedule } from "agents";

import { unstable_getSchedulePrompt } from "agents/schedule";

import { AIChatAgent } from "agents/ai-chat-agent";
import {
  createDataStreamResponse,
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
  type ToolSet,
} from "ai";
import { openai } from "@ai-sdk/openai";
import { processToolCalls } from "./utils";
import { tools, executions } from "./tools";
import { getEnabledMCPServers, getMCPInstructions } from "./mcp-servers";

// import { env } from "cloudflare:workers";

const model = openai("gpt-4o-2024-11-20");
// Cloudflare AI Gateway
// const openai = createOpenAI({
//   apiKey: env.OPENAI_API_KEY,
//   baseURL: env.GATEWAY_BASE_URL,
// });

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
  /**
   * Handles incoming chat messages and manages the response stream
   * @param onFinish - Callback function executed when streaming completes
   */

  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: { abortSignal?: AbortSignal }
  ) {
    // Connect to all enabled MCP servers
    const enabledServers = getEnabledMCPServers();
    const mcpConnections: Array<{ connection: any; server: any }> = [];

    for (const server of enabledServers) {
      try {
        const connection = await this.mcp.connect(server.url);
        mcpConnections.push({ connection, server });
        console.log(`Connected to MCP server: ${server.name}`);
      } catch (error) {
        console.error(`Failed to connect to MCP server ${server.name}:`, error);
      }
    }

    // Collect all tools, including MCP tools
    const allTools = {
      ...tools,
      ...this.mcp.unstable_getAITools(),
    };

    // Create a streaming response that handles both text and tool outputs
    const dataStreamResponse = createDataStreamResponse({
      execute: async (dataStream) => {
        // Process any pending tool calls from previous messages
        // This handles human-in-the-loop confirmations for tools
        const processedMessages = await processToolCalls({
          messages: this.messages,
          dataStream,
          tools: allTools,
          executions,
        });

        // Shop context will be provided via frontend postMessage
        // For now, just mention we're in Shopify context
        const shopContextPrompt = `

SHOPIFY CONTEXT:
- You are embedded in a Shopify admin app
- You can help with calculations using MCP tools
- Current time: ${new Date().toISOString()}
`;

        // Stream the AI response using GPT-4
        const result = streamText({
          model,
          system: `You are a helpful assistant that can do various tasks... 

${unstable_getSchedulePrompt({ date: new Date() })}

If the user asks to schedule a task, use the schedule tool to schedule the task.

${getMCPInstructions()}
${shopContextPrompt}
`,
          messages: processedMessages,
          tools: allTools,
          onFinish: async (args) => {
            onFinish(
              args as Parameters<StreamTextOnFinishCallback<ToolSet>>[0]
            );
            // Close all MCP connections
            for (const { connection } of mcpConnections) {
              try {
                await this.mcp.closeConnection(connection.id);
              } catch (error) {
                console.error("Error closing MCP connection:", error);
              }
            }
          },
          onError: (error) => {
            console.error("Error while streaming:", error);
          },
          maxSteps: 10,
        });

        // Merge the AI response stream with tool execution outputs
        result.mergeIntoDataStream(dataStream);
      },
    });

    return dataStreamResponse;
  }
  async executeTask(description: string, _task: Schedule<string>) {
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        content: `Running scheduled task: ${description}`,
        createdAt: new Date(),
      },
    ]);
  }
}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/check-open-ai-key") {
      const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
      return Response.json({
        success: hasOpenAIKey,
      });
    }

    // Handle shop context endpoint for Shopify integration
    if (url.pathname === "/shop-context" && request.method === "POST") {
      try {
        const body = (await request.json()) as {
          shop?: string;
          shopData?: any;
          user?: string;
          timestamp?: string;
        };
        const { shop, shopData, user, timestamp } = body;

        console.log("📊 Received shop context:", {
          shop,
          shopData,
          user,
          timestamp,
        });

        // Store shop context in environment/KV/Durable Objects if needed
        // For now, just acknowledge receipt
        return Response.json({
          success: true,
          message: "Shop context received",
          context: { shop, user },
        });
      } catch (error) {
        console.error("Failed to process shop context:", error);
        return Response.json(
          { error: "Invalid shop context" },
          { status: 400 }
        );
      }
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error(
        "OPENAI_API_KEY is not set, don't forget to set it locally in .dev.vars, and use `wrangler secret bulk .dev.vars` to upload it to production"
      );
    }

    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
