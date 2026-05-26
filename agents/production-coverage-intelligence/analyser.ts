import {
  EndpointUsage,
  CoverageGap,
  CoverageReport,
  GapPriority,
  ObservabilitySnapshot,
} from '../../core/observability/index'
import fs from 'fs'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')
const HISTORY_FILE = path.join(DATA_DIR, 'coverage-history.json')

interface HistoryEntry {
  generatedAt: string
  team: string
  gaps: string[]
  confidence: number
}

function loadHistory(): HistoryEntry[] {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    if (!fs.existsSync(HISTORY_FILE)) return []
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'))
  } catch { return [] }
}

function saveHistory(entry: HistoryEntry): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    const history = loadHistory()
    history.push(entry)
    const teamHistory = history.filter(h => h.team === entry.team).slice(-90)
    const otherHistory = history.filter(h => h.team !== entry.team)
    fs.writeFileSync(HISTORY_FILE, JSON.stringify([...otherHistory, ...teamHistory], null, 2))
  } catch (err: any) {
    console.error('Failed to save coverage history:', err.message)
  }
}

function getPreviousReport(team: string): HistoryEntry | null {
  const history = loadHistory().filter(h => h.team === team)
  return history.length > 1 ? history[history.length - 2] : null
}

function calculatePriorityScore(callsPerDay: number, errorRate: number, coverageScore: number): number {
  const usageWeight = Math.log10(Math.max(callsPerDay, 1)) / 4
  const errorWeight = errorRate
  const coverageGap = 1 - coverageScore
  return Math.round((usageWeight + errorWeight + coverageGap) / 3 * 100)
}

function getPriority(score: number, errorRate: number, callsPerDay: number): GapPriority {
  if (errorRate > 0.1 && callsPerDay > 500) return 'CRITICAL'
  if (score >= 70) return 'CRITICAL'
  if (score >= 50) return 'HIGH'
  if (score >= 30) return 'MEDIUM'
  return 'LOW'
}

function calculateCoverageScore(existingTests: string[]): number {
  if (existingTests.length === 0) return 0
  if (existingTests.length >= 5) return 1
  return existingTests.length / 5
}

export interface TestedEndpoint {
  path: string
  scenarios: string[]
}

export function analyseGaps(
  team: string,
  snapshot: ObservabilitySnapshot,
  testedEndpoints: TestedEndpoint[],
  minCallsPerDay: number = 10
): CoverageReport {
  const previous = getPreviousReport(team)
  const previousGaps = new Set(previous?.gaps ?? [])

  const testedMap = new Map<string, string[]>()
  for (const te of testedEndpoints) {
    testedMap.set(te.path.toLowerCase(), te.scenarios)
  }

  const allGaps: CoverageGap[] = []
  const wellCovered: string[] = []

  for (const endpoint of snapshot.endpoints) {
    if (endpoint.callsPerDay < minCallsPerDay) continue

    const key = endpoint.path.toLowerCase()
    const existingTests = testedMap.get(key) ?? []
    const coverageScore = calculateCoverageScore(existingTests)

    if (coverageScore >= 0.8) {
      wellCovered.push(`${endpoint.method} ${endpoint.path}`)
      continue
    }

    const priorityScore = calculatePriorityScore(endpoint.callsPerDay, endpoint.errorRate, coverageScore)
    const priority = getPriority(priorityScore, endpoint.errorRate, endpoint.callsPerDay)
    const isNew = !previousGaps.has(endpoint.path)
    const trend: CoverageGap['trend'] = (!previous || !previousGaps.has(endpoint.path)) ? 'NEW' : 'STABLE'

    const missingScenarios: string[] = []
    if (existingTests.length === 0) {
      missingScenarios.push('Happy path - successful request')
      missingScenarios.push('Error state - API returns 4xx/5xx')
      if (endpoint.errorRate > 0.05) {
        missingScenarios.push(`Error recovery - endpoint has ${Math.round(endpoint.errorRate * 100)}% error rate`)
      }
    } else if (coverageScore < 0.5) {
      missingScenarios.push('Additional error states not covered')
      missingScenarios.push('Edge cases and boundary conditions')
    }

    allGaps.push({
      endpoint: `${endpoint.method} ${endpoint.path}`,
      callsPerDay: endpoint.callsPerDay,
      errorRate: endpoint.errorRate,
      existingTests,
      missingScenarios,
      priority,
      priorityScore,
      isNew,
      trend,
    })
  }

  allGaps.sort((a, b) => b.priorityScore - a.priorityScore)

  const criticalGaps = allGaps.filter(g => g.priority === 'CRITICAL')
  const highGaps = allGaps.filter(g => g.priority === 'HIGH')
  const mediumGaps = allGaps.filter(g => g.priority === 'MEDIUM')
  const newGapsThisWeek = allGaps.filter(g => g.isNew)

  const currentGapPaths = new Set(allGaps.map(g => g.endpoint))
  const resolvedSinceLastReport = [...previousGaps].filter(p => !currentGapPaths.has(p))

  const coverageConfidence = 0 // not used in output — kept for history tracking only

  let trend: CoverageReport['trend'] = 'STABLE'
  if (previous) {
    if (resolvedSinceLastReport.length > newGapsThisWeek.length) trend = 'IMPROVING'
    else if (newGapsThisWeek.length > resolvedSinceLastReport.length) trend = 'DEGRADING'
  }

  const report: CoverageReport = {
    generatedAt: new Date().toISOString(),
    team,
    lookbackDays: snapshot.lookbackDays,
    coverageConfidence,
    criticalGaps,
    highGaps,
    mediumGaps,
    wellCovered,
    newGapsThisWeek,
    resolvedSinceLastReport,
    trend,
  }

  saveHistory({
    generatedAt: report.generatedAt,
    team,
    gaps: allGaps.map(g => g.endpoint),
    confidence: coverageConfidence,
  })

  return report
}

export function formatCoverageReport(report: CoverageReport): string {
  const lines: string[] = []
  const trendIcon = report.trend === 'IMPROVING' ? 'improving' : report.trend === 'DEGRADING' ? 'degrading' : 'stable'

  lines.push(`Production Coverage Intelligence -- ${report.team}`)
  lines.push('='.repeat(50))
  lines.push(`Generated: ${new Date(report.generatedAt).toLocaleString('en-GB')}`)
  // Coverage status — plain English, no percentage
  let coverageStatus: string
  if (report.criticalGaps.length > 0) {
    coverageStatus = 'CRITICAL -- high-traffic endpoints have no test coverage'
  } else if (report.highGaps.length > 0) {
    coverageStatus = 'NEEDS WORK -- critical paths are partially covered'
  } else if (report.mediumGaps.length > 0) {
    coverageStatus = 'NEARLY HEALTHY -- minor gaps remain'
  } else {
    coverageStatus = 'HEALTHY -- high-traffic endpoints have adequate coverage'
  }
  lines.push(`Coverage status: ${coverageStatus}`)
  lines.push(`Trend: ${trendIcon.toUpperCase()}`)
  lines.push(`Lookback: ${report.lookbackDays} days`)
  lines.push('')

  if (report.newGapsThisWeek.length > 0) {
    lines.push(`WARNING: ${report.newGapsThisWeek.length} new gap(s) detected since last report`)
    lines.push('')
  }

  if (report.resolvedSinceLastReport.length > 0) {
    lines.push(`RESOLVED: ${report.resolvedSinceLastReport.length} gap(s) resolved since last report`)
    for (const r of report.resolvedSinceLastReport) lines.push(`  + ${r}`)
    lines.push('')
  }

  if (report.criticalGaps.length > 0) {
    lines.push('CRITICAL GAPS -- High usage, insufficient coverage')
    lines.push('')
    for (const gap of report.criticalGaps) {
      lines.push(`  ${gap.endpoint}`)
      lines.push(`  -> ${gap.callsPerDay.toLocaleString()} calls/day  |  ${Math.round(gap.errorRate * 100)}% error rate${gap.isNew ? '  |  NEW' : ''}`)
      if (gap.existingTests.length > 0) lines.push(`  -> Existing: ${gap.existingTests.length} test(s)`)
      else lines.push(`  -> No automated tests found`)
      for (const m of gap.missingScenarios) lines.push(`  -> Missing: ${m}`)
      lines.push('')
    }
  }

  if (report.highGaps.length > 0) {
    lines.push('HIGH PRIORITY GAPS')
    lines.push('')
    for (const gap of report.highGaps) {
      lines.push(`  ${gap.endpoint}`)
      lines.push(`  -> ${gap.callsPerDay.toLocaleString()} calls/day  |  ${Math.round(gap.errorRate * 100)}% error rate${gap.isNew ? '  |  NEW' : ''}`)
      if (gap.missingScenarios.length > 0) lines.push(`  -> Missing: ${gap.missingScenarios[0]}`)
      lines.push('')
    }
  }

  if (report.mediumGaps.length > 0) {
    lines.push('MEDIUM PRIORITY GAPS')
    lines.push('')
    for (const gap of report.mediumGaps) {
      lines.push(`  ${gap.endpoint}  ->  ${gap.callsPerDay.toLocaleString()} calls/day`)
    }
    lines.push('')
  }

  if (report.wellCovered.length > 0) {
    lines.push('WELL COVERED')
    for (const e of report.wellCovered) lines.push(`  + ${e}`)
    lines.push('')
  }

  lines.push('-'.repeat(50))
  lines.push(`Top automation priority: ${report.criticalGaps[0]?.endpoint ?? report.highGaps[0]?.endpoint ?? 'No critical gaps -- coverage is healthy'}`)

  return lines.join('\n')
}
