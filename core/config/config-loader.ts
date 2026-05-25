import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { TeamConfig, AgentConfig } from '../types'

const CONFIG_DIR = path.join(process.cwd(), 'config')

// ─── Team Config ────────────────────────────────────────────

const teamConfigCache = new Map<string, TeamConfig>()

export function getTeamConfig(teamKey: string): TeamConfig {
  if (teamConfigCache.has(teamKey)) {
    return teamConfigCache.get(teamKey)!
  }

  const filePath = path.join(CONFIG_DIR, 'teams', `${teamKey.toLowerCase()}.yaml`)

  if (!fs.existsSync(filePath)) {
    // Fall back to default config
    return getDefaultTeamConfig(teamKey)
  }

  const raw = fs.readFileSync(filePath, 'utf8')
  const config = yaml.load(raw) as TeamConfig
  teamConfigCache.set(teamKey, config)
  return config
}

function getDefaultTeamConfig(teamKey: string): TeamConfig {
  return {
    team: teamKey,
    projectKey: teamKey,
    qaLead: process.env.DEFAULT_QA_LEAD ?? '',
    slackChannel: '#qa-general',
    targetTransitionState: 'Ready for Review',
    definitionOfDone: {
      acceptanceCriteriaMinimum: 2,
      designsRequired: false,
      nonFunctionalRequired: false,
    },
    complianceTriggers: [],
    severityOverrides: {},
  }
}

// ─── Agent Config ────────────────────────────────────────────

const agentConfigCache = new Map<string, AgentConfig>()

export function getAgentConfig(agentName: string): AgentConfig {
  if (agentConfigCache.has(agentName)) {
    return agentConfigCache.get(agentName)!
  }

  const filePath = path.join(CONFIG_DIR, 'agents', `${agentName}.yaml`)

  if (!fs.existsSync(filePath)) {
    throw new Error(`Agent config not found: ${agentName}`)
  }

  const raw = fs.readFileSync(filePath, 'utf8')
  const config = yaml.load(raw) as AgentConfig
  agentConfigCache.set(agentName, config)
  return config
}

// ─── Cache Invalidation (for hot-reloading in dev) ──────────

export function clearConfigCache() {
  teamConfigCache.clear()
  agentConfigCache.clear()
}
