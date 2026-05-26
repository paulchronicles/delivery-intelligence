import { DeliveryAgent, AgentToolDefinition } from '../../core/mcp/registry'
import { JiraAdapter } from '../../core/adapters/jira.adapter'
import Anthropic from '@anthropic-ai/sdk'
import path from 'path'
import fs from 'fs'
import yaml from 'js-yaml'

const jiraAdapter = new JiraAdapter()
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function loadConfig() {
  const configPath = path.join(__dirname, '..', '..', 'agents', 'release-readiness', 'config', 'release-readiness.yaml')
  if (!fs.existsSync(configPath)) throw new Error('Release readiness config not found')
  return yaml.load(fs.readFileSync(configPath, 'utf8')) as any
}

function loadTeamConfig(projectKey: string): any {
  const teamsDir = path.join(__dirname, '..', '..', 'config', 'teams')
  if (!fs.existsSync(teamsDir)) return null
  for (const file of fs.readdirSync(teamsDir)) {
    try {
      const raw = fs.readFileSync(path.join(teamsDir, file), 'utf8')
      const config = yaml.load(raw) as any
      if (config?.project_key?.toUpperCase() === projectKey.toUpperCase()) return { ...config }
    } catch { continue }
  }
  return null
}

const tools: AgentToolDefinition[] = [
  {
    name: 'check_release_readiness',
    description:
      'Assesses whether a release is safe to ship by aggregating quality signals: ' +
      'ticket readiness, regression impact, coverage gaps, and open bugs. ' +
      'Use this when someone asks: is this ready to release, release readiness check, ' +
      'can we ship, is sprint X ready, release check for version Y, go/no-go decision, ' +
      'is it safe to deploy, what is blocking the release. ' +
      'Returns SHIP / SHIP WITH CAUTION / HOLD with specific reasons and resolution actions.',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: {
          type: 'string',
          description: 'The project key. Examples: SCRUM, PAY, QT',
        },
        sprint_name: {
          type: 'string',
          description: 'Sprint or release name. Examples: Sprint 3, v2.4.0, Release March',
        },
        ticket_reviews: {
          type: 'array',
          items: { type: 'object' },
          description: 'Optional: pre-run ticket review results to include in assessment.',
        },
        coverage_report: {
          type: 'object',
          description: 'Optional: pre-run coverage gap report to include.',
        },
        regression_summary: {
          type: 'string',
          description: 'Optional: regression impact summary from map_regression_impact.',
        },
        use_mock_coverage: {
          type: 'boolean',
          description: 'If true, use mock coverage data for testing.',
        },
      },
      required: ['project_key'],
    },
  },
]

export const releaseReadinessAgent: DeliveryAgent = {
  tools,

  async handle(toolName: string, args: Record<string, any>) {
    if (toolName !== 'check_release_readiness') {
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }] }
    }

    const projectKey = String(args.project_key ?? '').toUpperCase().trim()
    const sprintName = String(args.sprint_name ?? 'current sprint')
    const useMockCoverage = args.use_mock_coverage === true

    if (!projectKey) {
      return { content: [{ type: 'text', text: 'Please provide a project key.' }] }
    }

    try {
      const config = loadConfig()
      const teamConfig = loadTeamConfig(projectKey)

      // Step 1 -- Fetch tickets in the future sprint
      const sections: string[] = []

      let ticketSummary = 'No ticket data available'
      let blockedTickets: string[] = []
      let warnTickets: string[] = []
      let readyTickets: string[] = []

      try {
        // Find board for project
        const boardRes = await fetch(
          `${process.env.JIRA_BASE_URL}/rest/agile/1.0/board?projectKeyOrId=${projectKey}`,
          { headers: { Authorization: 'Basic ' + Buffer.from(`${process.env.JIRA_BOT_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64') } }
        )
        const boardData = await boardRes.json() as any
        const board = boardData.values?.[0]

        if (board) {
          // Get active or future sprint
          const sprintRes = await fetch(
            `${process.env.JIRA_BASE_URL}/rest/agile/1.0/board/${board.id}/sprint?state=future,active&maxResults=10`,
            { headers: { Authorization: 'Basic ' + Buffer.from(`${process.env.JIRA_BOT_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64') } }
          )
          const sprintData = await sprintRes.json() as any
          const sprints = sprintData.values ?? []

          // Find matching sprint or use first future
          const sprint = sprints.find((s: any) =>
            s.name.toLowerCase().includes(sprintName.toLowerCase())
          ) ?? sprints.find((s: any) => s.state === 'future') ?? sprints[0]

          if (sprint) {
            const issuesRes = await fetch(
              `${process.env.JIRA_BASE_URL}/rest/agile/1.0/sprint/${sprint.id}/issue?maxResults=50`,
              { headers: { Authorization: 'Basic ' + Buffer.from(`${process.env.JIRA_BOT_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64') } }
            )
            const issuesData = await issuesRes.json() as any
            const issues = issuesData.issues ?? []

            // Check each ticket against the verdict cache
            const ticketLines: string[] = []
            for (const issue of issues) {
              const cached: any = null // verdict cache not available cross-agent
              if (cached) {
                if (cached.overallVerdict === 'BLOCK') {
                  blockedTickets.push(issue.key)
                  ticketLines.push(`${issue.key}: NOT READY (${cached.blockers.length} blockers) -- ${issue.fields?.summary}`)
                } else if (cached.overallVerdict === 'WARN') {
                  warnTickets.push(issue.key)
                  ticketLines.push(`${issue.key}: NEEDS WORK (${cached.criticals?.length ?? 0} criticals) -- ${issue.fields?.summary}`)
                } else {
                  readyTickets.push(issue.key)
                  ticketLines.push(`${issue.key}: READY -- ${issue.fields?.summary}`)
                }
              } else {
                ticketLines.push(`${issue.key}: NOT REVIEWED -- ${issue.fields?.summary ?? '(no title)'}`)
                warnTickets.push(issue.key)
              }
            }

            ticketSummary = ticketLines.length > 0
              ? ticketLines.join('\n')
              : 'No tickets found in sprint'
          }
        }
      } catch (err: any) {
        ticketSummary = `Could not fetch tickets: ${err.message}`
      }

      // Step 2 -- Coverage summary
      const coverageSummary = useMockCoverage
        ? 'Mock coverage: POST /api/payments/retry -- 2847 calls/day, 12% error rate, ZERO tests. POST /api/checkout/complete -- 891 calls/day, partial coverage.'
        : args.coverage_report
          ? JSON.stringify(args.coverage_report)
          : 'No coverage report provided. Run get_coverage_gaps for detailed analysis.'

      // Step 3 -- Regression summary
      const regressionSummary = args.regression_summary
        ?? 'No regression impact map provided. Run map_regression_impact for detailed analysis.'

      // Step 4 -- Build prompt for LLM
      const userPrompt = `
Assess release readiness for ${projectKey} -- ${sprintName}.

TICKET STATUS:
${ticketSummary}

Summary:
- NOT READY (blocked): ${blockedTickets.length} tickets ${blockedTickets.length > 0 ? '(' + blockedTickets.join(', ') + ')' : ''}
- NEEDS WORK: ${warnTickets.length} tickets ${warnTickets.length > 0 ? '(' + warnTickets.join(', ') + ')' : ''}
- READY: ${readyTickets.length} tickets ${readyTickets.length > 0 ? '(' + readyTickets.join(', ') + ')' : ''}

COVERAGE GAPS:
${coverageSummary}

REGRESSION IMPACT:
${regressionSummary}

TEAM CONFIG:
Min acceptance criteria: ${teamConfig?.definitionOfDone?.acceptanceCriteriaMinimum ?? 2}
Compliance triggers active: ${teamConfig?.complianceTriggers?.length ?? 0}

Generate the release readiness report now.
      `.trim()

      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        temperature: 0.1,
        system: config.system_prompt,
        messages: [{ role: 'user', content: userPrompt }],
      })

      const report = (response.content[0] as any).text

      return { content: [{ type: 'text', text: report }] }

    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Release readiness check failed: ${err.message}` }],
      }
    }
  },
}
