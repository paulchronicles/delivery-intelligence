import { BaseAgent } from '../../../core/agents/base.agent'
import { NormalisedTicket, AgentResult, TeamConfig } from '../../../core/types/index'
import { getTeamConfig } from '../../../core/config/config-loader'

// ─────────────────────────────────────────────────────────────
// TESTABILITY AGENT
// Checks: can QA actually verify each acceptance criterion?
// ─────────────────────────────────────────────────────────────

export class TestabilityAgent extends BaseAgent {
  constructor() {
    super('testability')
  }
}

// ─────────────────────────────────────────────────────────────
// CLARITY AGENT
// Checks: is every statement unambiguous?
// ─────────────────────────────────────────────────────────────

export class ClarityAgent extends BaseAgent {
  constructor() {
    super('clarity')
  }
}

// ─────────────────────────────────────────────────────────────
// COMPLETENESS AGENT
// Checks: are all required sections present and meaningful?
// ─────────────────────────────────────────────────────────────

export class CompletenessAgent extends BaseAgent {
  constructor() {
    super('completeness')
  }

  // Override prompt to inject team-specific DoD rules
  protected buildUserPrompt(ticket: NormalisedTicket): string {
    const teamConfig = getTeamConfig(ticket.team)
    const dod = teamConfig.definitionOfDone

    return `
${super.buildUserPrompt(ticket)}

TEAM DEFINITION OF DONE REQUIREMENTS:
- Minimum acceptance criteria: ${dod.acceptanceCriteriaMinimum}
- Designs required: ${dod.designsRequired ? 'Yes' : 'No'}
- Non-functional requirements required: ${dod.nonFunctionalRequired ? 'Yes' : 'No'}

This ticket currently has ${ticket.acceptanceCriteria.length} acceptance criteria.
Designs linked: ${ticket.hasDesigns ? 'Yes' : 'No'}
    `.trim()
  }
}

// ─────────────────────────────────────────────────────────────
// COMPLIANCE AGENT
// Checks: are regulated data flows covered by appropriate ACs?
// Runs last — uses output context from other agents
// ─────────────────────────────────────────────────────────────

export class ComplianceAgent extends BaseAgent {
  constructor() {
    super('compliance')
  }

  // Override prompt to inject team-specific compliance triggers
  protected buildUserPrompt(ticket: NormalisedTicket): string {
    const teamConfig = getTeamConfig(ticket.team)
    const triggers = teamConfig.complianceTriggers

    const triggersText = triggers.length > 0
      ? triggers.map(t =>
          `- If "${t.keyword}" is present: "${t.requirement}" (severity: ${t.severity})`
        ).join('\n')
      : '- No team-specific triggers defined. Use general fintech compliance awareness.'

    return `
${super.buildUserPrompt(ticket)}

TEAM-SPECIFIC COMPLIANCE TRIGGERS:
${triggersText}
    `.trim()
  }
}
