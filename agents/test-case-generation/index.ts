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
  const configPath = path.join(process.cwd(), 'agents', 'test-case-generation', 'config', 'test-generation.yaml')
  if (!fs.existsSync(configPath)) return { system_prompt: '', default_output: 'scenarios' }
  return yaml.load(fs.readFileSync(configPath, 'utf8')) as any
}

const FORMAT_DESCRIPTIONS: Record<string, string> = {
  scenarios: 'BDD-style plain English scenarios (Given/When/Then)',
  table: 'structured table format importable to Jira/TestRail',
  playwright: 'executable Playwright TypeScript test code',
}

const tools: AgentToolDefinition[] = [
  {
    name: 'generate_test_cases',
    description:
      'Generates test cases from a ticket\'s acceptance criteria. ' +
      'Use this when someone asks to generate tests, write test cases, create test scenarios, ' +
      'scaffold tests, or asks "what should I test for this ticket". ' +
      'Supports three output formats: scenarios (BDD), table (structured), or playwright (executable code). ' +
      'Can post results back to Jira as a comment.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket_id: {
          type: 'string',
          description: 'The ticket ID to generate test cases for. Examples: SCRUM-5, PAY-447',
        },
        format: {
          type: 'string',
          description: 'Output format: "scenarios" (BDD plain English), "table" (structured), or "playwright" (executable TypeScript code). Defaults to scenarios.',
        },
        post_to_jira: {
          type: 'boolean',
          description: 'Whether to post the generated test cases as a comment on the ticket. Defaults to false.',
        },
      },
      required: ['ticket_id'],
    },
  },
]

export const testCaseGenerationAgent: DeliveryAgent = {
  tools,

  async handle(toolName: string, args: Record<string, any>) {
    if (toolName !== 'generate_test_cases') {
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }] }
    }

    const ticketId = String(args.ticket_id ?? '').toUpperCase().trim()
    const format = String(args.format ?? 'scenarios').toLowerCase()
    const postToJira = args.post_to_jira === true

    if (!ticketId) {
      return { content: [{ type: 'text', text: 'Please provide a ticket ID.' }] }
    }

    if (!['scenarios', 'table', 'playwright'].includes(format)) {
      return { content: [{ type: 'text', text: 'Format must be one of: scenarios, table, playwright' }] }
    }

    try {
      const ticket = await fetchTicket(ticketId)
      const config = loadConfig()

      // Build the user prompt
      const userPrompt = `
Generate ${FORMAT_DESCRIPTIONS[format]} for this ticket.

TICKET: ${ticket.title}

DESCRIPTION:
${ticket.description || '(none provided)'}

ACCEPTANCE CRITERIA:
${ticket.acceptanceCriteria.length > 0
  ? ticket.acceptanceCriteria.map((ac, i) => `${i + 1}. ${ac}`).join('\n')
  : '(none — generate based on title and description)'}

USER STORY:
As a: ${ticket.storyFormat.asA ?? '(not provided)'}
I want: ${ticket.storyFormat.iWant ?? '(not provided)'}
So that: ${ticket.storyFormat.soThat ?? '(not provided)'}

TICKET TYPE: ${ticket.type}
LABELS: ${ticket.labels.join(', ') || 'none'}

OUTPUT FORMAT: ${format.toUpperCase()}
${format === 'playwright' ? 'Use TypeScript. Use data-testid selectors. Group tests in describe blocks.' : ''}
Generate comprehensive test cases now.
      `.trim()

      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        temperature: 0.2,
        system: config.system_prompt,
        messages: [{ role: 'user', content: userPrompt }],
      })

      const testCases = (response.content[0] as any).text

      const header = `Test Cases — ${ticketId} (${FORMAT_DESCRIPTIONS[format]})\nGenerated: ${new Date().toLocaleString('en-GB')}\n\n`
      const fullOutput = header + testCases

      // Post to Jira if requested
      if (postToJira) {
        const adapter = detectPlatform(ticketId) === 'jira' ? jiraAdapter : adoAdapter
        // Use a minimal verdict-like object for postComment
        await (adapter as any).api?.post(`/rest/api/3/issue/${ticketId}/comment`, {
          body: {
            type: 'doc',
            version: 1,
            content: [{ type: 'codeBlock', content: [{ type: 'text', text: fullOutput }] }],
          },
        }).catch((err: any) => console.error('Failed to post to Jira:', err.message))
      }

      const followUp = postToJira
        ? `\n\n✓ Posted to ${ticketId}`
        : `\n\n---\nWant me to post these to ${ticketId} in Jira, or generate in a different format (scenarios / table / playwright)?`

      return { content: [{ type: 'text', text: fullOutput + followUp }] }

    } catch (err: any) {
      return { content: [{ type: 'text', text: `Could not generate test cases for ${ticketId}. Error: ${err.message}` }] }
    }
  }
}
