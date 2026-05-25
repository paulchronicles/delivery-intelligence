import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

// ─── Agent interface ──────────────────────────────────────────
// Every agent exports this shape from its index.ts

export interface AgentToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: string
    properties: Record<string, any>
    required: string[]
  }
}

export interface DeliveryAgent {
  tools: AgentToolDefinition[]
  handle(toolName: string, args: Record<string, any>): Promise<{ content: Array<{ type: string; text: string }> }>
}

// ─── Registry ─────────────────────────────────────────────────

const registeredAgents: DeliveryAgent[] = []

export function registerAgent(agent: DeliveryAgent): void {
  registeredAgents.push(agent)
  console.error(`[Registry] Registered agent with tools: ${agent.tools.map(t => t.name).join(', ')}`)
}

// ─── Wire all registered agents into an MCP server ───────────

export function createMCPServer(): Server {
  const server = new Server(
    { name: 'delivery-intelligence', version: '1.0.0' },
    { capabilities: { tools: {} } }
  )

  // List all tools from all registered agents
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registeredAgents.flatMap(agent => agent.tools)
  }))

  // Route tool calls to the correct agent
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    for (const agent of registeredAgents) {
      if (agent.tools.some(t => t.name === name)) {
        return agent.handle(name, (args as Record<string, any>) ?? {})
      }
    }

    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }]
    }
  })

  return server
}
