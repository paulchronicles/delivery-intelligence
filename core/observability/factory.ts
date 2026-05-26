import { ObservabilityAdapter } from './index'

export function createObservabilityAdapter(config: any): ObservabilityAdapter | null {
  if (!config?.observability) return null

  const obs = config.observability
  const platform = obs.platform?.toLowerCase()

  switch (platform) {
    case 'datadog': {
      const { DatadogAdapter } = require('./adapters/datadog.adapter')
      return new DatadogAdapter({
        apiKey: process.env.DATADOG_API_KEY ?? obs.api_key ?? '',
        appKey: process.env.DATADOG_APP_KEY ?? obs.app_key ?? '',
        service: obs.service ?? '',
        env: obs.env ?? 'production',
      })
    }

    case 'newrelic': {
      // New Relic adapter — placeholder for future implementation
      console.error('[ObservabilityFactory] New Relic adapter not yet implemented')
      return null
    }

    case 'mixpanel': {
      // Mixpanel adapter — placeholder for future implementation
      console.error('[ObservabilityFactory] Mixpanel adapter not yet implemented')
      return null
    }

    case 'amplitude': {
      // Amplitude adapter — placeholder for future implementation
      console.error('[ObservabilityFactory] Amplitude adapter not yet implemented')
      return null
    }

    case 'generic-http': {
      const { GenericHttpAdapter } = require('./adapters/generic-http.adapter')
      const headers: Record<string, string> = {}

      // Resolve auth header
      if (obs.auth_header && obs.auth_value) {
        headers[obs.auth_header] = process.env[obs.auth_value_env] ?? obs.auth_value ?? ''
      }

      return new GenericHttpAdapter({
        baseUrl: obs.base_url ?? '',
        headers,
        endpoints: obs.endpoints,
      })
    }

    default:
      console.error(`[ObservabilityFactory] Unknown platform: ${platform}`)
      return null
  }
}
