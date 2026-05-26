# /regression-impact

You are orchestrating a regression impact analysis using the delivery-intelligence and GitHub MCP servers.

## How to use

/regression-impact SCRUM-5
/regression-impact pr=123 repo=paulchronicles/delivery-intelligence
/regression-impact pr=123 repo=paulchronicles/delivery-intelligence ticket=SCRUM-7

## Step 1 — Get team config

Call delivery-intelligence get_team_config with the project key from the ticket ID.
Extract the test_repo section if present — note the github_owner, github_repo, branch, and spec_patterns.

## Step 2 — Get PR files (if PR provided)

If a PR number and repo are provided:
- Call get_pull_request to get PR title and description
- Call get_pull_request_files to get the list of changed files
- Note the file paths for use in Step 3

## Step 3 — Scan test repo for existing coverage (if test_repo configured)

If test_repo is configured in team config, ALWAYS run this step — even if no PR was provided.

Use the ticket title, description keywords, and change type to search for relevant test files:
- Call search_code with query "[feature keyword] test" in the configured repo
  Example: for a login ticket, search "login" in paulchronicles/ever-ai
- Call search_code with query "[feature keyword] spec" in the configured repo
- For each file found, call get_file_contents to read the test file
- Extract all test/scenario names from the file (describe blocks, test names, scenario titles)
- Map each test name against the ticket's acceptance criteria
- Identify which ACs are covered and which have no matching test

Present findings as:
Test Coverage Check (paulchronicles/ever-ai):
✓ [test name] — covers AC #N
⚠️  AC #N — no test found: "[AC text]"

If search returns no results, say: "No matching test files found in [repo] for this feature area."

## Step 4 — Call map_regression_impact

Pass to delivery-intelligence map_regression_impact:
- ticket_id: the ticket ID
- changed_files: list of changed file paths from PR (if available)
- pr_summary: PR title and description (if available)

## Step 5 — Present complete findings

Show:
1. The full regression impact map
2. The test coverage check results from Step 3

## Rules
- ALWAYS run Step 3 if test_repo is configured — do not skip it just because no PR was provided
- Use search_code to find tests — do not guess or invent test names
- Only report tests that were actually found in the files
- Do not suggest writing tests — that is the test-case-generation agent's job
- Do not approve or block releases
