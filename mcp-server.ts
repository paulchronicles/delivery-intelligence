#!/usr/bin/env node
import 'dotenv/config'
import { registerAgent, createMCPServer } from './core/mcp/registry'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

// ─── Register all agents ──────────────────────────────────────
// To add a new agent: import it and call registerAgent()

import { requirementGapAgent } from './agents/requirement-gap/index'
registerAgent(requirementGapAgent)

import { testCaseGenerationAgent } from './agents/test-case-generation/index'
registerAgent(testCaseGenerationAgent)

// ─── Start server ─────────────────────────────────────────────

async function main() {
  const isHttp = process.env.MCP_TRANSPORT === 'http' || !!process.env.PORT

  if (isHttp) {
    const { StreamableHTTPServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/streamableHttp.js'
    )
    const express = (await import('express')).default
    const app = express()
    app.use(express.json())

    app.post('/mcp', async (req: any, res: any) => {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      const server = createMCPServer()
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    })

    app.get('/mcp', async (req: any, res: any) => {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      const server = createMCPServer()
      await server.connect(transport)
      await transport.handleRequest(req, res)
    })

    app.delete('/mcp', async (_req: any, res: any) => {
      res.status(200).end()
    })

    app.get('/health', (_req: any, res: any) => {
      res.json({
        status: 'ok',
        service: 'delivery-intelligence',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
      })
    })

    const port = parseInt(process.env.PORT ?? '3000')
    app.listen(port, () => {
      console.error(`Delivery Intelligence Platform running on port ${port} (HTTP mode)`)
    })
  } else {
    const transport = new StdioServerTransport()
    const server = createMCPServer()
    await server.connect(transport)
    console.error('Delivery Intelligence Platform running (stdio mode)')
  }
}

main().catch((err) => {
  console.error('Server failed to start:', err)
  process.exit(1)
})
