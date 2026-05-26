import { ObservabilityAdapter, ObservabilitySnapshot, EndpointUsage, JourneyUsage } from '../index'

export interface DatadogConfig {
  apiKey: string
  appKey: string
  service: string
  env?: string
  lookbackDays?: number
}

export class DatadogAdapter implements ObservabilityAdapter {
  platform = 'datadog'
  private config: DatadogConfig
  private baseUrl = 'https://api.datadoghq.com/api/v1'
  private headers: Record<string, string>

  constructor(config: DatadogConfig) {
    this.config = config
    this.headers = {
      'DD-API-KEY': config.apiKey,
      'DD-APPLICATION-KEY': config.appKey,
      'Content-Type': 'application/json',
    }
  }

  async getSnapshot(lookbackDays: number): Promise<ObservabilitySnapshot> {
    const now = Math.floor(Date.now() / 1000)
    const from = now - (lookbackDays * 86400)
    const service = this.config.service
    const env = this.config.env ? `,env:${this.config.env}` : ''

    const endpoints: EndpointUsage[] = []
    const journeys: JourneyUsage[] = []

    try {
      // Fetch top endpoints by hit count
      const hitsQuery = `sum:trace.servlet.request.hits{service:${service}${env}} by {resource_name}.rollup(sum, 86400)`
      const hitsRes = await fetch(
        `${this.baseUrl}/query?from=${from}&to=${now}&query=${encodeURIComponent(hitsQuery)}`,
        { headers: this.headers }
      )
      const hitsData = await hitsRes.json() as any

      // Fetch error rates
      const errorsQuery = `sum:trace.servlet.request.errors{service:${service}${env}} by {resource_name}.rollup(sum, 86400)`
      const errorsRes = await fetch(
        `${this.baseUrl}/query?from=${from}&to=${now}&query=${encodeURIComponent(errorsQuery)}`,
        { headers: this.headers }
      )
      const errorsData = await errorsRes.json() as any

      // Fetch p95 latency
      const latencyQuery = `p95:trace.servlet.request.duration{service:${service}${env}} by {resource_name}`
      const latencyRes = await fetch(
        `${this.baseUrl}/query?from=${from}&to=${now}&query=${encodeURIComponent(latencyQuery)}`,
        { headers: this.headers }
      )
      const latencyData = await latencyRes.json() as any

      // Build endpoint map from hits
      const hitMap = new Map<string, number>()
      const errorMap = new Map<string, number>()
      const latencyMap = new Map<string, number>()

      for (const series of hitsData.series ?? []) {
        const name = series.scope?.replace(`resource_name:`, '') ?? ''
        const total = series.pointlist?.reduce((sum: number, pt: number[]) => sum + (pt[1] ?? 0), 0) ?? 0
        hitMap.set(name, Math.round(total / lookbackDays))
      }

      for (const series of errorsData.series ?? []) {
        const name = series.scope?.replace(`resource_name:`, '') ?? ''
        const total = series.pointlist?.reduce((sum: number, pt: number[]) => sum + (pt[1] ?? 0), 0) ?? 0
        errorMap.set(name, total / lookbackDays)
      }

      for (const series of latencyData.series ?? []) {
        const name = series.scope?.replace(`resource_name:`, '') ?? ''
        const latest = series.pointlist?.slice(-1)[0]?.[1] ?? 0
        latencyMap.set(name, Math.round(latest / 1000000)) // nanoseconds to ms
      }

      // Merge into EndpointUsage
      for (const [name, callsPerDay] of hitMap.entries()) {
        if (callsPerDay < 1) continue
        const errors = errorMap.get(name) ?? 0
        const errorRate = callsPerDay > 0 ? errors / callsPerDay : 0

        // Parse method and path from resource name (e.g. "GET /api/payments")
        const parts = name.split(' ')
        const method = parts.length > 1 ? parts[0] : 'GET'
        const path = parts.length > 1 ? parts.slice(1).join(' ') : name

        endpoints.push({
          method,
          path,
          callsPerDay,
          errorRate: Math.min(errorRate, 1),
          p95LatencyMs: latencyMap.get(name) ?? 0,
          uniqueUsers: 0, // requires RUM data
        })
      }

      // Sort by calls per day descending
      endpoints.sort((a, b) => b.callsPerDay - a.callsPerDay)

    } catch (err: any) {
      console.error('[DatadogAdapter] API call failed:', err.message)
    }

    return {
      capturedAt: new Date().toISOString(),
      lookbackDays,
      endpoints,
      journeys,
      source: 'datadog',
    }
  }
}
