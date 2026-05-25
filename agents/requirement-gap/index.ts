import { DeliveryAgent, AgentToolDefinition } from '../../core/mcp/registry'
import { JiraAdapter } from '../../core/adapters/jira.adapter'
import { ADOAdapter } from '../../core/adapters/ado.adapter'
import { runOrchestrator } from './orchestrator'
import { formatVerdictAsText } from '../../core/verdict-engine/formatter'
import { NormalisedTicket } from '../../core/types'

const jiraAdapter = new JiraAdapter()
const adoAdapter = new ADOAdapter()
const verdictCache = new Map()

function detectPlatform(ticketId: string): 'jira' | 'ado' {
  return /^\d+$/.test(ticketId) ? 'ado' : 'jira'
}

async function fetchTicket(ticketId: string): Promise<NormalisedTicket> {
  return detectPlatform(ticketId) === 'jira'
    ? jiraAdapter.fetchTicket(ticketId)
    : adoAdapter.fetchTicket(ticketId)
}

const tools: AgentToolDefinition[] = [
  {
    name: 'review_ticket',
    description:
      'Reviews a Jira or ADO ticket against QA quality standards. ' +
      'ALWAYS use this tool when the user mentions any ticket ID like SCRUM-6, PAY-447, QT-1 or similar. ' +
      'Trigger on ANY of these phrases: review, check, assess, validate, is this ready, ' +
      'look at this ticket, QA this, can you review, before I start, check before I start, ' +
      'is it ready, should I start, is SCRUM-X ready, check SCRUM-X, review SCRUM-X, ' +
      'thoroughly review, full review, run QA on. ' +
      'ALWAYS prefer this tool over get_ticket when the user wants to start work or asks if something is ready. ' +
      'Checks clarity, testability, completeness, and compliance. Returns a full verdict.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket_id: { type: 'string', description: 'The ticket ID to review. Examples: PAY-447, QT-1, SCRUM-7' },
      },
      required: ['ticket_id'],
    },
  },
  {
    name: 'post_verdict',
    description:
      'Posts a QA review verdict as a comment on a ticket and optionally notifies Slack. ' +
      'Use this after review_ticket when the user wants to share results with the team.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket_id: { type: 'string', description: 'The ticket ID to post the verdict to' },
        post_to_slack: { type: 'boolean', description: 'Whether to also send a Slack notification.' },
        update_status: { type: 'boolean', description: 'Whether to move the ticket status based on verdict.' },
      },
      required: ['ticket_id'],
    },
  },
  {
    name: 'review_sprint',
    description:
      'Reviews ALL tickets in a sprint or backlog before they are committed to development. ' +
      'Use this when someone asks to review the backlog, check if the next sprint is ready, ' +
      'audit tickets before sprint planning, or get a readiness report before committing work. ' +
      'Defaults to the next/future sprint — use this BEFORE sprint planning, not after.',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: { type: 'string', description: 'The project key. Examples: SCRUM, PAY, QT' },
        sprint_state: { type: 'string', description: 'Which sprint: active, future, or sprint name. Defaults to future.' },
      },
      required: ['project_key'],
    },
  },
  {
    name: 'post_sprint_verdicts',
    description:
      'Posts all QA review verdicts from a sprint review to their Jira tickets at once. ' +
      'Use this after review_sprint when the user wants to post all results.',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: { type: 'string', description: 'The project key' },
        only_blocked: { type: 'boolean', description: 'If true, only post blocked ticket verdicts.' },
      },
      required: ['project_key'],
    },
  },
  {
    name: 'suggest_ticket_rewrite',
    description:
      'Generates an improved rewrite of a ticket based on QA review concerns. ' +
      'Use this when someone asks to rewrite a ticket, improve the ACs, fix the requirements, ' +
      'or asks what the ticket should look like.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket_id: { type: 'string', description: 'The ticket ID to rewrite' },
      },
      required: ['ticket_id'],
    },
  },
  {
    name: 'get_team_config',
    description: 'Shows the QA rules and settings configured for a team or project.',
    inputSchema: {
      type: 'object',
      properties: {
        team_key: { type: 'string', description: 'The team or project key. Examples: PAY, QT, SCRUM' },
      },
      required: ['team_key'],
    },
  },
]

export const requirementGapAgent: DeliveryAgent = {
  tools,

  async handle(toolName: string, args: Record<string, any>) {
    switch (toolName) {

      case 'review_ticket': {
        const ticketId = String(args.ticket_id ?? '').toUpperCase().trim()
        if (!ticketId) return { content: [{ type: 'text', text: 'Please provide a ticket ID.' }] }
        try {
          const ticket = await fetchTicket(ticketId)
          const verdict = await runOrchestrator(ticket)
          verdictCache.set(ticketId, verdict)
          const verdictText = formatVerdictAsText(verdict)
          const followUp = verdict.readyForDev
            ? `\n\n---\nShall I post this result to ${ticketId} and mark it Ready for Dev?`
            : `\n\n---\nShall I post this feedback to ${ticketId} and move it back to In Refinement?`
          return { content: [{ type: 'text', text: verdictText + followUp }] }
        } catch (err: any) {
          return { content: [{ type: 'text', text: `Could not review ${ticketId}. Error: ${err.message}` }] }
        }
      }

      case 'post_verdict': {
        const ticketId = String(args.ticket_id ?? '').toUpperCase().trim()
        const verdict = verdictCache.get(ticketId)
        if (!verdict) return { content: [{ type: 'text', text: `No review found for ${ticketId}. Please run review_ticket first.` }] }
        try {
          const adapter = detectPlatform(ticketId) === 'jira' ? jiraAdapter : adoAdapter
          const results: string[] = []
          await adapter.postComment(ticketId, verdict)
          results.push(`✓ Comment posted to ${ticketId}`)
          if (args.update_status !== false) {
            await adapter.updateStatus(ticketId, verdict.readyForDev ? 'approve' : 'reject')
            results.push(verdict.readyForDev ? `✓ Ticket moved to "Ready for Dev"` : `✓ Ticket moved to "In Refinement"`)
          }
          verdictCache.delete(ticketId)
          return { content: [{ type: 'text', text: results.join('\n') }] }
        } catch (err: any) {
          return { content: [{ type: 'text', text: `Failed to post verdict. Error: ${err.message}` }] }
        }
      }

      case 'get_team_config': {
        const teamKey = String(args.team_key ?? '').toUpperCase().trim()
        try {
          const { getTeamConfig } = await import('../../core/config/config-loader')
          const config = getTeamConfig(teamKey)
          const output = [
            `**QA Rules for ${teamKey}**`,
            `QA Lead: ${config.qaLead}`,
            `Slack: ${config.slackChannel}`,
            `Triggers on: "${config.targetTransitionState}"`,
            `Min acceptance criteria: ${config.definitionOfDone.acceptanceCriteriaMinimum}`,
            ``,
            `**Compliance Triggers**`,
            ...config.complianceTriggers.map((t: any) => `• "${t.keyword}" → ${t.requirement} (${t.severity})`),
          ].join('\n')
          return { content: [{ type: 'text', text: output }] }
        } catch (err: any) {
          return { content: [{ type: 'text', text: `Could not load config for "${teamKey}".` }] }
        }
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }] }
    }
  }
}
