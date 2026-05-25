# Delivery Intelligence Platform

AI-native delivery intelligence for engineering teams. Built on the Model Context Protocol — accessible from Claude Code and Claude.ai.

---

## Agents

| Agent | Description | Status |
|---|---|---|
| `requirement-gap` | Reviews tickets for clarity, testability, completeness, and compliance | ✅ Active |
| `test-case-generation` | Generates BDD scenarios, structured test tables, or Playwright code from tickets | ✅ Active |
| `release-readiness` | Pre-release risk assessment | 🔜 Planned |
| `defect-triage` | Classify, prioritise, and route defects | 🔜 Planned |
| `api-test-generation` | Generate API tests from specs | 🔜 Planned |
| `ui-test-generation` | Generate UI tests from designs | 🔜 Planned |

---

## Adding a New Agent

1. Create `agents/your-agent/index.ts` exporting a `DeliveryAgent`
2. Add config YAML to `agents/your-agent/config/`
3. Register in `mcp-server.ts` — two lines:

```typescript
import { yourAgent } from './agents/your-agent/index'
registerAgent(yourAgent)
```

No other changes needed. The agent's tools are automatically available to Claude.

---

## Setup

```bash
npm install
npm run build
```

Connect to Claude Code:
```bash
claude mcp add delivery-intelligence \
  --transport http \
  https://your-deployment-url/mcp
```

See `DEPLOYMENT.md` for full infrastructure options.

---

## Example Commands

```
review SCRUM-7
generate test cases for PAY-447
generate Playwright tests for SCRUM-5
review the next sprint for SCRUM
post all verdicts for PAY
rewrite SCRUM-6 based on the review
```
