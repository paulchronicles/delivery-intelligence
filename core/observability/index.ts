// ─── Normalised types ─────────────────────────────────────────
// Every platform adapter returns these shapes.
// The agent never sees platform-specific types.

export interface EndpointUsage {
  method: string          // GET, POST, PUT, DELETE
  path: string            // /api/payments/retry
  callsPerDay: number     // average over lookback period
  errorRate: number       // 0.0 - 1.0
  p95LatencyMs: number    // 95th percentile response time
  uniqueUsers: number     // distinct users hitting this endpoint
}

export interface JourneyUsage {
  name: string            // "Checkout flow"
  completionsPerDay: number
  completionRate: number  // 0.0 - 1.0
  dropOffStep: string     // where users abandon most
  errorRate: number
}

export interface ObservabilitySnapshot {
  capturedAt: string      // ISO timestamp
  lookbackDays: number
  endpoints: EndpointUsage[]
  journeys: JourneyUsage[]
  source: string          // "datadog" | "newrelic" | "generic-http"
}

// ─── Adapter interface ────────────────────────────────────────
// Every platform adapter must implement this.

export interface ObservabilityAdapter {
  platform: string
  getSnapshot(lookbackDays: number): Promise<ObservabilitySnapshot>
}

// ─── Coverage types ───────────────────────────────────────────

export type GapPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

export interface CoverageGap {
  endpoint: string
  callsPerDay: number
  errorRate: number
  existingTests: string[]
  missingScenarios: string[]
  priority: GapPriority
  priorityScore: number   // callsPerDay × errorRate × (1 - coverageScore)
  isNew: boolean          // appeared since last report
  trend: 'NEW' | 'WORSENING' | 'STABLE' | 'IMPROVING' | 'RESOLVED'
}

export interface CoverageReport {
  generatedAt: string
  team: string
  lookbackDays: number
  coverageConfidence: number  // 0-100
  criticalGaps: CoverageGap[]
  highGaps: CoverageGap[]
  mediumGaps: CoverageGap[]
  wellCovered: string[]
  newGapsThisWeek: CoverageGap[]
  resolvedSinceLastReport: string[]
  trend: 'IMPROVING' | 'STABLE' | 'DEGRADING'
}
