import { FinalVerdict, AgentConcern, Severity, AgentResult } from '../types'

const SEVERITY_ICON: Record<Severity, string> = {
  BLOCKER: '🔴',
  CRITICAL: '🟠',
  MAJOR: '🟡',
  MINOR: '🔵',
}

const VERDICT_ICON: Record<string, string> = {
  PASS: '✅',
  WARN: '⚠️',
  BLOCK: '🔴',
}

// ─── Main formatter ───────────────────────────────────────────

export function formatVerdictAsText(verdict: FinalVerdict): string {
  const lines: string[] = []
  const icon = VERDICT_ICON[verdict.overallVerdict]

  // ── Header ──
  lines.push(`${icon} QA Gate Agent — ${verdict.overallVerdict}`)
  lines.push('━'.repeat(50))
  lines.push(
    `Overall Score: ${verdict.overallScore}/100  |  ` +
    `${verdict.blockers.length} Blocker(s)  |  ` +
    `${verdict.criticals.length} Critical(s)  |  ` +
    `Reviewed in ${(verdict.totalDurationMs / 1000).toFixed(1)}s`
  )
  lines.push('')

  if (verdict.overallVerdict === 'PASS') {
    lines.push('All checks passed. Ticket is clear for development.')
    lines.push('')
    lines.push(formatPassedAgents(verdict.agentResults))
    lines.push('')
    lines.push(`Reviewed by: ${verdict.reviewedBy}  |  ${formatDate(verdict.reviewedAt)}`)
    return lines.join('\n')
  }

  // ── Blockers ──
  if (verdict.blockers.length > 0) {
    lines.push('━━━ 🔴 BLOCKERS (must fix before progression) ━━━')
    lines.push('')
    for (const concern of verdict.blockers) {
      lines.push(formatConcern(concern))
    }
  }

  // ── Criticals ──
  if (verdict.criticals.length > 0) {
    lines.push('━━━ 🟠 CRITICAL ━━━')
    lines.push('')
    for (const concern of verdict.criticals) {
      lines.push(formatConcern(concern))
    }
  }

  // ── Majors ──
  const majors = verdict.agentResults
    .flatMap(r => r.concerns)
    .filter(c => c.severity === 'MAJOR')

  if (majors.length > 0) {
    lines.push('━━━ 🟡 MAJOR ━━━')
    lines.push('')
    for (const concern of majors) {
      lines.push(formatConcernShort(concern))
    }
    lines.push('')
  }

  // ── Minors ──
  const minors = verdict.agentResults
    .flatMap(r => r.concerns)
    .filter(c => c.severity === 'MINOR')

  if (minors.length > 0) {
    lines.push('━━━ 🔵 MINOR (advisory) ━━━')
    lines.push('')
    for (const concern of minors) {
      lines.push(formatConcernShort(concern))
    }
    lines.push('')
  }

  // ── Passed agents ──
  const passedAgents = verdict.agentResults.filter(r => r.verdict === 'PASS')
  if (passedAgents.length > 0) {
    lines.push('━━━ ✅ PASSED ━━━')
    lines.push(passedAgents.map(r => `${r.agent}: OK (${r.score}/100)`).join('  |  '))
    lines.push('')
  }

  // ── Agent score breakdown ──
  lines.push('━━━ SCORE BREAKDOWN ━━━')
  for (const result of verdict.agentResults) {
    const bar = scoreBar(result.score)
    lines.push(`${result.agent.padEnd(14)} ${bar} ${result.score}/100`)
  }
  lines.push('')

  // ── Footer ──
  if (verdict.overallVerdict === 'BLOCK') {
    lines.push('──────────────────────────────────────────────────')
    lines.push(`To unblock: resolve all 🔴 BLOCKER items, then move ticket back to "Ready for Review".`)
  } else if (verdict.overallVerdict === 'WARN') {
    lines.push('──────────────────────────────────────────────────')
    lines.push('Ticket has been flagged for QA Lead review. A human will make the final call.')
  }

  if (verdict.requiresHumanReview) {
    lines.push('⚠️  Some concerns had low confidence — QA Lead review recommended.')
  }

  lines.push('')
  lines.push(`Reviewed by: ${verdict.reviewedBy}  |  ${formatDate(verdict.reviewedAt)}`)

  return lines.join('\n')
}

// ─── Concern formatters ───────────────────────────────────────

function formatConcern(c: AgentConcern): string {
  const lines = [
    `[${c.id}] ${c.location}`,
    `→ ${c.finding}`,
    `→ WHY IT MATTERS: ${c.whyItMatters}`,
    `→ FIX: ${c.suggestion}`,
  ]
  if (c.example) {
    lines.push(`→ EXAMPLE: "${c.example}"`)
  }
  if (c.confidence < 0.7) {
    lines.push(`→ ⚠️  Low confidence (${Math.round(c.confidence * 100)}%) — human review recommended`)
  }
  lines.push('')
  return lines.join('\n')
}

function formatConcernShort(c: AgentConcern): string {
  return `[${c.id}] ${c.location} — ${c.finding}`
}

function formatPassedAgents(results: AgentResult[]): string {
  return results
    .map(r => `✅ ${r.agent} (${r.score}/100): ${r.summary}`)
    .join('\n')
}

// ─── Helpers ──────────────────────────────────────────────────

function scoreBar(score: number): string {
  const filled = Math.round(score / 10)
  return '█'.repeat(filled) + '░'.repeat(10 - filled)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
