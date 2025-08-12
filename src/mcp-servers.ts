export interface MCPServer {
  id: string;
  name: string;
  url: string;
  instructions: string;
  enabled: boolean;
}

export const mcpServers: MCPServer[] = [
  {
    id: "calculator",
    name: "Custom Calculator",
    url: "https://remote-mcp-server.rafayexalter.workers.dev/sse",
    instructions:
      "Use this for mathematical calculations like addition, subtraction, multiplication, division",
    enabled: true,
  },
  // Add more MCP servers here
  // {
  //   id: "weather",
  //   name: "Weather Service",
  //   url: "https://your-weather-mcp.workers.dev/sse",
  //   instructions: "Use this for weather information and forecasts",
  //   enabled: true,
  // },
];

export function getEnabledMCPServers(): MCPServer[] {
  return mcpServers.filter((server) => server.enabled);
}

export function getMCPInstructions(): string {
  const enabledServers = getEnabledMCPServers();

  if (enabledServers.length === 0) {
    return "";
  }

  return `Available MCP Services:
${enabledServers
  .map(
    (server) => `
${server.name}:
${server.instructions}
`
  )
  .join("\n")}`;
}
