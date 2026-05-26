import { DeliveryAgent, AgentToolDefinition } from '../../core/mcp/registry'
import { createObservabilityAdapter } from '../../core/observability/factory'
import { analyseGaps, formatCoverageReport, TestedEndpoint } from './analyser'
import { ObservabilitySnapshot } from '../../core/observability/index'
import path from 'path'
import fs from 'fs'

function loadTeamConfig(projectKey: string): any {
  const teamsDir = path.join(__dirname, '..', '..', 'config', 'teams')
  if (!fs.existsSync(teamsDir)) return null
  for (const file of fs.readdirSync(teamsDir)) {
    try {
      const raw = fs.readFileSync(path.join(teamsDir, file), 'utf8')
      const config = require('js-yaml').load(raw) as any
      if (config?.project_key?.toUpperCase() === projectKey.toUpperCase()) {
        return { ...config }
      }
    } catch { continue }
  }
  return null
}

const tools: AgentToolDefinition[] = [
  {
    name: 'get_coverage_gaps',
    description:
      'Analyses production usage data and cross-checks against existing test coverage ' +
      'to identify gaps — endpoints with high traffic or error rates that have no automated tests. ' +
      'Use this when someone asks: what are our coverage gaps, what should we automate next, ' +
      'production coverage report, coverage intelligence, what are we not testing, ' +
      'which journeys have no coverage, coverage health check, where are our testing blind spots. ' +
      'Requires observability platform configured in team config. ' +
      'Returns prioritised gaps, trend analysis, and automation recommendations.',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: {
          type: 'string',
          description: 'The project key to analyse. Examples: SCRUM, PAY, QT',
        },
        lookback_days: {
          type: 'number',
          description: 'How many days of production data to analyse. Defaults to 30.',
        },
        existing_tests: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              scenarios: { type: 'array', items: { type: 'string' } },
            },
          },
          description: 'Optional: list of tested endpoints with scenario names from test repo scan.',
        },
        mock_data: {
          type: 'boolean',
          description: 'If true, use mock production data for testing without a real observability platform.',
        },
      },
      required: ['project_key'],
    },
  },
]

// ─── Mock data for testing without a real observability platform ──

function getMockSnapshot(lookbackDays: number): ObservabilitySnapshot {
  return {
    capturedAt: new Date().toISOString(),
    lookbackDays,
    source: 'mock',
    endpoints: [
      { method: 'POST', path: '/api/payments/retry', callsPerDay: 2847, errorRate: 0.12, p95LatencyMs: 340, uniqueUsers: 1203 },
      { method: 'GET', path: '/api/user/saved-cards', callsPerDay: 1203, errorRate: 0.02, p95LatencyMs: 89, uniqueUsers: 891 },
      { method: 'POST', path: '/api/checkout/complete', callsPerDay: 891, errorRate: 0.008, p95LatencyMs: 1200, uniqueUsers: 891 },
      { method: 'POST', path: '/api/auth/login', callsPerDay: 4201, errorRate: 0.003, p95LatencyMs: 210, uniqueUsers: 3100 },
      { method: 'GET', path: '/api/user/profile', callsPerDay: 3400, errorRate: 0.001, p95LatencyMs: 45, uniqueUsers: 2800 },
      { method: 'POST', path: '/api/payments/initiate', callsPerDay: 1100, errorRate: 0.015, p95LatencyMs: 890, uniqueUsers: 1100 },
      { method: 'GET', path: '/api/transactions/history', callsPerDay: 780, errorRate: 0.004, p95LatencyMs: 230, uniqueUsers: 650 },
      { method: 'POST', path: '/api/user/register', callsPerDay: 120, errorRate: 0.02, p95LatencyMs: 340, uniqueUsers: 120 },
      { method: 'GET', path: '/api/notifications', callsPerDay: 2100, errorRate: 0.001, p95LatencyMs: 67, uniqueUsers: 1800 },
      { method: 'POST', path: '/api/cards/add', callsPerDay: 340, errorRate: 0.03, p95LatencyMs: 560, uniqueUsers: 340 },
    ],
    journeys: [
      { name: 'Guest checkout', completionsPerDay: 450, completionRate: 0.72, dropOffStep: 'Payment confirmation', errorRate: 0.028 },
      { name: 'Saved card checkout', completionsPerDay: 891, completionRate: 0.91, dropOffStep: 'Card selection', errorRate: 0.009 },
      { name: 'User registration', completionsPerDay: 120, completionRate: 0.68, dropOffStep: 'KYC verification', errorRate: 0.02 },
    ],
  }
}

export const productionCoverageIntelligenceAgent: DeliveryAgent = {
  tools,

  async handle(toolName: string, args: Record<string, any>) {
    if (toolName !== 'get_coverage_gaps') {
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }] }
    }

    const projectKey = String(args.project_key ?? '').toUpperCase().trim()
    const lookbackDays = Number(args.lookback_days ?? 30)
    const useMock = args.mock_data === true
    const existingTests: TestedEndpoint[] = args.existing_tests ?? []

    if (!projectKey) {
      return { content: [{ type: 'text', text: 'Please provide a project key.' }] }
    }

    try {
      const teamConfig = loadTeamConfig(projectKey)

      let snapshot: ObservabilitySnapshot

      if (useMock) {
        snapshot = getMockSnapshot(lookbackDays)
      } else {
        if (!teamConfig?.observability) {
          return {
            content: [{
              type: 'text',
              text: [
                `No observability platform configured for ${projectKey}.`,
                ``,
                `To enable production coverage intelligence, add this to config/teams/${projectKey.toLowerCase()}.yaml:`,
                ``,
                `observability:`,
                `  platform: datadog          # or newrelic, mixpanel, generic-http`,
                `  service: your-service-name`,
                `  env: production`,
                ``,
                `Or run with mock_data: true to see a demo with sample data.`,
              ].join('\n'),
            }],
          }
        }

        const adapter = createObservabilityAdapter(teamConfig)
        if (!adapter) {
          return {
            content: [{
              type: 'text',
              text: `Could not create observability adapter for platform: ${teamConfig.observability?.platform}`,
            }],
          }
        }

        snapshot = await adapter.getSnapshot(lookbackDays)
      }

      const report = analyseGaps(projectKey, snapshot, existingTests)
      const formatted = formatCoverageReport(report)

      return { content: [{ type: 'text', text: formatted }] }

    } catch (err: any) {
      return {
        content: [{
          type: 'text',
          text: `Coverage analysis failed for ${projectKey}: ${err.message}`,
        }],
      }
    }
  },
}
