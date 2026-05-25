import crypto from 'crypto'
import axios from 'axios'
import {
  PlatformAdapter,
  NormalisedTicket,
  FinalVerdict,
  TicketType,
  Priority,
} from '../types'
import { formatVerdictAsText } from '../verdict-engine/formatter'

export class JiraAdapter implements PlatformAdapter {
  platform = 'jira' as const

  private api = axios.create({
    baseURL: process.env.JIRA_BASE_URL,
    auth: {
      username: process.env.JIRA_BOT_EMAIL!,
      password: process.env.JIRA_API_TOKEN!,
    },
    headers: { 'Content-Type': 'application/json' },
  })

  // ─── Inbound ─────────────────────────────────────────────

  parseWebhook(payload: any): NormalisedTicket | null {
    const { issue, changelog, user } = payload
    if (!issue || !changelog) return null

    // Only process status transitions
    const statusChange = changelog.items?.find((i: any) => i.field === 'status')
    if (!statusChange) return null

    return {
      id: issue.key,
      platform: 'jira',
      url: `${process.env.JIRA_BASE_URL}/browse/${issue.key}`,
      title: issue.fields?.summary ?? '',
      description: this.extractText(issue.fields?.description),
      acceptanceCriteria: this.extractAC(issue.fields?.description),
      storyFormat: this.extractStoryFormat(issue.fields?.description),
      type: this.mapIssueType(issue.fields?.issuetype?.name),
      priority: this.mapPriority(issue.fields?.priority?.name),
      labels: issue.fields?.labels ?? [],
      linkedTickets: (issue.fields?.issuelinks ?? [])
        .map((l: any) => l.outwardIssue?.key ?? l.inwardIssue?.key)
        .filter(Boolean),
      hasDesigns: this.detectDesignLinks(issue.fields),
      assignee: issue.fields?.assignee?.emailAddress ?? null,
      team: issue.fields?.project?.key ?? '',
      fromState: statusChange.fromString,
      toState: statusChange.toString,
      triggeredBy: user?.emailAddress ?? 'unknown',
      triggeredAt: new Date().toISOString(),
    }
  }

  verifySignature(headers: Record<string, string>, rawBody: string): boolean {
    const signature = headers['x-hub-signature']
    const secret = process.env.JIRA_WEBHOOK_SECRET
    if (!signature || !secret) return false

    const hmac = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex')

    return `sha256=${hmac}` === signature
  }

  async fetchTicket(id: string): Promise<NormalisedTicket> {
    const { data } = await this.api.get(`/rest/api/3/issue/${id}`)
    const fields = data.fields ?? {}
    return {
      id: data.key,
      platform: 'jira',
      url: `${process.env.JIRA_BASE_URL}/browse/${data.key}`,
      title: fields.summary ?? '',
      description: this.extractText(fields.description),
      acceptanceCriteria: this.extractAC(fields.description),
      storyFormat: this.extractStoryFormat(fields.description),
      type: this.mapIssueType(fields.issuetype?.name),
      priority: this.mapPriority(fields.priority?.name),
      labels: fields.labels ?? [],
      linkedTickets: (fields.issuelinks ?? [])
        .map((l: any) => l.outwardIssue?.key ?? l.inwardIssue?.key)
        .filter(Boolean),
      hasDesigns: this.detectDesignLinks(fields),
      assignee: fields.assignee?.emailAddress ?? null,
      team: fields.project?.key ?? '',
      fromState: '',
      toState: fields.status?.name ?? '',
      triggeredBy: 'manual',
      triggeredAt: new Date().toISOString(),
    }
  }

  // ─── Outbound ─────────────────────────────────────────────

  async postComment(ticketId: string, verdict: FinalVerdict): Promise<void> {
    const body = formatVerdictAsText(verdict)

    await this.api.post(`/rest/api/3/issue/${ticketId}/comment`, {
      body: {
        type: 'doc',
        version: 1,
        content: [{
          type: 'codeBlock',
          content: [{ type: 'text', text: body }],
        }],
      },
    })
  }

  async updateStatus(ticketId: string, action: 'approve' | 'reject'): Promise<void> {
    // Get available transitions
    const { data } = await this.api.get(`/rest/api/3/issue/${ticketId}/transitions`)
    const transitions: any[] = data.transitions ?? []

    const targetName = action === 'approve' ? 'Ready for Dev' : 'In Refinement'
    const transition = transitions.find(t =>
      t.name.toLowerCase().includes(targetName.toLowerCase())
    )

    if (!transition) {
      console.warn(`[JiraAdapter] Transition "${targetName}" not found for ${ticketId}`)
      return
    }

    await this.api.post(`/rest/api/3/issue/${ticketId}/transitions`, {
      transition: { id: transition.id },
    })
  }

  // ─── Parsing helpers ──────────────────────────────────────

  private extractText(description: any): string {
    if (!description) return ''
    if (typeof description === 'string') return description
    // Atlassian Document Format — extract text nodes
    return this.walkADF(description)
  }

  private walkADF(node: any): string {
    if (!node) return ''
    if (node.type === 'text') return node.text ?? ''
    if (node.content) return node.content.map((n: any) => this.walkADF(n)).join('\n')
    return ''
  }

  private extractAC(description: any): string[] {
    const text = this.extractText(description)
    if (!text) return []

    // Find "Acceptance Criteria" section and extract bullet points
    const acMatch = text.match(/acceptance criteria[:\s]*([\s\S]*?)(?:\n##|\n\*\*|$)/i)
    if (!acMatch) return []

    return acMatch[1]
      .split('\n')
      .map(line => line.replace(/^[-*•\d.]+\s*/, '').trim())
      .filter(line => line.length > 10)
  }

  private extractStoryFormat(description: any) {
    const text = this.extractText(description)
    return {
      asA: text.match(/as a[n]?\s+(.+?)(?:\n|,|i want)/i)?.[1]?.trim() ?? null,
      iWant: text.match(/i want\s+(.+?)(?:\n|so that)/i)?.[1]?.trim() ?? null,
      soThat: text.match(/so that\s+(.+?)(?:\n|$)/i)?.[1]?.trim() ?? null,
    }
  }

  private detectDesignLinks(fields: any): boolean {
    const remoteLinks = fields?.remoteLinks ?? []
    const attachments = fields?.attachment ?? []
    return (
      remoteLinks.some((l: any) => /figma|zeplin|sketch|invision/i.test(l.url ?? '')) ||
      attachments.some((a: any) => /\.fig|design|mockup/i.test(a.filename ?? ''))
    )
  }

  private mapIssueType(name: string = ''): TicketType {
    const map: Record<string, TicketType> = {
      story: 'story', 'user story': 'story',
      bug: 'bug', defect: 'bug',
      task: 'task', subtask: 'task',
      epic: 'epic',
    }
    return map[name.toLowerCase()] ?? 'task'
  }

  private mapPriority(name: string = ''): Priority {
    const map: Record<string, Priority> = {
      critical: 'critical', blocker: 'critical',
      high: 'high', major: 'high',
      medium: 'medium', normal: 'medium',
      low: 'low', minor: 'low',
    }
    return map[name.toLowerCase()] ?? 'medium'
  }
}
