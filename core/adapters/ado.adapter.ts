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

export class ADOAdapter implements PlatformAdapter {
  platform = 'ado' as const

  private api = axios.create({
    baseURL: process.env.ADO_BASE_URL,  // e.g. https://dev.azure.com/yourorg
    auth: {
      username: '',
      password: process.env.ADO_PAT!,  // Personal Access Token
    },
    headers: { 'Content-Type': 'application/json' },
  })

  // ─── Inbound ─────────────────────────────────────────────

  parseWebhook(payload: any): NormalisedTicket | null {
    const { resource, eventType } = payload

    // ADO fires workitem.updated for state changes
    if (eventType !== 'workitem.updated') return null

    const fields = resource?.fields ?? {}
    const stateChange = fields['System.State']

    // Only process if the state field actually changed
    if (!stateChange?.newValue) return null

    const projectName = fields['System.TeamProject'] ?? resource?.revision?.fields?.['System.TeamProject']

    return {
      id: String(resource.id),
      platform: 'ado',
      url: resource._links?.html?.href ?? '',
      title: this.getField(fields, 'System.Title'),
      description: this.getField(fields, 'System.Description'),
      acceptanceCriteria: this.extractAC(
        this.getField(fields, 'Microsoft.VSTS.Common.AcceptanceCriteria')
      ),
      storyFormat: this.extractStoryFormat(
        this.getField(fields, 'System.Description')
      ),
      type: this.mapWorkItemType(
        this.getField(fields, 'System.WorkItemType')
      ),
      priority: this.mapPriority(
        fields['Microsoft.VSTS.Common.Priority']?.newValue
      ),
      labels: this.parseTags(
        this.getField(fields, 'System.Tags')
      ),
      linkedTickets: [],  // ADO relations fetched separately via fetchTicket
      hasDesigns: false,  // checked via attachments in fetchTicket
      assignee: fields['System.AssignedTo']?.newValue?.uniqueName ?? null,
      team: projectName ?? '',
      fromState: stateChange.oldValue ?? '',
      toState: stateChange.newValue,
      triggeredBy: resource.revisedBy?.uniqueName ?? 'unknown',
      triggeredAt: resource.revisedDate ?? new Date().toISOString(),
    }
  }

  verifySignature(headers: Record<string, string>, rawBody: string): boolean {
    // ADO supports basic auth on webhooks — verify shared secret
    const authHeader = headers['authorization']
    if (!authHeader) return false

    const expectedToken = Buffer.from(
      `:${process.env.ADO_WEBHOOK_SECRET}`
    ).toString('base64')

    return authHeader === `Basic ${expectedToken}`
  }

  async fetchTicket(id: string): Promise<NormalisedTicket> {
    const project = process.env.ADO_PROJECT
    const { data } = await this.api.get(
      `/${project}/_apis/wit/workitems/${id}?$expand=relations&api-version=7.0`
    )

    const fields = data.fields ?? {}
    const relations = data.relations ?? []

    // Extract linked work item IDs
    const linkedTickets = relations
      .filter((r: any) => r.rel === 'System.LinkTypes.Hierarchy-Forward' ||
                          r.rel === 'System.LinkTypes.Related')
      .map((r: any) => {
        const parts = r.url?.split('/')
        return parts?.[parts.length - 1]
      })
      .filter(Boolean)

    // Check for design attachments
    const hasDesigns = relations.some((r: any) =>
      r.rel === 'AttachedFile' &&
      /figma|design|mockup|\.fig/i.test(r.attributes?.name ?? '')
    )

    return {
      id: String(data.id),
      platform: 'ado',
      url: data._links?.html?.href ?? '',
      title: fields['System.Title'] ?? '',
      description: fields['System.Description'] ?? '',
      acceptanceCriteria: this.extractAC(
        fields['Microsoft.VSTS.Common.AcceptanceCriteria'] ?? ''
      ),
      storyFormat: this.extractStoryFormat(fields['System.Description'] ?? ''),
      type: this.mapWorkItemType(fields['System.WorkItemType']),
      priority: this.mapPriority(fields['Microsoft.VSTS.Common.Priority']),
      labels: this.parseTags(fields['System.Tags']),
      linkedTickets,
      hasDesigns,
      assignee: fields['System.AssignedTo']?.uniqueName ?? null,
      team: fields['System.TeamProject'] ?? '',
      fromState: '',
      toState: fields['System.State'] ?? '',
      triggeredBy: fields['System.ChangedBy']?.uniqueName ?? 'unknown',
      triggeredAt: fields['System.ChangedDate'] ?? new Date().toISOString(),
    }
  }

  // ─── Outbound ─────────────────────────────────────────────

  async postComment(ticketId: string, verdict: FinalVerdict): Promise<void> {
    const project = process.env.ADO_PROJECT
    const body = formatVerdictAsText(verdict)

    await this.api.post(
      `/${project}/_apis/wit/workItems/${ticketId}/comments?api-version=7.0-preview.3`,
      { text: `<pre>${body}</pre>` }
    )
  }

  async updateStatus(ticketId: string, action: 'approve' | 'reject'): Promise<void> {
    const project = process.env.ADO_PROJECT
    const newState = action === 'approve' ? 'Ready for Dev' : 'In Refinement'

    await this.api.patch(
      `/${project}/_apis/wit/workItems/${ticketId}?api-version=7.0`,
      [{ op: 'replace', path: '/fields/System.State', value: newState }],
      { headers: { 'Content-Type': 'application/json-patch+json' } }
    )
  }

  // ─── Parsing helpers ──────────────────────────────────────

  // ADO fields can be { newValue, oldValue } or direct values depending on context
  private getField(fields: any, key: string): string {
    const val = fields[key]
    if (!val) return ''
    if (typeof val === 'string') return val
    if (typeof val === 'object' && 'newValue' in val) return val.newValue ?? ''
    return String(val)
  }

  private extractAC(text: string): string[] {
    if (!text) return []
    // ADO AC field is often HTML — strip tags first
    const stripped = text.replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ')
    return stripped
      .split('\n')
      .map(line => line.replace(/^[-*•\d.]+\s*/, '').trim())
      .filter(line => line.length > 10)
  }

  private extractStoryFormat(description: string) {
    const text = description?.replace(/<[^>]+>/g, ' ') ?? ''
    return {
      asA: text.match(/as a[n]?\s+(.+?)(?:\n|,|i want)/i)?.[1]?.trim() ?? null,
      iWant: text.match(/i want\s+(.+?)(?:\n|so that)/i)?.[1]?.trim() ?? null,
      soThat: text.match(/so that\s+(.+?)(?:\n|$)/i)?.[1]?.trim() ?? null,
    }
  }

  private mapWorkItemType(name: string = ''): TicketType {
    const map: Record<string, TicketType> = {
      'user story': 'story', story: 'story',
      bug: 'bug',
      task: 'task',
      epic: 'epic', feature: 'epic',
    }
    return map[name.toLowerCase()] ?? 'task'
  }

  private mapPriority(value: any): Priority {
    const map: Record<number, Priority> = { 1: 'critical', 2: 'high', 3: 'medium', 4: 'low' }
    return map[Number(value)] ?? 'medium'
  }

  private parseTags(tags: string = ''): string[] {
    return tags.split(';').map(t => t.trim()).filter(Boolean)
  }
}
