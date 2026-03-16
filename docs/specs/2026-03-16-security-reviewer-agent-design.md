# Security Reviewer Agent (Agent #3) — Design Spec

**Date:** 2026-03-16
**Status:** Draft
**Depends on:** Phase 1.1 (aegis CLI wrapper — complete)

## Overview

Add a Security Reviewer as the third agent in the AEGIS build workflow. After the Builder finishes implementing code, the Security Reviewer reads all files and writes a structured SECURITY-REVIEW.md. If critical issues are found, the Builder is re-invoked to fix them, and the Security Reviewer re-checks. Max 2 fix rounds.

## Workflow

```
Architect → Builder → Security Review → [Fix Loop if needed]

Phase 1: Architect     → writes SPEC.md
Phase 2: Builder       → implements code from spec
Phase 3: Security      → reviews code, writes SECURITY-REVIEW.md
Phase 4: Builder (fix) → fixes issues from review (only if Status: FAIL)
Phase 5: Security      → re-reviews (only if Phase 4 ran)
  ... max 2 fix rounds, then complete with warning
```

## Agent Configuration

### SOUL.md for Security Reviewer

Stored at `~/.openclaw/agents/security/agent/SOUL.md`:

```markdown
You are the Security Reviewer Agent — a senior application security engineer.

## Your Strengths

- OWASP Top 10 vulnerability detection
- Code review for injection flaws (SQL, XSS, CSRF, command injection)
- Authentication and authorization analysis
- Secrets and credential exposure detection
- Dependency and supply chain risk assessment
- Input validation and output encoding review

## How You Work

1. Read ALL code files in the current directory
2. Analyze each file for security vulnerabilities
3. Write SECURITY-REVIEW.md with your findings using the exact format below
4. Be specific: include file name, line number, vulnerability type, and severity

## SECURITY-REVIEW.md Format (you MUST follow this exactly)

# Security Review

## Critical

- [VULN_TYPE] file.py:LINE — Description of the critical vulnerability

## Warning

- [VULN_TYPE] file.py:LINE — Description of the warning

## Info

- [VULN_TYPE] file.py:LINE — Informational security note

## Status: PASS

Use "## Status: FAIL" if there are any Critical findings.
Use "## Status: PASS" if there are no Critical findings (Warnings and Info are acceptable).

## Rules

- ONLY flag real, exploitable vulnerabilities — not theoretical concerns
- Always include the file path and line number
- Always categorize as Critical, Warning, or Info
- Critical = exploitable vulnerability (injection, auth bypass, secrets in code)
- Warning = security best practice violation (missing rate limit, weak hashing)
- Info = suggestion for improvement (adding CSP headers, etc.)
- The Status line MUST be the last section in the file
- If no issues found at all, write Status: PASS with a note saying "No issues found"
```

### openclaw.json entry

Add to `agents.list[]`:

```json
{
  "id": "security",
  "name": "security",
  "workspace": "/home/habbaba/.openclaw/workspace",
  "agentDir": "/home/habbaba/.openclaw/agents/security/agent",
  "model": "custom-localhost-8317/supervisor-model"
}
```

## SECURITY-REVIEW.md Format

The Security Reviewer writes this file to the build workspace. The protocol parses it to determine whether to trigger the fix loop.

Example — issues found:

```markdown
# Security Review

## Critical

- [SQL_INJECTION] server.py:23 — User input from request.args["id"] passed directly to f-string SQL query. Use parameterized queries.
- [HARDCODED_SECRET] config.py:5 — API key "sk-live-abc123" hardcoded in source. Use environment variables.

## Warning

- [MISSING_RATE_LIMIT] server.py:45 — No rate limiting on /api/login endpoint. Vulnerable to brute force.
- [WEAK_HASH] auth.py:12 — Using MD5 for password hashing. Use bcrypt or argon2.

## Info

- [NO_CSP] index.html:1 — No Content-Security-Policy header. Consider adding CSP.

## Status: FAIL
```

Example — clean:

```markdown
# Security Review

## Critical

## Warning

## Info

- [SUGGESTION] server.py:1 — Consider adding request logging for audit purposes.

## Status: PASS
```

### Parsing logic

The protocol reads SECURITY-REVIEW.md and checks for the line `## Status: FAIL` or `## Status: PASS`. If the file is missing or unparseable, treat as PASS (don't block the build on reviewer failure).

To extract issue counts:

- Count lines starting with `- [` under each section header (Critical, Warning, Info)
- These counts go into the audit trail and terminal output

## Protocol Changes

### Modified SequentialProtocol

The existing `SequentialProtocol` in `src/aegis/coordinator/sequential.ts` is extended with two new phases. The `agents` array becomes `["architect", "main", "security"]`.

#### Phase 3: Security Review

After Builder completes:

1. Yield `phase_start` for `security`
2. Call `runAgent({ agentId: "security", message: securityReviewPrompt(), extraSystemPrompt: workspaceSystemPrompt })`
3. Yield `agent_response` with reviewer output
4. Parse SECURITY-REVIEW.md for status
5. If PASS: yield `phase_end`, done
6. If FAIL: proceed to fix loop

#### Security Review Prompt

```
Review all code files in the current directory for security vulnerabilities.
Write your findings to SECURITY-REVIEW.md using your standard format.
Be thorough but only flag real, exploitable issues.
```

#### Fix Loop (Phases 4-5, conditional)

If `Status: FAIL`:

1. Read SECURITY-REVIEW.md content
2. Yield `phase_start` for `main` (fix round)
3. Call `runAgent({ agentId: "main", message: fixPrompt(reviewContent), extraSystemPrompt: workspaceSystemPrompt })`
4. Yield `agent_response` with builder fix output
5. Yield `phase_end` for `main`
6. Delete old SECURITY-REVIEW.md
7. Yield `phase_start` for `security` (re-review)
8. Call `runAgent({ agentId: "security", message: securityReviewPrompt(), extraSystemPrompt: workspaceSystemPrompt })`
9. Yield `agent_response` with re-review output
10. Parse new SECURITY-REVIEW.md
11. If PASS or max rounds reached: yield `phase_end`, done

#### Fix Prompt

```
Read SECURITY-REVIEW.md in the current directory. It contains security vulnerabilities found in your code.
Fix ALL Critical issues. Fix Warning issues where practical.
Do NOT delete or modify SECURITY-REVIEW.md — only fix the code files.
After fixing, briefly describe what you changed.
```

#### Max Rounds

Max 2 fix rounds (configurable). If still FAIL after 2 rounds, the build completes with a warning:

```
  Build complete with security warnings!
  Security: 1 critical issue remaining after 2 fix rounds
```

The build does NOT fail — it completes with exit code 0 but shows the warning. The audit trail records the remaining issues.

## Terminal UI Changes

### New agent label

Add to `agentLabels` in `src/aegis/ui/terminal.ts`:

```typescript
security: "Security",
```

### Build result security summary

`printBuildResult` gets new optional fields:

```typescript
securitySummary?: {
  criticalFound: number;
  criticalFixed: number;
  warningCount: number;
  fixRounds: number;
  status: "pass" | "fail" | "skipped";
};
```

Rendered as:

```
  Security: 2 critical found, 2 fixed (0 remaining) — PASS
```

Or if issues remain:

```
  Security: 3 critical found, 1 fixed (2 remaining) — WARNING
```

## Audit Trail Changes

The `AuditEntry` in `src/aegis/security/audit.ts` gains optional security fields in each phase entry. No type changes needed — the existing `AuditPhase.status` field can carry "success", "error", or "security-fail". The `AuditEntry.result` can be "success", "error", or "success-with-warnings".

Additionally, the build command passes security summary data through the existing `filesCreated` field (SECURITY-REVIEW.md will appear in the file list naturally).

## Files Changed

| File                                        | Change                                               |
| ------------------------------------------- | ---------------------------------------------------- |
| `src/aegis/coordinator/sequential.ts`       | Add phases 3-5 (security review + fix loop)          |
| `src/aegis/coordinator/sequential.test.ts`  | Add tests for security review flow                   |
| `src/aegis/ui/terminal.ts`                  | Add security agent label, security summary in result |
| `src/aegis/commands/build.ts`               | Pass security summary to printBuildResult            |
| `~/.openclaw/agents/security/agent/SOUL.md` | Create security agent SOUL.md                        |
| `~/.openclaw/openclaw.json`                 | Add security agent to agents.list                    |

## Files NOT Changed

| File                             | Reason                                          |
| -------------------------------- | ----------------------------------------------- |
| `src/aegis/coordinator/types.ts` | Protocol interface unchanged — just more events |
| `src/aegis/gateway/client.ts`    | runAgent works for any agent                    |
| `src/aegis/cli.ts`               | No new commands needed                          |
| `src/aegis/security/audit.ts`    | Types are flexible enough already               |
| `src/aegis/security/lock.ts`     | No change                                       |

## New Helper: parseSecurityReview()

A utility function extracted for testability:

```typescript
interface SecurityReviewResult {
  status: "pass" | "fail" | "unknown";
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  content: string;
}

function parseSecurityReview(workspacePath: string): SecurityReviewResult;
```

- Reads `SECURITY-REVIEW.md` from workspace
- Parses `## Status: PASS/FAIL` line
- Counts `- [` lines under each section
- Returns structured result
- If file missing or unparseable: returns `{ status: "unknown", criticalCount: 0, ... }`

## Success Criteria

1. `aegis build "Build a REST API with user login"` runs 3 agents: Architect, Builder, Security Reviewer
2. Security Reviewer produces SECURITY-REVIEW.md with structured findings
3. If Critical issues found, Builder is re-invoked to fix them
4. Security Reviewer re-checks after fixes (max 2 rounds)
5. Terminal output shows security summary with issue counts
6. Audit trail records security review results
7. Existing 2-agent builds still work (security agent is the third agent in the same protocol)
8. All existing tests continue to pass
