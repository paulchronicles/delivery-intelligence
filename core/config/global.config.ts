import { GlobalConfig } from '../types'

export const globalConfig: GlobalConfig = {
  anthropic: {
    model: 'claude-sonnet-4-20250514',
    maxTokens: 1000,
    temperature: 0.1,   // low — consistent, not creative
  },
  verdictRules: {
    hardBlockOn: ['BLOCKER'],
    softBlockOn: ['CRITICAL'],
    autoPassThreshold: 80,
    confidenceFloor: 0.6,
  },
  webhook: {
    timeoutBehaviour: 'block',  // if agent times out, be safe and block
    timeoutSeconds: 60,
  },
}
