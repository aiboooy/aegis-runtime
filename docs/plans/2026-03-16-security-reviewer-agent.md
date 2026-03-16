# Security Reviewer Agent Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Security Reviewer as the third agent in the AEGIS build workflow, with a fix loop that re-invokes the Builder to fix critical vulnerabilities.

**Architecture:** Extend the existing SequentialProtocol with phases 3-5 (security review + conditional fix loop). Add a `parseSecurityReview()` utility for testability. Create the security agent config. Update terminal UI and build command for security summary.

**Tech Stack:** TypeScript, Vitest, existing AEGIS coordinator and gateway infrastructure

**Spec:** `docs/specs/2026-03-16-security-reviewer-agent-design.md`

---

## File Map

| File                                            | Change | Responsibility                        |
| ----------------------------------------------- | ------ | ------------------------------------- |
| `src/aegis/coordinator/security-review.ts`      | Create | parseSecurityReview() utility         |
| `src/aegis/coordinator/security-review.test.ts` | Create | Tests for parser                      |
| `src/aegis/coordinator/sequential.ts`           | Modify | Add security review + fix loop phases |
| `src/aegis/coordinator/sequential.test.ts`      | Modify | Add tests for 3-agent flow            |
| `src/aegis/ui/terminal.ts`                      | Modify | Add security label + summary display  |
| `src/aegis/commands/build.ts`                   | Modify | Track security summary, pass to UI    |

**Agent config (outside repo, runtime setup):**
| Path | Change |
|------|--------|
| `~/.openclaw/agents/security/agent/SOUL.md` | Create |
| `~/.openclaw/openclaw.json` | Modify (add security to agents.list) |

---

## Chunk 1: Parser + Protocol (Tasks 1-3)

### Task 1: Security Review Parser

**Files:**

- Create: `src/aegis/coordinator/security-review.ts`
- Create: `src/aegis/coordinator/security-review.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/aegis/coordinator/security-review.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseSecurityReview } from "./security-review.js";

describe("parseSecurityReview", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "aegis-secreview-"));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it("parses FAIL status with critical and warning counts", () => {
    writeFileSync(
      join(workspace, "SECURITY-REVIEW.md"),
      [
        "# Security Review",
        "",
        "## Critical",
        "- [SQL_INJECTION] server.py:23 — User input in SQL query",
        "- [HARDCODED_SECRET] config.py:5 — API key in source",
        "",
        "## Warning",
        "- [MISSING_RATE_LIMIT] server.py:45 — No rate limiting",
        "",
        "## Info",
        "- [NO_CSP] index.html:1 — No CSP header",
        "",
        "## Status: FAIL",
      ].join("\n"),
    );

    const result = parseSecurityReview(workspace);
    expect(result.status).toBe("fail");
    expect(result.criticalCount).toBe(2);
    expect(result.warningCount).toBe(1);
    expect(result.infoCount).toBe(1);
    expect(result.content).toContain("SQL_INJECTION");
  });

  it("parses PASS status", () => {
    writeFileSync(
      join(workspace, "SECURITY-REVIEW.md"),
      [
        "# Security Review",
        "",
        "## Critical",
        "",
        "## Warning",
        "",
        "## Info",
        "- [SUGGESTION] server.py:1 — Consider adding logging",
        "",
        "## Status: PASS",
      ].join("\n"),
    );

    const result = parseSecurityReview(workspace);
    expect(result.status).toBe("pass");
    expect(result.criticalCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.infoCount).toBe(1);
  });

  it("returns unknown when file is missing", () => {
    const result = parseSecurityReview(workspace);
    expect(result.status).toBe("unknown");
    expect(result.criticalCount).toBe(0);
    expect(result.content).toBe("");
  });

  it("returns unknown when file has no status line", () => {
    writeFileSync(join(workspace, "SECURITY-REVIEW.md"), "Some random content without status");

    const result = parseSecurityReview(workspace);
    expect(result.status).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/habbaba/Documents/aegis-runtime
npx vitest run src/aegis/coordinator/security-review.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

Create `src/aegis/coordinator/security-review.ts`:

```typescript
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface SecurityReviewResult {
  status: "pass" | "fail" | "unknown";
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  content: string;
}

function countIssuesInSection(lines: string[], sectionHeader: string): number {
  let inSection = false;
  let count = 0;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      inSection = line.trim() === sectionHeader;
      continue;
    }
    if (inSection && line.startsWith("- [")) {
      count++;
    }
  }
  return count;
}

export function parseSecurityReview(workspacePath: string): SecurityReviewResult {
  const reviewPath = join(workspacePath, "SECURITY-REVIEW.md");

  if (!existsSync(reviewPath)) {
    return { status: "unknown", criticalCount: 0, warningCount: 0, infoCount: 0, content: "" };
  }

  const content = readFileSync(reviewPath, "utf-8");
  const lines = content.split("\n");

  let status: "pass" | "fail" | "unknown" = "unknown";
  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    if (trimmed === "## status: fail") {
      status = "fail";
    } else if (trimmed === "## status: pass") {
      status = "pass";
    }
  }

  return {
    status,
    criticalCount: countIssuesInSection(lines, "## Critical"),
    warningCount: countIssuesInSection(lines, "## Warning"),
    infoCount: countIssuesInSection(lines, "## Info"),
    content,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/aegis/coordinator/security-review.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/aegis/coordinator/security-review.ts src/aegis/coordinator/security-review.test.ts
git commit -m "feat(aegis): add parseSecurityReview() utility"
```

---

### Task 2: Extend SequentialProtocol with Security Review + Fix Loop

**Files:**

- Modify: `src/aegis/coordinator/sequential.ts`
- Modify: `src/aegis/coordinator/sequential.test.ts`

- [ ] **Step 1: Add new tests to sequential.test.ts**

Append these tests to the existing `describe("SequentialProtocol")` block in `src/aegis/coordinator/sequential.test.ts`. The file already has `vi.mock("../gateway/client.js")`, `import { runAgent }`, `workspacePath` setup, and `import { SequentialProtocol }`.

Add these new test cases after the existing 3 tests:

```typescript
it("runs security review after builder and completes on PASS", async () => {
  const mockRunAgent = vi.mocked(runAgent);

  // Architect
  mockRunAgent.mockImplementationOnce(async () => {
    writeFileSync(join(workspacePath, "SPEC.md"), "# Spec");
    return { runId: "r1", status: "completed", text: "Spec.", summary: "" };
  });
  // Builder
  mockRunAgent.mockImplementationOnce(async () => {
    writeFileSync(join(workspacePath, "server.py"), "# safe code");
    return { runId: "r2", status: "completed", text: "Built.", summary: "" };
  });
  // Security reviewer — PASS
  mockRunAgent.mockImplementationOnce(async () => {
    writeFileSync(
      join(workspacePath, "SECURITY-REVIEW.md"),
      "# Security Review\n\n## Critical\n\n## Warning\n\n## Info\n\n## Status: PASS\n",
    );
    return { runId: "r3", status: "completed", text: "No issues.", summary: "" };
  });

  const protocol = new SequentialProtocol();
  const events: AgentEvent[] = [];
  for await (const event of protocol.execute({
    prompt: "Build",
    buildId: "test-sec-pass",
    workspacePath,
  })) {
    events.push(event);
  }

  const types = events.map((e) => `${e.type}:${e.agent}`);
  expect(types).toEqual([
    "phase_start:architect",
    "agent_response:architect",
    "phase_end:architect",
    "phase_start:main",
    "agent_response:main",
    "phase_end:main",
    "phase_start:security",
    "agent_response:security",
    "phase_end:security",
  ]);

  expect(mockRunAgent).toHaveBeenCalledTimes(3);
  expect(mockRunAgent.mock.calls[2][0].agentId).toBe("security");
});

it("triggers fix loop when security review returns FAIL", async () => {
  const mockRunAgent = vi.mocked(runAgent);

  // Architect
  mockRunAgent.mockImplementationOnce(async () => {
    writeFileSync(join(workspacePath, "SPEC.md"), "# Spec");
    return { runId: "r1", status: "completed", text: "Spec.", summary: "" };
  });
  // Builder (initial)
  mockRunAgent.mockImplementationOnce(async () => {
    writeFileSync(join(workspacePath, "server.py"), "# has vuln");
    return { runId: "r2", status: "completed", text: "Built.", summary: "" };
  });
  // Security reviewer — FAIL
  mockRunAgent.mockImplementationOnce(async () => {
    writeFileSync(
      join(workspacePath, "SECURITY-REVIEW.md"),
      "# Security Review\n\n## Critical\n- [SQL_INJECTION] server.py:1 — vuln\n\n## Warning\n\n## Info\n\n## Status: FAIL\n",
    );
    return { runId: "r3", status: "completed", text: "Found 1 issue.", summary: "" };
  });
  // Builder (fix round)
  mockRunAgent.mockImplementationOnce(async () => {
    writeFileSync(join(workspacePath, "server.py"), "# fixed");
    return { runId: "r4", status: "completed", text: "Fixed.", summary: "" };
  });
  // Security reviewer — PASS after fix
  mockRunAgent.mockImplementationOnce(async () => {
    writeFileSync(
      join(workspacePath, "SECURITY-REVIEW.md"),
      "# Security Review\n\n## Critical\n\n## Warning\n\n## Info\n\n## Status: PASS\n",
    );
    return { runId: "r5", status: "completed", text: "Clean.", summary: "" };
  });

  const protocol = new SequentialProtocol();
  const events: AgentEvent[] = [];
  for await (const event of protocol.execute({
    prompt: "Build",
    buildId: "test-sec-fix",
    workspacePath,
  })) {
    events.push(event);
  }

  const types = events.map((e) => `${e.type}:${e.agent}`);
  expect(types).toEqual([
    "phase_start:architect",
    "agent_response:architect",
    "phase_end:architect",
    "phase_start:main",
    "agent_response:main",
    "phase_end:main",
    "phase_start:security",
    "agent_response:security",
    "phase_end:security",
    "phase_start:main", // fix round
    "agent_response:main",
    "phase_end:main",
    "phase_start:security", // re-review
    "agent_response:security",
    "phase_end:security",
  ]);

  expect(mockRunAgent).toHaveBeenCalledTimes(5);
  // Verify fix prompt references the review
  expect(mockRunAgent.mock.calls[3][0].message).toContain("SECURITY-REVIEW.md");
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

```bash
npx vitest run src/aegis/coordinator/sequential.test.ts
```

Expected: The 3 existing tests still pass. The 2 new tests FAIL because the protocol only runs 2 agents, not 3.

- [ ] **Step 3: Update SequentialProtocol**

Replace the entire content of `src/aegis/coordinator/sequential.ts` with:

```typescript
import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { runAgent } from "../gateway/client.js";
import { parseSecurityReview, type SecurityReviewResult } from "./security-review.js";
import type { AgentEvent, BuildOpts, Protocol } from "./types.js";

const MAX_FIX_ROUNDS = 2;

function now(): string {
  return new Date().toISOString();
}

function listFilesRecursive(dir: string, base?: string): string[] {
  const root = base ?? dir;
  const files: string[] = [];
  if (!existsSync(dir)) return files;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath, root));
    } else {
      files.push(relative(root, fullPath));
    }
  }
  return files;
}

function buildArchitectPrompt(userPrompt: string): string {
  return [
    "Design a system for the following request:",
    "",
    userPrompt,
    "",
    "Write a detailed SPEC.md to the current directory with:",
    "- Exact API endpoints, URLs, request/response formats",
    "- Database schema (CREATE TABLE statements) if needed",
    "- Frontend layout with sections and data sources",
    "- External API URLs with example responses",
    "- Technology choices and dependencies",
  ].join("\n");
}

function buildBuilderPrompt(): string {
  return [
    "Read SPEC.md in the current directory and implement everything exactly as specified.",
    "",
    "Write all code files. Run and test the code. Fix any errors before finishing.",
    "Use Tailwind CSS via CDN for frontends. Use FastAPI for Python backends.",
    "Include error handling and run your code before saying done.",
  ].join("\n");
}

function buildSecurityReviewPrompt(): string {
  return [
    "Review all code files in the current directory for security vulnerabilities.",
    "Write your findings to SECURITY-REVIEW.md using your standard format.",
    "Be thorough but only flag real, exploitable issues.",
  ].join("\n");
}

function buildFixPrompt(reviewContent: string): string {
  return [
    "Read SECURITY-REVIEW.md in the current directory. It contains security vulnerabilities found in your code.",
    "",
    "Fix ALL Critical issues. Fix Warning issues where practical.",
    "Do NOT delete or modify SECURITY-REVIEW.md — only fix the code files.",
    "After fixing, briefly describe what you changed.",
    "",
    "Here are the findings:",
    "",
    reviewContent,
  ].join("\n");
}

function workspaceSystemPrompt(workspacePath: string): string {
  return `IMPORTANT: Work exclusively in the directory: ${workspacePath}\nCreate all files there. Do not use any other directory.`;
}

async function* runPhase(
  agentId: string,
  message: string,
  workspacePath: string,
  timeoutSeconds?: number,
): AsyncGenerator<AgentEvent> {
  yield { type: "phase_start", agent: agentId, data: {}, timestamp: now() };

  let result;
  try {
    result = await runAgent({
      agentId,
      message,
      extraSystemPrompt: workspaceSystemPrompt(workspacePath),
      timeoutSeconds,
    });
  } catch (err) {
    yield {
      type: "error",
      agent: agentId,
      data: { error: err instanceof Error ? err.message : String(err) },
      timestamp: now(),
    };
    return;
  }

  const filesCreated = agentId === "main" ? listFilesRecursive(workspacePath) : undefined;

  yield {
    type: "agent_response",
    agent: agentId,
    data: { text: result.text, filesCreated },
    timestamp: now(),
  };

  yield { type: "phase_end", agent: agentId, data: {}, timestamp: now() };
}

export class SequentialProtocol implements Protocol {
  name = "sequential";
  agents = ["architect", "main", "security"];

  async *execute(opts: BuildOpts): AsyncGenerator<AgentEvent> {
    // Phase 1: Architect
    let hadError = false;
    for await (const event of runPhase(
      "architect",
      buildArchitectPrompt(opts.prompt),
      opts.workspacePath,
      opts.timeoutSeconds,
    )) {
      yield event;
      if (event.type === "error") {
        hadError = true;
      }
    }
    if (hadError) return;

    // Verify SPEC.md
    const specPath = join(opts.workspacePath, "SPEC.md");
    if (!existsSync(specPath)) {
      yield {
        type: "error",
        agent: "architect",
        data: { error: "Architect did not produce SPEC.md in the workspace" },
        timestamp: now(),
      };
      return;
    }

    // Phase 2: Builder
    for await (const event of runPhase(
      "main",
      buildBuilderPrompt(),
      opts.workspacePath,
      opts.timeoutSeconds,
    )) {
      yield event;
      if (event.type === "error") {
        hadError = true;
      }
    }
    if (hadError) return;

    // Phase 3: Security Review
    for await (const event of runPhase(
      "security",
      buildSecurityReviewPrompt(),
      opts.workspacePath,
      opts.timeoutSeconds,
    )) {
      yield event;
      if (event.type === "error") {
        hadError = true;
      }
    }
    if (hadError) return;

    // Fix loop (if security review failed)
    let review = parseSecurityReview(opts.workspacePath);
    let fixRound = 0;

    while (review.status === "fail" && fixRound < MAX_FIX_ROUNDS) {
      fixRound++;

      // Delete old review so builder doesn't get confused
      const reviewPath = join(opts.workspacePath, "SECURITY-REVIEW.md");
      if (existsSync(reviewPath)) {
        unlinkSync(reviewPath);
      }

      // Builder fix round
      for await (const event of runPhase(
        "main",
        buildFixPrompt(review.content),
        opts.workspacePath,
        opts.timeoutSeconds,
      )) {
        yield event;
        if (event.type === "error") {
          hadError = true;
        }
      }
      if (hadError) return;

      // Security re-review
      for await (const event of runPhase(
        "security",
        buildSecurityReviewPrompt(),
        opts.workspacePath,
        opts.timeoutSeconds,
      )) {
        yield event;
        if (event.type === "error") {
          hadError = true;
        }
      }
      if (hadError) return;

      review = parseSecurityReview(opts.workspacePath);
    }
  }
}
```

- [ ] **Step 4: Run all coordinator tests**

```bash
npx vitest run src/aegis/coordinator/
```

Expected: All 5 tests PASS (3 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/aegis/coordinator/sequential.ts src/aegis/coordinator/sequential.test.ts
git commit -m "feat(aegis): add security review + fix loop to SequentialProtocol"
```

---

### Task 3: Terminal UI + Build Command Updates

**Files:**

- Modify: `src/aegis/ui/terminal.ts`
- Modify: `src/aegis/commands/build.ts`

- [ ] **Step 1: Update terminal.ts — add security label and summary**

In `src/aegis/ui/terminal.ts`, make two changes:

1. Add `security` to the `agentLabels` map (line 10-13):

Change:

```typescript
const agentLabels: Record<string, string> = {
  architect: "Architect",
  main: "Builder",
};
```

To:

```typescript
const agentLabels: Record<string, string> = {
  architect: "Architect",
  main: "Builder",
  security: "Security",
};
```

2. Add `securitySummary` to `printBuildResult`. Replace the entire function with:

```typescript
export function printBuildResult(opts: {
  buildId: string;
  filesCreated: string[];
  workspacePath: string;
  duration: number;
  success: boolean;
  securitySummary?: {
    criticalFound: number;
    criticalFixed: number;
    warningCount: number;
    fixRounds: number;
    status: "pass" | "fail" | "unknown";
  };
}): void {
  console.log();
  if (opts.success) {
    if (opts.securitySummary?.status === "fail") {
      console.log(`  ${YELLOW}${BOLD}Build complete with security warnings!${RESET}`);
    } else {
      console.log(`  ${GREEN}${BOLD}Build complete!${RESET}`);
    }
  } else {
    console.log(`  ${RED}${BOLD}Build failed${RESET}`);
  }
  console.log();

  if (opts.filesCreated.length > 0) {
    console.log(
      `  ${BOLD}Files:${RESET} ${opts.filesCreated.length} created in ${opts.workspacePath}`,
    );
    for (const f of opts.filesCreated.slice(0, 20)) {
      console.log(`    ${f}`);
    }
    if (opts.filesCreated.length > 20) {
      console.log(`    ... (${opts.filesCreated.length - 20} more)`);
    }
    console.log();
  }

  if (opts.securitySummary && opts.securitySummary.status !== "unknown") {
    const s = opts.securitySummary;
    const remaining = s.criticalFound - s.criticalFixed;
    if (s.criticalFound > 0) {
      const fixInfo = s.fixRounds > 0 ? `, ${s.criticalFixed} fixed` : "";
      const remainInfo = remaining > 0 ? ` (${remaining} remaining)` : "";
      const statusLabel = remaining > 0 ? `${YELLOW}WARNING${RESET}` : `${GREEN}PASS${RESET}`;
      console.log(
        `  ${BOLD}Security:${RESET} ${s.criticalFound} critical found${fixInfo}${remainInfo} — ${statusLabel}`,
      );
    } else {
      console.log(`  ${BOLD}Security:${RESET} ${GREEN}PASS${RESET} — no critical issues`);
    }
    if (s.warningCount > 0) {
      console.log(`  ${DIM}  ${s.warningCount} warning(s)${RESET}`);
    }
    console.log();
  }

  const secs = Math.round(opts.duration / 1000);
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  const timeStr = mins > 0 ? `${mins}m ${remSecs}s` : `${secs}s`;

  console.log(`  ${BOLD}Time:${RESET}  ${timeStr}`);
  console.log(`  ${BOLD}Audit:${RESET} ${opts.buildId}`);
  console.log();
}
```

Also add the YELLOW constant near the top (after the RED line):

```typescript
const YELLOW = "\x1b[33m";
```

- [ ] **Step 2: Update build.ts — track security summary**

Replace the entire content of `src/aegis/commands/build.ts` with:

```typescript
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseSecurityReview } from "../coordinator/security-review.js";
import { SequentialProtocol } from "../coordinator/sequential.js";
import type { AuditPhase } from "../security/audit.js";
import { createAuditEntry, writeAuditEntry, loadChain } from "../security/audit.js";
import { acquireLock, releaseLock } from "../security/lock.js";
import { printBuildHeader, printEvent, printBuildResult } from "../ui/terminal.js";

const AEGIS_DIR = join(homedir(), ".aegis");
const AUDIT_DIR = join(AEGIS_DIR, "audit");
const LOCK_PATH = join(AEGIS_DIR, "build.lock");
const WORKSPACE_BASE = join(homedir(), ".openclaw", "workspace", "builds");

function generateBuildId(): string {
  const date = new Date().toISOString().slice(0, 10);
  const short = randomUUID().slice(0, 8);
  return `${date}-${short}`;
}

export async function buildCommand(prompt: string): Promise<void> {
  mkdirSync(AEGIS_DIR, { recursive: true });
  mkdirSync(AUDIT_DIR, { recursive: true });
  mkdirSync(WORKSPACE_BASE, { recursive: true });

  const lock = acquireLock(LOCK_PATH);
  if (!lock.acquired) {
    console.error(`  ${lock.reason}`);
    process.exit(1);
  }

  const buildId = generateBuildId();
  const workspacePath = join(WORKSPACE_BASE, buildId);
  mkdirSync(workspacePath, { recursive: true });

  printBuildHeader(buildId);

  const protocol = new SequentialProtocol();
  const startTime = Date.now();
  const phases: AuditPhase[] = [];
  let currentPhaseStart = "";
  let currentPhaseAgent = "";
  let filesCreated: string[] = [];
  let success = true;
  let firstSecurityCriticalCount = 0;
  let securityPhaseCount = 0;

  try {
    let phaseIndex = 0;

    for await (const event of protocol.execute({ prompt, buildId, workspacePath })) {
      if (event.type === "phase_start") {
        phaseIndex++;
        currentPhaseStart = event.timestamp;
        currentPhaseAgent = event.agent;
      }

      printEvent(event, phaseIndex, protocol.agents.length);

      if (event.type === "phase_end") {
        phases.push({
          agent: currentPhaseAgent,
          started: currentPhaseStart,
          completed: event.timestamp,
          status: "success",
        });

        // Track security review counts
        if (currentPhaseAgent === "security") {
          securityPhaseCount++;
          if (securityPhaseCount === 1) {
            const review = parseSecurityReview(workspacePath);
            firstSecurityCriticalCount = review.criticalCount;
          }
        }
      }

      if (event.type === "agent_response" && event.data.filesCreated) {
        filesCreated = event.data.filesCreated;
      }

      if (event.type === "error") {
        success = false;
        phases.push({
          agent: event.agent,
          started: currentPhaseStart || event.timestamp,
          completed: event.timestamp,
          status: "error",
        });
      }
    }
  } catch (err) {
    success = false;
    console.error(`  Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    releaseLock(LOCK_PATH);
  }

  const duration = Date.now() - startTime;

  // Compute security summary
  const finalReview = parseSecurityReview(workspacePath);
  const fixRounds = securityPhaseCount > 1 ? securityPhaseCount - 1 : 0;
  const criticalFixed = firstSecurityCriticalCount - finalReview.criticalCount;

  const securitySummary =
    securityPhaseCount > 0
      ? {
          criticalFound: firstSecurityCriticalCount,
          criticalFixed: Math.max(0, criticalFixed),
          warningCount: finalReview.warningCount,
          fixRounds,
          status: finalReview.status as "pass" | "fail" | "unknown",
        }
      : undefined;

  const chain = loadChain(AUDIT_DIR);
  const prevHash = chain.length > 0 ? chain[chain.length - 1].hash : "";

  const buildResult =
    securitySummary?.status === "fail" ? "success-with-warnings" : success ? "success" : "error";

  const entry = createAuditEntry({
    buildId,
    prompt,
    agents: protocol.agents,
    phases,
    result: buildResult,
    filesCreated,
    duration: Math.round(duration / 1000),
    prevHash,
  });
  writeAuditEntry(AUDIT_DIR, entry);

  printBuildResult({ buildId, filesCreated, workspacePath, duration, success, securitySummary });

  if (!success) {
    process.exit(1);
  }
}
```

- [ ] **Step 3: Build and verify**

```bash
cd /home/habbaba/Documents/aegis-runtime
npx tsdown
npx vitest run src/aegis/
```

Expected: All tests pass, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/aegis/ui/terminal.ts src/aegis/commands/build.ts
git commit -m "feat(aegis): add security summary to terminal UI and build command"
```

---

## Chunk 2: Agent Config + Integration (Task 4)

### Task 4: Create Security Agent + Live Test

**Files:**

- Create: `~/.openclaw/agents/security/agent/SOUL.md`
- Modify: `~/.openclaw/openclaw.json`

- [ ] **Step 1: Create security agent SOUL.md**

```bash
mkdir -p ~/.openclaw/agents/security/agent
```

Write `~/.openclaw/agents/security/agent/SOUL.md`:

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

- [ ] **Step 2: Add security agent to openclaw.json**

Read `~/.openclaw/openclaw.json`, add to the `agents.list` array:

```json
{
  "id": "security",
  "name": "security",
  "workspace": "/home/habbaba/.openclaw/workspace",
  "agentDir": "/home/habbaba/.openclaw/agents/security/agent",
  "model": "custom-localhost-8317/supervisor-model"
}
```

- [ ] **Step 3: Verify agent setup**

```bash
cd /home/habbaba/Documents/aegis-runtime
npx tsdown
node bin/aegis agents list
```

Expected: Shows 3 agents — main, architect, security.

- [ ] **Step 4: Live integration test**

```bash
node bin/aegis build "Build a Python REST API with user login using email and password, with a SQLite database"
```

Expected:

- Architect writes SPEC.md
- Builder implements (likely with some security issues like SQL injection or plaintext passwords)
- Security Reviewer finds issues, writes SECURITY-REVIEW.md
- If FAIL: Builder fixes, Security Reviewer re-checks
- Terminal shows security summary

- [ ] **Step 5: Verify audit trail**

```bash
cat ~/.aegis/audit/chain.json | python3 -m json.tool | tail -10
```

Expected: Latest entry has security agent in phases, result shows security status.

- [ ] **Step 6: Commit agent config reference**

```bash
cd /home/habbaba/Documents/aegis-runtime
git add -A
git commit -m "feat(aegis): 3-agent build — Architect, Builder, Security Reviewer with fix loop"
```
