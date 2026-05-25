# QA Gate Agent — Deployment Guide

This guide covers everything an IT or platform team needs to deploy the QA Gate Agent on organisation infrastructure.

---

## What This Is

An AI-powered requirements quality gate that reviews Jira and Azure DevOps tickets before development starts. It connects to Claude via the MCP protocol, meaning any team member with Claude access can use it immediately after deployment — no additional software required.

---

## Prerequisites

Before starting, confirm you have:

- [ ] Docker or a container platform (ECS, GCP Cloud Run, Azure Container Apps, Kubernetes)
- [ ] A Jira Cloud or Azure DevOps instance with API access
- [ ] An Anthropic API key (console.anthropic.com) — or Azure OpenAI if preferred
- [ ] A domain or internal URL to host the service
- [ ] Optional: Slack webhook URL for notifications

---

## Architecture

```
Claude (claude.ai or Claude Code)
        │
        │  HTTPS — MCP protocol
        ▼
QA Gate Agent Server          (this service)
        │
        ├── Anthropic API     (AI agent calls)
        ├── Jira / ADO API    (fetch tickets, post comments)
        └── Slack API         (optional notifications)
```

The server is a single Node.js process. No database required. Review history is stored in a local JSON file.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | From console.anthropic.com — use a service account key |
| `JIRA_BASE_URL` | Yes* | Your Jira instance URL e.g. `https://yourorg.atlassian.net` |
| `JIRA_BOT_EMAIL` | Yes* | Email of the service account Jira user |
| `JIRA_API_TOKEN` | Yes* | Jira API token for the service account |
| `ADO_BASE_URL` | Yes* | ADO URL e.g. `https://dev.azure.com/yourorg` |
| `ADO_PAT` | Yes* | Azure DevOps Personal Access Token |
| `ADO_PROJECT` | Yes* | ADO project name |
| `SLACK_WEBHOOK_URL` | No | Slack incoming webhook for sprint notifications |
| `DEFAULT_QA_LEAD` | No | Default QA lead email if team config not found |
| `TIMEOUT_FALLBACK` | No | `block` or `allow` if agent times out. Default: `block` |
| `PORT` | No | Server port. Default: `3000` |
| `NODE_ENV` | No | Set to `production` |

*Either Jira OR ADO variables are required depending on your platform. Both can be configured if you use both.

---

## Jira Service Account Setup

Create a dedicated service account in Jira for the agent — do not use a personal account.

1. Create a Jira user: `qa-gate-agent@yourorg.com`
2. Grant it project-level permissions:
   - Browse Projects
   - Add Comments
   - Transition Issues
3. Generate an API token at `id.atlassian.com` for this account
4. Set `JIRA_BOT_EMAIL` and `JIRA_API_TOKEN` to this account's credentials

---

## ADO Service Account Setup

1. Create a service account in your Azure AD
2. Add it to the ADO project with **Contributor** role
3. Generate a Personal Access Token with scopes:
   - Work Items: Read & Write
   - Project and Team: Read
4. Set `ADO_PAT` to this token

---

## Deployment Options

### Option A — Docker (Recommended)

```bash
docker build -t qa-gate-agent .

docker run -d \
  --name qa-gate-agent \
  --restart unless-stopped \
  -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e JIRA_BASE_URL=https://yourorg.atlassian.net \
  -e JIRA_BOT_EMAIL=qa-gate-agent@yourorg.com \
  -e JIRA_API_TOKEN=your-token \
  -e NODE_ENV=production \
  -v qa-gate-data:/app/data \
  qa-gate-agent
```

The `-v qa-gate-data:/app/data` mount persists review history across container restarts.

---

### Option B — GCP Cloud Run

```bash
gcloud builds submit --tag gcr.io/YOUR_PROJECT/qa-gate-agent

gcloud run deploy qa-gate-agent \
  --image gcr.io/YOUR_PROJECT/qa-gate-agent \
  --platform managed \
  --region europe-west2 \
  --allow-unauthenticated \
  --set-env-vars ANTHROPIC_API_KEY=sk-ant-...,JIRA_BASE_URL=https://yourorg.atlassian.net
```

---

### Option C — AWS ECS

Use the provided Dockerfile to build and push to ECR, then create an ECS service with the environment variables set via AWS Secrets Manager.

Recommended: store all credentials in Secrets Manager and inject at runtime rather than setting them as plain environment variables.

---

### Option D — Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: qa-gate-agent
spec:
  replicas: 1
  selector:
    matchLabels:
      app: qa-gate-agent
  template:
    metadata:
      labels:
        app: qa-gate-agent
    spec:
      containers:
      - name: qa-gate-agent
        image: your-registry/qa-gate-agent:latest
        ports:
        - containerPort: 3000
        envFrom:
        - secretRef:
            name: qa-gate-secrets
        volumeMounts:
        - name: data
          mountPath: /app/data
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: qa-gate-data-pvc
```

---

## Verifying the Deployment

Once deployed, check the health endpoint:

```bash
curl https://your-deployment-url/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "qa-gate-agent",
  "version": "1.0.0",
  "timestamp": "2026-05-23T..."
}
```

Test the MCP endpoint:
```bash
curl -X POST https://your-deployment-url/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}'
```

Expected: a JSON response containing `"serverInfo":{"name":"qa-gate-agent"}`

---

## Team Configuration

Each team needs a YAML config file in `config/teams/`. The file name must match the Jira/ADO project key in lowercase.

Example for project key `PAY`:

```yaml
# config/teams/pay.yaml

team: PAY
project_key: PAY
qa_lead: qa-lead@yourorg.com
slack_channel: "#qa-payments"
target_transition_state: "Ready for Review"

definition_of_done:
  acceptance_criteria_minimum: 3
  designs_required: true
  non_functional_required: false

compliance_triggers:
  - keyword: "payment"
    requirement: "Must include PCI DSS scope confirmation"
    severity: CRITICAL
  - keyword: "card"
    requirement: "Must include tokenisation AC — never store raw card numbers"
    severity: BLOCKER
  - keyword: "personal data"
    requirement: "Must include GDPR lawful basis and retention period"
    severity: BLOCKER

severity_overrides: {}
```

Copy and customise `config/teams/nomo-payments.yaml` as a starting point for each team.

---

## Connecting Claude Users

### claude.ai (non-developers)

Share this guide with team members:

1. Go to `claude.ai/customize/connectors`
2. Click `+` → **Add custom connector**
3. Name: `QA Gate Agent`
4. URL: `https://your-deployment-url/mcp`
5. Click **Add**

Done. They can now say "review ticket PAY-447" in any claude.ai conversation.

---

### Claude Code (developers)

Developers run this once in their terminal:

```bash
claude mcp add qa-gate --transport http https://your-deployment-url/mcp
```

Then in any Claude Code session:

```
review PAY-447
```

---

## Security Considerations

**Network access:**
The server makes outbound calls to Anthropic API, your Jira/ADO instance, and optionally Slack. No inbound calls beyond the MCP endpoint.

If running on internal infrastructure, ensure the server can reach:
- `api.anthropic.com` (or your Azure OpenAI endpoint)
- Your Jira/ADO instance
- `hooks.slack.com` (if using Slack notifications)

**Authentication:**
The current version uses an open MCP endpoint — anyone with the URL can call it. For internal deployments behind a VPN this is acceptable. For internet-facing deployments, add network-level access controls or contact the development team to implement SSO authentication.

**Credentials:**
- Never commit credentials to the repository
- Use your platform's secret management (AWS Secrets Manager, Azure Key Vault, GCP Secret Manager, Kubernetes Secrets)
- Rotate the Anthropic API key and Jira/ADO tokens quarterly

**Data:**
The agent reads ticket content from Jira/ADO and sends it to Anthropic's API for analysis. Review your organisation's data classification policy to confirm this is acceptable for your ticket content.

Review history is stored locally in `/app/data/review-history.json`. This contains ticket IDs, concern summaries, and review timestamps — no full ticket content.

---

## Cost Estimation

| Usage | Estimated Cost |
|---|---|
| Single ticket review | ~£0.02–0.05 |
| Sprint review (10 tickets) | ~£0.20–0.50 |
| Team of 5, 2-week sprint | ~£2–5 per sprint |
| Organisation of 50, 2-week sprints | ~£20–50 per sprint |

Costs vary based on ticket complexity and concern count. Monitor usage at `console.anthropic.com`.

---

## Updating

The agent auto-deploys from the GitHub repository on every push to `main`. To update:

```bash
git pull origin main
docker build -t qa-gate-agent .
docker restart qa-gate-agent
```

Or if using a CI/CD pipeline, push to `main` and it deploys automatically.

---

## Support

For issues, configuration questions, or feature requests contact the QA tooling team or raise a ticket in the internal tooling backlog.

For Anthropic API issues: `status.anthropic.com`
For Jira API issues: `status.atlassian.com`

