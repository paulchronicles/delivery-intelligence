import { FinalVerdict, AgentConcern, Severity, AgentResult } from '../types/index'
import { getReadinessLevel, READINESS_LABEL } from '../types/index'
import { getPreviousReview } from '../verdict-engine/history'

const SEVERITY_ICON: Record<Severity, string> = {
  BLOCKER:  '🔴',
  CRITICAL: '🟠',
  MAJOR:    '🟡',
  MINOR:    '🔵',
}

// ─── Main formatter ───────────────────────────────────────────

export function formatVerdictAsText(verdict: FinalVerdict): string {
  const allConcerns = verdict.agentResults.flatMap(r => r.concerns)
  const majors = allConcerns.filter(c => c.severity === 'MAJOR')
  const minors = allConcerns.filter(c => c.severity === 'MINOR')

  const readiness = getReadinessLevel(
    verdict.blockers.length,
    verdict.criticals.length,
    majors.length
  )

  const lines: string[] = []

  // ── Header ──
  lines.push(`Requirement Review — ${verdict.ticketId}`)
  lines.push('━'.repeat(50))
  lines.push(READINESS_LABEL[readiness])
  lines.push(`Reviewed: ${formatDate(verdict.reviewedAt)}`)
  lines.push('')

  // ── Re-review comparison ──
  const previous = getPreviousReview(verdict.ticketId)
  if (previous) {
    const prevBlockers = previous.blockers
    const prevCriticals = previous.criticals
    const currBlockers = verdict.blockers.length
    const currCriticals = verdict.criticals.length
    const blockerDiff = prevBlockers - currBlockers
    const criticalDiff = prevCriticals - currCriticals

    lines.push(`Previously reviewed: ${previous.reviewedAt.slice(0, 10)}`)

    if (blockerDiff > 0 || criticalDiff > 0) {
      const improvements: string[] = []
      if (blockerDiff > 0) improvements.push(`${blockerDiff} blocker${blockerDiff > 1 ? 's' : ''} resolved ✓`)
      if (criticalDiff > 0) improvements.push(`${criticalDiff} critical${criticalDiff > 1 ? 's' : ''} resolved ✓`)
      lines.push(`Progress: ${improvements.join(', ')}`)
    } else if (blockerDiff < 0) {
      lines.push(`⚠️  Regression: ${Math.abs(blockerDiff)} new blocker${Math.abs(blockerDiff) > 1 ? 's' : ''} added`)
    } else {
      lines.push(`No change since last review`)
    }
    lines.push('')
  }

  if (readiness === 'READY') {
    lines.push('This ticket meets the quality bar and is clear for development.')
    lines.push('')
    lines.push(formatPassedChecks(verdict.agentResults))
    lines.push('')
    lines.push(`Reviewed by: ${verdict.reviewedBy}`)
    return lines.join('\n')
  }

  // ── Blockers ──
  if (verdict.blockers.length > 0) {
    const plural = verdict.blockers.length === 1 ? 'blocker' : 'blockers'
    lines.push(`${verdict.blockers.length} ${plural} must be resolved before development can start.`)
    lines.push('')
    for (const concern of verdict.blockers) {
      lines.push(formatConcernFull(concern))
    }
  }

  // ── Criticals ──
  if (verdict.criticals.length > 0) {
    if (verdict.blockers.length > 0) lines.push('─'.repeat(40))
    const plural = verdict.criticals.length === 1 ? 'critical issue' : 'critical issues'
    lines.push(`${verdict.criticals.length} ${plural} will cause mid-sprint problems if not addressed.`)
    lines.push('')
    for (const concern of verdict.criticals) {
      lines.push(formatConcernFull(concern))
    }
  }

  // ── Majors ──
  if (majors.length > 0) {
    lines.push('─'.repeat(40))
    lines.push('Also worth fixing:')
    lines.push('')
    for (const concern of majors) {
      lines.push(formatConcernShort(concern))
    }
    lines.push('')
  }

  // ── Minors ──
  if (minors.length > 0) {
    lines.push('Suggestions (advisory only):')
    for (const concern of minors) {
      lines.push(`  ${SEVERITY_ICON[concern.severity]} ${concern.location} — ${concern.finding}`)
    }
    lines.push('')
  }

  // ── What passed ──
  const passedChecks = getPassedChecks(verdict.agentResults)
  if (passedChecks.length > 0) {
    lines.push('━━━ What passed ━━━')
    for (const check of passedChecks) {
      lines.push(`✓ ${check}`)
    }
    lines.push('')
  }

  // ── Next step ──
  lines.push('━━━ Next step ━━━')
  if (readiness === 'NOT_READY') {
    lines.push(`Fix these ${verdict.blockers.length} issue${verdict.blockers.length > 1 ? 's' : ''} before re-submitting:`)
    verdict.blockers.forEach((c, i) => {
      lines.push(`${i + 1}. ${c.suggestion} (${c.location})`)
    })
    lines.push('')
    lines.push('Then move the ticket back to Ready for Review.')
  } else if (readiness === 'NEEDS_WORK') {
    lines.push(`Address these ${verdict.criticals.length} issue${verdict.criticals.length > 1 ? 's' : ''} before re-submitting:`)
    verdict.criticals.forEach((c, i) => {
      lines.push(`${i + 1}. ${c.suggestion} (${c.location})`)
    })
    lines.push('')
    lines.push('Then move the ticket back to Ready for Review.')
  } else {
    lines.push('Minor gaps noted above — can proceed but consider addressing before development.')
  }
  lines.push('')
  if (readiness === 'NOT_READY' || readiness === 'NEEDS_WORK') {
    lines.push(`Want me to rewrite ${verdict.ticketId} with all these issues fixed?`)
  }
  lines.push('')
  lines.push(`Reviewed by: ${verdict.reviewedBy}  |  ${formatDate(verdict.reviewedAt)}`)

  return lines.join('\n')
}

// ─── Concern formatters ───────────────────────────────────────

function formatConcernFull(c: AgentConcern): string {
  const lines = [
    `${SEVERITY_ICON[c.severity]} ${c.severity} — ${formatConcernTitle(c)}`,
    `Location: ${c.location}`,
    `Finding: ${c.finding}`,
    `Why it matters: ${c.whyItMatters}`,
    `Fix: ${c.suggestion}`,
  ]
  if (c.example) {
    lines.push(`Example: "${c.example}"`)
  }
  if (c.confidence < 0.7) {
    lines.push(`⚠️  Low confidence — human review recommended`)
  }
  lines.push('')
  return lines.join('\n')
}

function formatConcernShort(c: AgentConcern): string {
  return `  ${SEVERITY_ICON[c.severity]} ${c.location} — ${c.finding}\n  Fix: ${c.suggestion}\n`
}

function formatConcernTitle(c: AgentConcern): string {
  const titles: Record<string, string> = {
    'TESTABILITY': 'Untestable acceptance criterion',
    'CLARITY': 'Ambiguous language',
    'COMPLETENESS': 'Missing required element',
    'COMPLIANCE': 'Compliance gap',
  }
  const prefix = c.id.split('-')[0]
  return titles[prefix] ?? c.agent
}

// ─── Passed checks ────────────────────────────────────────────

function getPassedChecks(results: AgentResult[]): string[] {
  const checks: string[] = []
  for (const result of results) {
    if (result.verdict === 'PASS') {
      checks.push(`${result.agent}: ${result.summary}`)
    }
  }
  return checks
}

function formatPassedChecks(results: AgentResult[]): string {
  return results
    .map(r => `✓ ${r.agent}: ${r.summary}`)
    .join('\n')
}

// ─── Helpers ──────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
