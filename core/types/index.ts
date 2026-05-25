// ─────────────────────────────────────────────────────────────
// PLATFORM TYPES
// ─────────────────────────────────────────────────────────────

export type Platform = 'jira' | 'ado' | 'github' | 'linear'

export type TicketType = 'story' | 'bug' | 'task' | 'epic'

export type Priority = 'critical' | 'high' | 'medium' | 'low'

// ─────────────────────────────────────────────────────────────
// NORMALISED TICKET — universal shape, platform-agnostic
// Every adapter translates its raw payload into this
// ─────────────────────────────────────────────────────────────

export interface NormalisedTicket {
  // Identity
  id: string
  platform: Platform
  url: string

  // Content — what agents actually analyse
  title: string
  description: string
  acceptanceCriteria: string[]
  storyFormat: {
    asA: string | null
    iWant: string | null
    soThat: string | null
  }

  // Metadata
  type: TicketType
  priority: Priority
  labels: string[]
  linkedTickets: string[]
  hasDesigns: boolean
  assignee: string | null
  team: string

  // Transition context
  fromState: string
  toState: string
  triggeredBy: string
  triggeredAt: string
}

// ─────────────────────────────────────────────────────────────
// AGENT OUTPUT SCHEMA — the contract every sub-agent returns
// ─────────────────────────────────────────────────────────────

export type Severity = 'BLOCKER' | 'CRITICAL' | 'MAJOR' | 'MINOR'

export type AgentVerdict = 'PASS' | 'WARN' | 'BLOCK'

export interface AgentConcern {
  id: string            // e.g. "CLARITY-001" — traceable, referenceable
  severity: Severity
  agent: string
  location: string      // "AC #3" | "Title" | "Description"
  finding: string       // what is wrong — plain English, one sentence
  whyItMatters: string  // consequence if not fixed
  suggestion: string    // concrete fix — actionable
  example?: string      // optional: show the rewritten version
  confidence: number    // 0.0–1.0
}

export interface AgentResult {
  agent: string
  ticketId: string
  analysedAt: string
  verdict: AgentVerdict
  concerns: AgentConcern[]
  summary: string
  score: number         // 0–100 quality score for this dimension
  durationMs: number
}

// ─────────────────────────────────────────────────────────────
// FINAL VERDICT — rolled up output from all agents
// ─────────────────────────────────────────────────────────────

export interface FinalVerdict {
  ticketId: string
  platform: Platform
  overallVerdict: AgentVerdict
  overallScore: number
  agentResults: AgentResult[]
  blockers: AgentConcern[]      // surfaced separately for fast scanning
  criticals: AgentConcern[]
  readyForDev: boolean
  requiresHumanReview: boolean
  reviewedBy: string
  reviewedAt: string
  totalDurationMs: number
}

// ─────────────────────────────────────────────────────────────
// ADAPTER INTERFACE — every platform adapter implements this
// ─────────────────────────────────────────────────────────────

export interface PlatformAdapter {
  platform: Platform
  parseWebhook(payload: unknown): NormalisedTicket | null
  verifySignature(headers: Record<string, string>, rawBody: string): boolean
  fetchTicket(id: string): Promise<NormalisedTicket>
  postComment(ticketId: string, verdict: FinalVerdict): Promise<void>
  updateStatus(ticketId: string, action: 'approve' | 'reject'): Promise<void>
}

// ─────────────────────────────────────────────────────────────
// CONFIG TYPES
// ─────────────────────────────────────────────────────────────

export interface ComplianceTrigger {
  keyword: string
  requirement: string
  severity: Severity
}

export interface TeamConfig {
  team: string
  projectKey: string
  qaLead: string
  slackChannel: string
  targetTransitionState: string
  definitionOfDone: {
    acceptanceCriteriaMinimum: number
    designsRequired: boolean
    nonFunctionalRequired: boolean
  }
  complianceTriggers: ComplianceTrigger[]
  severityOverrides: Record<string, Severity>
}

export interface AgentConfig {
  agent: string
  version: string
  enabled: boolean
  systemPrompt: string
  vagueTerms?: string[]
  scoringWeights?: Record<string, number>
  concernTemplates?: Record<string, Partial<AgentConcern>>
}

export interface GlobalConfig {
  anthropic: {
    model: string
    maxTokens: number
    temperature: number
  }
  verdictRules: {
    hardBlockOn: Severity[]
    softBlockOn: Severity[]
    autoPassThreshold: number
    confidenceFloor: number
  }
  webhook: {
    timeoutBehaviour: 'block' | 'allow'
    timeoutSeconds: number
  }
}

// ─── Readiness Levels ─────────────────────────────────────────

export type ReadinessLevel = 'NOT_READY' | 'NEEDS_WORK' | 'NEARLY_READY' | 'READY'

export const READINESS_LABEL: Record<ReadinessLevel, string> = {
  NOT_READY:    '🔴 NOT READY — has blockers, cannot be built safely',
  NEEDS_WORK:   '🟠 NEEDS WORK — has criticals, will cause mid-sprint problems',
  NEARLY_READY: '🟡 NEARLY READY — minor gaps, can proceed with caution',
  READY:        '✅ READY — meets quality bar, clear to develop',
}

export function getReadinessLevel(blockers: number, criticals: number, majors: number): ReadinessLevel {
  if (blockers > 0) return 'NOT_READY'
  if (criticals > 0) return 'NEEDS_WORK'
  if (majors > 0) return 'NEARLY_READY'
  return 'READY'
}
