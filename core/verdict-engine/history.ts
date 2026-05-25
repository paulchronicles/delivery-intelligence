import fs from 'fs'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')
const HISTORY_FILE = path.join(DATA_DIR, 'review-history.json')

interface ReviewSnapshot {
  reviewedAt: string
  blockers: number
  criticals: number
  majors: number
  readiness: string
  concernIds: string[]
  concernFindings: string[]
}

type ReviewHistory = Record<string, ReviewSnapshot[]>

function loadHistory(): ReviewHistory {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    if (!fs.existsSync(HISTORY_FILE)) return {}
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function saveHistory(history: ReviewHistory): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2))
  } catch (err) {
    console.error('Failed to save review history:', err)
  }
}

export function recordReview(ticketId: string, verdict: any): void {
  const history = loadHistory()
  if (!history[ticketId]) history[ticketId] = []

  const allConcerns = verdict.agentResults?.flatMap((r: any) => r.concerns) ?? []
  const majors = allConcerns.filter((c: any) => c.severity === 'MAJOR').length

  const snapshot: ReviewSnapshot = {
    reviewedAt: verdict.reviewedAt,
    blockers: verdict.blockers.length,
    criticals: verdict.criticals.length,
    majors,
    readiness: verdict.overallVerdict,
    concernIds: allConcerns.map((c: any) => c.id),
    concernFindings: allConcerns.map((c: any) => c.finding),
  }

  history[ticketId].push(snapshot)

  // Keep last 10 reviews per ticket
  if (history[ticketId].length > 10) {
    history[ticketId] = history[ticketId].slice(-10)
  }

  saveHistory(history)
}

export function getPreviousReview(ticketId: string): ReviewSnapshot | null {
  const history = loadHistory()
  const reviews = history[ticketId] ?? []
  if (reviews.length < 2) return null
  return reviews[reviews.length - 2]
}

export function getReviewCount(ticketId: string): number {
  const history = loadHistory()
  return (history[ticketId] ?? []).length
}
