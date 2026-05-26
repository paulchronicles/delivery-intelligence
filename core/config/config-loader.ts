import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { TeamConfig, AgentConfig } from '../types'

const CONFIG_DIR = path.join(__dirname, '..', '..', 'config')

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
  const r: any = yaml.load(raw)
  const config: TeamConfig = {
    team: r.team,
    projectKey: r.project_key ?? r.projectKey,
    qaLead: r.qa_lead ?? r.qaLead ?? '',
    slackChannel: r.slack_channel ?? r.slackChannel ?? '#qa-general',
    targetTransitionState: r.target_transition_state ?? r.targetTransitionState ?? 'Ready for Review',
    definitionOfDone: {
      acceptanceCriteriaMinimum: r.definition_of_done?.acceptance_criteria_minimum ?? r.definitionOfDone?.acceptanceCriteriaMinimum ?? 2,
      designsRequired: r.definition_of_done?.designs_required ?? r.definitionOfDone?.designsRequired ?? false,
      nonFunctionalRequired: r.definition_of_done?.non_functional_required ?? r.definitionOfDone?.nonFunctionalRequired ?? false,
    },
    complianceTriggers: (r.compliance_triggers ?? r.complianceTriggers ?? []).map((t: any) => ({
      keyword: t.keyword,
      requirement: t.requirement,
      severity: t.severity,
    })),
    severityOverrides: r.severity_overrides ?? r.severityOverrides ?? {},
  }
  // Merge raw yaml fields so unknown fields like test_repo are preserved
  const merged = { ...r, ...config }
  teamConfigCache.set(teamKey, merged)
  return merged
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

  const agentsDir = path.join(__dirname, '..', '..', 'agents')
  const agentFolders = fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir) : []
  let filePath = ''

  for (const folder of agentFolders) {
    const candidate = path.join(agentsDir, folder, 'config', `${agentName}.yaml`)
    if (fs.existsSync(candidate)) { filePath = candidate; break }
  }

  if (!filePath) {
    const legacy = path.join(CONFIG_DIR, 'agents', `${agentName}.yaml`)
    if (fs.existsSync(legacy)) filePath = legacy
  }

  if (!filePath) {
    throw new Error(`Agent config not found: ${agentName}`)
  }

  const raw = fs.readFileSync(filePath, 'utf8')
  const raw_config: any = yaml.load(raw)
  // Map snake_case YAML keys to camelCase TypeScript
  const config: AgentConfig = {
    agent: raw_config.agent,
    version: raw_config.version,
    enabled: raw_config.enabled ?? true,
    systemPrompt: raw_config.system_prompt ?? raw_config.systemPrompt ?? '',
    vagueTerms: raw_config.vague_terms ?? raw_config.vagueTerms,
    scoringWeights: raw_config.scoring_weights ?? raw_config.scoringWeights,
    concernTemplates: raw_config.concern_templates ?? raw_config.concernTemplates,
  }
  agentConfigCache.set(agentName, config)
  return config
}

// ─── Cache Invalidation (for hot-reloading in dev) ──────────

export function clearConfigCache() {
  teamConfigCache.clear()
  agentConfigCache.clear()
}
