import { DeliveryAgent, AgentToolDefinition } from '../../core/mcp/registry'
import { JiraAdapter } from '../../core/adapters/jira.adapter'
import { ADOAdapter } from '../../core/adapters/ado.adapter'
import { NormalisedTicket } from '../../core/types'
import Anthropic from '@anthropic-ai/sdk'
import path from 'path'
import fs from 'fs'
import yaml from 'js-yaml'

const jiraAdapter = new JiraAdapter()
const adoAdapter = new ADOAdapter()
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function detectPlatform(ticketId: string): 'jira' | 'ado' {
  return /^\d+$/.test(ticketId) ? 'ado' : 'jira'
}

async function fetchTicket(ticketId: string): Promise<NormalisedTicket> {
  return detectPlatform(ticketId) === 'jira'
    ? jiraAdapter.fetchTicket(ticketId)
    : adoAdapter.fetchTicket(ticketId)
}

function loadConfig() {
  const configPath = path.join(
    __dirname, '..', '..', 'agents', 'regression-impact-map', 'config', 'regression-impact-map.yaml'
  )
  if (!fs.existsSync(configPath)) throw new Error('Regression impact map config not found')
  return yaml.load(fs.readFileSync(configPath, 'utf8')) as any
}

function loadTeamJourneys(projectKey: string): any[] {
  const teamsDir = path.join(__dirname, '..', '..', 'config', 'teams')
  const files = fs.existsSync(teamsDir) ? fs.readdirSync(teamsDir) : []

  for (const file of files) {
    const config = yaml.load(fs.readFileSync(path.join(teamsDir, file), 'utf8')) as any
    if (config?.project_key?.toUpperCase() === projectKey.toUpperCase()) {
      return config.journeys ?? []
    }
  }
  return []
}

function matchJourneys(ticket: NormalisedTicket, journeys: any[]): any[] {
  const content = [
    ticket.title,
    ticket.description,
    ...ticket.acceptanceCriteria,
    ...ticket.labels,
  ].join(' ').toLowerCase()

  return journeys.filter(journey => {
    const matches = journey.keywords.filter((kw: string) =>
      content.includes(kw.toLowerCase())
    )
    return matches.length >= 2
  })
}

const tools: AgentToolDefinition[] = [
  {
    name: 'map_regression_impact',
    description:
      'Maps the regression impact of a ticket or change — identifies which business journeys ' +
      'are affected, what tests should be run, what coverage is missing, and what risk level the change carries. ' +
      'Use this when someone asks: map regression impact, what could this break, ' +
      'what should we regression test, what is the blast radius, ' +
      'is this safe to release, what journeys are affected by this change. ' +
      'Works from a ticket ID — fetches the ticket and analyses the impact.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket_id: {
          type: 'string',
          description: 'The ticket ID to map regression impact for. Examples: SCRUM-7, PAY-447',
        },
        changed_files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of changed file paths from a PR or diff',
        },
        pr_summary: {
          type: 'string',
          description: 'Optional PR title or summary for additional context',
        },
      },
      required: ['ticket_id'],
    },
  },
]

export const regressionImpactMapAgent: DeliveryAgent = {
  tools,

  async handle(toolName: string, args: Record<string, any>) {
    if (toolName !== 'map_regression_impact') {
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }] }
    }

    const ticketId = String(args.ticket_id ?? '').toUpperCase().trim()
    const changedFiles: string[] = args.changed_files ?? []
    const prSummary: string = args.pr_summary ?? ''

    if (!ticketId) {
      return { content: [{ type: 'text', text: 'Please provide a ticket ID.' }] }
    }

    try {
      const ticket = await fetchTicket(ticketId)
      const config = loadConfig()

      // Extract project key from ticket ID
      const projectKey = ticketId.split('-')[0]
      const journeys = loadTeamJourneys(projectKey)
      const matchedJourneys = matchJourneys(ticket, journeys)

      // Build prompt
      const userPrompt = `
Analyse the regression impact of this change.

TICKET: ${ticketId}
Title: ${ticket.title}

Description:
${ticket.description || '(none)'}

Acceptance Criteria:
${ticket.acceptanceCriteria.map((ac, i) => `${i + 1}. ${ac}`).join('\n') || '(none)'}

Labels: ${ticket.labels.join(', ') || 'none'}
Type: ${ticket.type}

${changedFiles.length > 0 ? `Changed files:\n${changedFiles.map(f => `- ${f}`).join('\n')}` : ''}
${prSummary ? `PR summary: ${prSummary}` : ''}

KNOWN BUSINESS JOURNEYS FOR THIS TEAM:
${journeys.length > 0
  ? journeys.map(j => `- ${j.name} [${j.risk}] — keywords: ${j.keywords.join(', ')}\n  ${j.description}`).join('\n')
  : '(no journeys configured for this team)'}

PRE-MATCHED JOURNEYS (2+ keyword matches found):
${matchedJourneys.length > 0
  ? matchedJourneys.map(j => `- ${j.name} [${j.risk}]`).join('\n')
  : '(no direct keyword matches — use your judgement based on ticket content)'}

Generate the regression impact map now.
      `.trim()

      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        temperature: 0.1,
        system: config.system_prompt,
        messages: [{ role: 'user', content: userPrompt }],
      })

      const impactMap = (response.content[0] as any).text

      return { content: [{ type: 'text', text: impactMap }] }

    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Could not map regression impact for ${ticketId}. Error: ${err.message}` }]
      }
    }
  }
}
