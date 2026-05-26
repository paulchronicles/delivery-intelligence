import { ObservabilityAdapter, ObservabilitySnapshot, EndpointUsage, JourneyUsage } from '../index'

export interface GenericHttpConfig {
  baseUrl: string
  headers?: Record<string, string>
  endpoints?: {
    top_endpoints?: {
      url: string
      method?: string
      response_mapping: {
        path: string
        method?: string
        calls_per_day: string
        error_rate: string
        p95_latency?: string
        unique_users?: string
      }
    }
    user_journeys?: {
      url: string
      method?: string
      response_mapping: {
        name: string
        completions_per_day: string
        completion_rate?: string
        drop_off_step?: string
        error_rate?: string
      }
    }
  }
}

function getNestedValue(obj: any, path: string): any {
  // Supports dot notation and array access: "data[].endpoint"
  const cleanPath = path.replace(/\[\]/g, '')
  return cleanPath.split('.').reduce((acc, key) => {
    if (Array.isArray(acc)) return acc.map(item => item?.[key])
    return acc?.[key]
  }, obj)
}

export class GenericHttpAdapter implements ObservabilityAdapter {
  platform = 'generic-http'
  private config: GenericHttpConfig

  constructor(config: GenericHttpConfig) {
    this.config = config
  }

  async getSnapshot(lookbackDays: number): Promise<ObservabilitySnapshot> {
    const endpoints: EndpointUsage[] = []
    const journeys: JourneyUsage[] = []

    if (this.config.endpoints?.top_endpoints) {
      try {
        const cfg = this.config.endpoints.top_endpoints
        const res = await fetch(cfg.url, {
          method: cfg.method ?? 'GET',
          headers: this.config.headers,
        })
        const data = await res.json()
        const mapping = cfg.response_mapping

        const paths = getNestedValue(data, mapping.path) as string[]
        const calls = getNestedValue(data, mapping.calls_per_day) as number[]
        const errors = getNestedValue(data, mapping.error_rate) as number[]
        const latencies = mapping.p95_latency
          ? getNestedValue(data, mapping.p95_latency) as number[]
          : []
        const users = mapping.unique_users
          ? getNestedValue(data, mapping.unique_users) as number[]
          : []

        if (Array.isArray(paths)) {
          paths.forEach((path, i) => {
            endpoints.push({
              method: 'GET',
              path,
              callsPerDay: calls?.[i] ?? 0,
              errorRate: errors?.[i] ?? 0,
              p95LatencyMs: latencies?.[i] ?? 0,
              uniqueUsers: users?.[i] ?? 0,
            })
          })
        }
      } catch (err: any) {
        console.error('[GenericHttpAdapter] endpoints fetch failed:', err.message)
      }
    }

    if (this.config.endpoints?.user_journeys) {
      try {
        const cfg = this.config.endpoints.user_journeys
        const res = await fetch(cfg.url, {
          method: cfg.method ?? 'GET',
          headers: this.config.headers,
        })
        const data = await res.json()
        const mapping = cfg.response_mapping

        const names = getNestedValue(data, mapping.name) as string[]
        const completions = getNestedValue(data, mapping.completions_per_day) as number[]

        if (Array.isArray(names)) {
          names.forEach((name, i) => {
            journeys.push({
              name,
              completionsPerDay: completions?.[i] ?? 0,
              completionRate: 1,
              dropOffStep: '',
              errorRate: 0,
            })
          })
        }
      } catch (err: any) {
        console.error('[GenericHttpAdapter] journeys fetch failed:', err.message)
      }
    }

    return {
      capturedAt: new Date().toISOString(),
      lookbackDays,
      endpoints,
      journeys,
      source: 'generic-http',
    }
  }
}
