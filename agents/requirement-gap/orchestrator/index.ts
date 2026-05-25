import {
  NormalisedTicket,
  AgentResult,
  FinalVerdict,
  AgentConcern,
  Severity,
  AgentVerdict,
} from '../../../core/types/index'
import { globalConfig } from '../../../core/config/global.config'
import {
  TestabilityAgent,
  ClarityAgent,
  CompletenessAgent,
  ComplianceAgent,
} from '../sub-agents/index'

// ─── Agent instances (singletons) ───────────────────────────

const agents = {
  clarity: new ClarityAgent(),
  testability: new TestabilityAgent(),
  completeness: new CompletenessAgent(),
  compliance: new ComplianceAgent(),
}

// ─── Scoring weights per agent ───────────────────────────────

const AGENT_WEIGHTS: Record<string, number> = {
  testability: 35,
  clarity: 25,
  completeness: 25,
  compliance: 15,
}

// ─── Main orchestrator function ──────────────────────────────

export async function runOrchestrator(ticket: NormalisedTicket): Promise<FinalVerdict> {
  const startTime = Date.now()

  console.log(`[Orchestrator] Starting analysis for ${ticket.id} (${ticket.platform})`)

  // Run parallel agents with timeout protection
  const [clarityResult, testabilityResult, completenessResult] = await Promise.all([
    withTimeout(agents.clarity.analyse(ticket), globalConfig.webhook.timeoutSeconds * 1000 - 2000),
    withTimeout(agents.testability.analyse(ticket), globalConfig.webhook.timeoutSeconds * 1000 - 2000),
    withTimeout(agents.completeness.analyse(ticket), globalConfig.webhook.timeoutSeconds * 1000 - 2000),
  ])

  // Compliance runs after parallel agents — it benefits from knowing
  // what other agents found (logged context) and is higher risk to get wrong
  const complianceResult = await withTimeout(
    agents.compliance.analyse(ticket),
    globalConfig.webhook.timeoutSeconds * 1000 - 1000
  )

  const agentResults: AgentResult[] = [
    clarityResult,
    testabilityResult,
    completenessResult,
    complianceResult,
  ]

  // Roll up into final verdict
  const verdict = buildFinalVerdict(ticket, agentResults, Date.now() - startTime)

  console.log(
    `[Orchestrator] ${ticket.id} → ${verdict.overallVerdict} ` +
    `(score: ${verdict.overallScore}/100, ${verdict.totalDurationMs}ms)`
  )

  return verdict
}

// ─── Final verdict builder ────────────────────────────────────

function buildFinalVerdict(
  ticket: NormalisedTicket,
  agentResults: AgentResult[],
  totalDurationMs: number
): FinalVerdict {

  // Flatten all concerns
  const allConcerns = agentResults.flatMap(r => r.concerns)

  // Surface high-priority concerns separately
  const blockers = allConcerns.filter(c => c.severity === 'BLOCKER')
  const criticals = allConcerns.filter(c => c.severity === 'CRITICAL')

  // Derive overall verdict
  const overallVerdict = deriveOverallVerdict(agentResults)

  // Weighted score across agents
  const overallScore = calculateWeightedScore(agentResults)

  // Requires human review if any agent is uncertain
  const requiresHumanReview =
    overallVerdict === 'WARN' ||
    allConcerns.some(c => c.confidence < globalConfig.verdictRules.confidenceFloor)

  return {
    ticketId: ticket.id,
    platform: ticket.platform,
    overallVerdict,
    overallScore: Math.round(overallScore),
    agentResults,
    blockers,
    criticals,
    readyForDev: overallVerdict === 'PASS',
    requiresHumanReview,
    reviewedBy: 'QA Gate Agent v1.0',
    reviewedAt: new Date().toISOString(),
    totalDurationMs,
  }
}

// ─── Verdict derivation ───────────────────────────────────────

function deriveOverallVerdict(results: AgentResult[]): AgentVerdict {
  // Any single BLOCK → overall BLOCK
  if (results.some(r => r.verdict === 'BLOCK')) return 'BLOCK'
  // Any WARN → overall WARN
  if (results.some(r => r.verdict === 'WARN')) return 'WARN'
  return 'PASS'
}

// ─── Weighted score calculation ──────────────────────────────

function calculateWeightedScore(results: AgentResult[]): number {
  let totalWeight = 0
  let weightedScore = 0

  for (const result of results) {
    const weight = AGENT_WEIGHTS[result.agent] ?? 10
    weightedScore += result.score * weight
    totalWeight += weight
  }

  return totalWeight > 0 ? weightedScore / totalWeight : 0
}

// ─── Timeout wrapper ─────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Agent timed out after ${ms}ms`)), ms)
  )
  return Promise.race([promise, timeout])
}
