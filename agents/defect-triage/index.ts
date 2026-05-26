import { DeliveryAgent, AgentToolDefinition } from '../../core/mcp/registry'
import { JiraAdapter } from '../../core/adapters/jira.adapter'
import Anthropic from '@anthropic-ai/sdk'
import path from 'path'
import fs from 'fs'
import yaml from 'js-yaml'

const jiraAdapter = new JiraAdapter()
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function loadConfig() {
  const configPath = path.join(__dirname, '..', '..', 'agents', 'defect-triage', 'config', 'defect-triage.yaml')
  if (!fs.existsSync(configPath)) throw new Error('Defect triage config not found')
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

function matchComponent(description: string, components: any[]): any | null {
  if (!components?.length) return null
  const content = description.toLowerCase()
  let bestMatch: any = null
  let bestScore = 0

  for (const component of components) {
    const matches = (component.keywords ?? []).filter((kw: string) =>
      content.includes(kw.toLowerCase())
    )
    if (matches.length >= 2 && matches.length > bestScore) {
      bestScore = matches.length
      bestMatch = component
    }
  }
  return bestMatch
}

function formatComponents(components: any[]): string {
  if (!components?.length) return 'No components configured -- agent will infer from description'
  return components.map((c: any) =>
    `${c.name} [${c.risk ?? 'medium'}] -- owner: ${c.owner ?? 'unassigned'} -- keywords: ${(c.keywords ?? []).join(', ')}`
  ).join('\n')
}

function formatSeverityRules(rules: any): string {
  if (!rules) return 'Using default severity rules'
  return Object.entries(rules).map(([level, conditions]) =>
    `${level.toUpperCase()}: ${(conditions as string[]).join('; ')}`
  ).join('\n')
}

const tools: AgentToolDefinition[] = [
  {
    name: 'triage_defect',
    description:
      'Triages a software defect -- classifies severity, identifies root cause area, ' +
      'suggests owner, finds similar past defects, and recommends immediate actions. ' +
      'Use this when someone reports a bug, describes a defect, pastes error details, ' +
      'or asks to triage an issue. Works from a ticket ID or a plain description. ' +
      'Returns severity, component, root cause area, impacted journey, and next steps.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket_id: {
          type: 'string',
          description: 'Optional Jira/ADO ticket ID to fetch and triage. Examples: SCRUM-8, PAY-123',
        },
        title: {
          type: 'string',
          description: 'Defect title if not using a ticket ID',
        },
        description: {
          type: 'string',
          description: 'Defect description, steps to reproduce, expected vs actual behaviour',
        },
        project_key: {
          type: 'string',
          description: 'Project key for team config lookup. Examples: SCRUM, PAY, QT',
        },
      },
      required: [],
    },
  },
]

export const defectTriageAgent: DeliveryAgent = {
  tools,

  async handle(toolName: string, args: Record<string, any>) {
    if (toolName !== 'triage_defect') {
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }] }
    }

    const ticketId = String(args.ticket_id ?? '').toUpperCase().trim()
    const projectKey = ticketId
      ? ticketId.split('-')[0]
      : String(args.project_key ?? '').toUpperCase().trim()

    try {
      const agentConfig = loadConfig()
      const teamConfig = loadTeamConfig(projectKey)
      const components = teamConfig?.components ?? []
      const severityRules = teamConfig?.severity_rules ?? null

      // Fetch ticket if ID provided
      let defectTitle = args.title ?? ''
      let defectDescription = args.description ?? ''

      if (ticketId) {
        try {
          const ticket = await jiraAdapter.fetchTicket(ticketId)
          defectTitle = ticket.title
          defectDescription = [
            ticket.description,
            ticket.acceptanceCriteria.length > 0
              ? 'Acceptance criteria:\n' + ticket.acceptanceCriteria.join('\n')
              : '',
          ].filter(Boolean).join('\n\n')
        } catch (err: any) {
          return {
            content: [{ type: 'text', text: `Could not fetch ticket ${ticketId}: ${err.message}` }],
          }
        }
      }

      if (!defectTitle && !defectDescription) {
        return {
          content: [{
            type: 'text',
            text: 'Please provide either a ticket ID or a defect description.\n' +
              'Examples:\n' +
              '  triage SCRUM-8\n' +
              '  triage this bug: users are getting charged twice on payment retry\n' +
              '  triage defect: login fails with correct credentials on mobile',
          }],
        }
      }

      // Match component from team config
      const fullText = `${defectTitle} ${defectDescription}`
      const matchedComponent = matchComponent(fullText, components)

      // Build prompt
      const userPrompt = `
Triage this defect.

${ticketId ? `TICKET: ${ticketId}` : ''}
TITLE: ${defectTitle || '(no title provided)'}

DESCRIPTION:
${defectDescription || '(no description provided)'}

TEAM COMPONENTS:
${formatComponents(components)}

${matchedComponent ? `PRE-MATCHED COMPONENT (2+ keyword matches): ${matchedComponent.name} -- owner: ${matchedComponent.owner ?? 'unassigned'}` : 'No component pre-matched -- infer from description'}

SEVERITY RULES:
${formatSeverityRules(severityRules)}

TEAM JOURNEYS:
${(teamConfig?.journeys ?? []).map((j: any) => `${j.name} [${j.risk}]: ${j.description ?? ''}`).join('\n') || 'No journeys configured'}

Generate the defect triage report now.
      `.trim()

      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        temperature: 0.1,
        system: agentConfig.system_prompt,
        messages: [{ role: 'user', content: userPrompt }],
      })

      const triage = (response.content[0] as any).text

      return { content: [{ type: 'text', text: triage }] }

    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Defect triage failed: ${err.message}` }],
      }
    }
  },
}
