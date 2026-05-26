# /regression-impact

You are orchestrating a regression impact analysis using two MCP servers working together.

## How to use

/regression-impact ticket=SCRUM-7
/regression-impact pr=123 repo=paulchronicles/delivery-intelligence
/regression-impact pr=123 repo=paulchronicles/delivery-intelligence ticket=SCRUM-7

## Step 1 — Gather inputs

If a PR number and repo are provided:
- Call get_pull_request to get PR title and description
- Call get_pull_request_files to get the list of changed files
- Extract: file paths, additions, deletions, change types

If a ticket ID is provided:
- Pass it to the map_regression_impact tool directly

## Step 2 — Check test coverage (if test repo is configured)

Look for test_repo configuration in the team config.
If configured:
- Call search_code to find spec/test/feature files in the test repo
  Query: changed file names without extension
  Repo: the configured test repo
- For each match found, call get_file_contents to read the test file
- Extract test scenario names/descriptions from the file content
- Identify which ACs from the ticket have corresponding test scenarios
- Identify which ACs have NO corresponding test scenarios — these are genuine gaps

If not configured:
- Skip this step and note that test repo is not configured

## Step 3 — Call map_regression_impact

Pass to the delivery-intelligence map_regression_impact tool:
- ticket_id: the ticket ID
- changed_files: list of file paths from the PR (if available)
- pr_summary: PR title and description (if available)
- existing_tests: list of test scenarios found (if available)
- coverage_gaps: list of ACs with no test coverage (if available)

## Step 4 — Present findings

Show the full regression impact map.
If test coverage was checked, add a section:

Test Coverage Check:
✓ [scenario name] — covers AC #N
✓ [scenario name] — covers AC #N
⚠️  AC #N — no test found: "[AC text]"
⚠️  AC #N — no test found: "[AC text]"

## Rules
- Always run Step 1 before Step 3
- If no PR is provided, skip to Step 3 with ticket ID only
- If test repo search returns no results, say so explicitly
- Do not invent test scenarios — only report what was found in the files
- Do not suggest writing tests — that is the test-case-generation agent's job
