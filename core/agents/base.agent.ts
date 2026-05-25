import Anthropic from '@anthropic-ai/sdk'
import { globalConfig } from '../config/global.config'
import { getAgentConfig } from '../config/config-loader'
import {
  NormalisedTicket,
  AgentResult,
  AgentConcern,
  AgentVerdict,
  Severity,
} from '../types/index'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export abstract class BaseAgent {
  protected agentName: string

  constructor(agentName: string) {
    this.agentName = agentName
  }

  // ─── Main entry point ────────────────────────────────────

  public async analyse(ticket: NormalisedTicket): Promise<AgentResult> {
    const startTime = Date.now()
    const config = getAgentConfig(this.agentName)

    if (!config.enabled) {
      return this.buildSkippedResult(ticket.id)
    }

    try {
      const userPrompt = this.buildUserPrompt(ticket)
      const raw = await this.callLLM(config.systemPrompt, userPrompt)
      const parsed = this.parseResponse(raw)
      const concerns = this.processConcerns(parsed.concerns ?? [], ticket)
      const verdict = this.deriveVerdict(concerns)

      return {
        agent: this.agentName,
        ticketId: ticket.id,
        analysedAt: new Date().toISOString(),
        verdict,
        concerns,
        summary: parsed.summary ?? 'Analysis complete.',
        score: parsed.score ?? this.calculateScore(concerns),
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      console.error(`[${this.agentName}] Analysis failed for ${ticket.id}:`, err)
      return this.buildErrorResult(ticket.id, Date.now() - startTime)
    }
  }

  // ─── LLM Call ────────────────────────────────────────────

  private async callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await client.messages.create({
      model: globalConfig.anthropic.model,
      max_tokens: globalConfig.anthropic.maxTokens,
      temperature: globalConfig.anthropic.temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const block = response.content[0]
    if (block.type !== 'text') throw new Error('Unexpected response type from LLM')
    return block.text
  }

  // ─── User prompt — subclasses can override ───────────────

  protected buildUserPrompt(ticket: NormalisedTicket): string {
    return `
Analyse this ticket:

TITLE: ${ticket.title}

DESCRIPTION:
${ticket.description || '(none provided)'}

ACCEPTANCE CRITERIA:
${ticket.acceptanceCriteria.length > 0
  ? ticket.acceptanceCriteria.map((ac, i) => `${i + 1}. ${ac}`).join('\n')
  : '(none provided)'}

USER STORY:
As a: ${ticket.storyFormat.asA ?? '(not provided)'}
I want: ${ticket.storyFormat.iWant ?? '(not provided)'}
So that: ${ticket.storyFormat.soThat ?? '(not provided)'}

TICKET TYPE: ${ticket.type}
PRIORITY: ${ticket.priority}
LABELS: ${ticket.labels.join(', ') || 'none'}
LINKED TICKETS: ${ticket.linkedTickets.join(', ') || 'none'}
HAS DESIGNS: ${ticket.hasDesigns ? 'Yes' : 'No'}
    `.trim()
  }

  // ─── Response parsing ────────────────────────────────────

  private parseResponse(raw: string): any {
    // Strip markdown fences if model adds them despite instructions
    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    return JSON.parse(clean)
  }

  // ─── Concern post-processing ─────────────────────────────

  private processConcerns(
    raw: Partial<AgentConcern>[],
    ticket: NormalisedTicket
  ): AgentConcern[] {
    return raw.map((c, i) => ({
      id: c.id ?? `${this.agentName.toUpperCase()}-${String(i + 1).padStart(3, '0')}`,
      severity: c.severity ?? 'MAJOR',
      agent: this.agentName,
      location: c.location ?? 'General',
      finding: c.finding ?? 'Issue detected',
      whyItMatters: c.whyItMatters ?? '',
      suggestion: c.suggestion ?? '',
      example: c.example,
      confidence: c.confidence ?? 0.8,
    })).filter(c => {
      // Downgrade low-confidence concerns rather than blocking
      if (c.confidence < globalConfig.verdictRules.confidenceFloor) {
        c.severity = this.downgradeSeverity(c.severity)
      }
      return true
    })
  }

  // ─── Verdict derivation ──────────────────────────────────

  private deriveVerdict(concerns: AgentConcern[]): AgentVerdict {
    const severities = concerns.map(c => c.severity)

    if (severities.some(s => globalConfig.verdictRules.hardBlockOn.includes(s))) {
      return 'BLOCK'
    }
    if (severities.some(s => globalConfig.verdictRules.softBlockOn.includes(s))) {
      return 'WARN'
    }
    if (concerns.length === 0) return 'PASS'
    return 'WARN'
  }

  // ─── Score calculation fallback ──────────────────────────

  private calculateScore(concerns: AgentConcern[]): number {
    const deductions: Record<Severity, number> = {
      BLOCKER: 40,
      CRITICAL: 20,
      MAJOR: 10,
      MINOR: 3,
    }
    const total = concerns.reduce((acc, c) => acc + (deductions[c.severity] ?? 0), 0)
    return Math.max(0, 100 - total)
  }

  // ─── Severity helpers ────────────────────────────────────

  private downgradeSeverity(severity: Severity): Severity {
    const order: Severity[] = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR']
    const idx = order.indexOf(severity)
    return idx < order.length - 1 ? order[idx + 1] : severity
  }

  // ─── Fallback results ────────────────────────────────────

  private buildSkippedResult(ticketId: string): AgentResult {
    return {
      agent: this.agentName,
      ticketId,
      analysedAt: new Date().toISOString(),
      verdict: 'PASS',
      concerns: [],
      summary: 'Agent disabled — skipped.',
      score: 100,
      durationMs: 0,
    }
  }

  private buildErrorResult(ticketId: string, durationMs: number): AgentResult {
    return {
      agent: this.agentName,
      ticketId,
      analysedAt: new Date().toISOString(),
      verdict: 'WARN',
      concerns: [{
        id: `${this.agentName.toUpperCase()}-ERR`,
        severity: 'MAJOR',
        agent: this.agentName,
        location: 'System',
        finding: `${this.agentName} agent encountered an error during analysis`,
        whyItMatters: 'This dimension could not be reviewed — human review recommended',
        suggestion: 'Check agent logs and retry',
        confidence: 1.0,
      }],
      summary: 'Agent error — could not complete analysis.',
      score: 50,
      durationMs,
    }
  }
}
