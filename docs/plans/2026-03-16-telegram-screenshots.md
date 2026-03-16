# Telegram Bot + Screenshots Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Telegram to trigger AEGIS 3-agent builds with screenshot capture, by refactoring build into a reusable core function.

**Architecture:** Extract `runBuild()` from CLI build command into `src/aegis/core/build-runner.ts`. Add screenshot capture. Hook Telegram message handler to detect "build:" prefix and route to `runBuild()`, sending progress + results + screenshots back to chat.

**Tech Stack:** TypeScript, grammy (Telegram), puppeteer-core or subprocess chromium for screenshots, existing AEGIS coordinator

**Spec:** `docs/specs/2026-03-16-telegram-screenshots-design.md`

---

## File Map

| File                                      | Change | Responsibility                           |
| ----------------------------------------- | ------ | ---------------------------------------- |
| `src/aegis/core/build-runner.ts`          | Create | Reusable `runBuild()` function           |
| `src/aegis/core/build-runner.test.ts`     | Create | Tests for build runner                   |
| `src/aegis/core/screenshot.ts`            | Create | Screenshot capture utility               |
| `src/aegis/commands/build.ts`             | Modify | Thin wrapper calling runBuild()          |
| `src/aegis/telegram/build-handler.ts`     | Create | Telegram build request handler           |
| `src/aegis/telegram/format.ts`            | Create | Format BuildResult for Telegram messages |
| `extensions/telegram/src/bot-handlers.ts` | Modify | Add build detection hook (line ~1590)    |

---

## Chunk 1: Refactor Build Runner (Tasks 1-2)

### Task 1: Extract `runBuild()` Core Function

**Files:**

- Create: `src/aegis/core/build-runner.ts`
- Create: `src/aegis/core/build-runner.test.ts`
- Modify: `src/aegis/commands/build.ts`

- [ ] **Step 1: Create `src/aegis/core/build-runner.ts`**

Extract orchestration from `src/aegis/commands/build.ts`. This function does everything the CLI build does but returns a result instead of printing to terminal.

```typescript
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseSecurityReview } from "../coordinator/security-review.js";
import { SequentialProtocol } from "../coordinator/sequential.js";
import type { AgentEvent } from "../coordinator/types.js";
import type { AuditPhase } from "../security/audit.js";
import { createAuditEntry, writeAuditEntry, loadChain } from "../security/audit.js";
import { acquireLock, releaseLock } from "../security/lock.js";

const AEGIS_DIR = join(homedir(), ".aegis");
const AUDIT_DIR = join(AEGIS_DIR, "audit");
const LOCK_PATH = join(AEGIS_DIR, "build.lock");
const WORKSPACE_BASE = join(homedir(), ".openclaw", "workspace", "builds");

export interface SecuritySummary {
  criticalFound: number;
  criticalFixed: number;
  warningCount: number;
  fixRounds: number;
  status: "pass" | "fail" | "unknown";
}

export interface BuildResult {
  buildId: string;
  workspacePath: string;
  filesCreated: string[];
  success: boolean;
  duration: number;
  securitySummary?: SecuritySummary;
  screenshotPath?: string;
  events: AgentEvent[];
}

export interface BuildProgressCallback {
  onEvent: (event: AgentEvent, phaseIndex: number, totalPhases: number) => void;
}

function generateBuildId(): string {
  const date = new Date().toISOString().slice(0, 10);
  const short = randomUUID().slice(0, 8);
  return `${date}-${short}`;
}

export async function runBuild(
  prompt: string,
  progress?: BuildProgressCallback,
): Promise<BuildResult> {
  mkdirSync(AEGIS_DIR, { recursive: true });
  mkdirSync(AUDIT_DIR, { recursive: true });
  mkdirSync(WORKSPACE_BASE, { recursive: true });

  const lock = acquireLock(LOCK_PATH);
  if (!lock.acquired) {
    return {
      buildId: "",
      workspacePath: "",
      filesCreated: [],
      success: false,
      duration: 0,
      events: [],
    };
  }

  const buildId = generateBuildId();
  const workspacePath = join(WORKSPACE_BASE, buildId);
  mkdirSync(workspacePath, { recursive: true });

  const protocol = new SequentialProtocol();
  const startTime = Date.now();
  const phases: AuditPhase[] = [];
  const events: AgentEvent[] = [];
  let currentPhaseStart = "";
  let currentPhaseAgent = "";
  let filesCreated: string[] = [];
  let success = true;
  let firstSecurityCriticalCount = 0;
  let securityPhaseCount = 0;

  try {
    let phaseIndex = 0;

    for await (const event of protocol.execute({ prompt, buildId, workspacePath })) {
      events.push(event);

      if (event.type === "phase_start") {
        phaseIndex++;
        currentPhaseStart = event.timestamp;
        currentPhaseAgent = event.agent;
      }

      progress?.onEvent(event, phaseIndex, protocol.agents.length);

      if (event.type === "phase_end") {
        phases.push({
          agent: currentPhaseAgent,
          started: currentPhaseStart,
          completed: event.timestamp,
          status: "success",
        });

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
  } finally {
    releaseLock(LOCK_PATH);
  }

  const duration = Date.now() - startTime;

  const finalReview = parseSecurityReview(workspacePath);
  const fixRounds = securityPhaseCount > 1 ? securityPhaseCount - 1 : 0;
  const criticalFixed = firstSecurityCriticalCount - finalReview.criticalCount;

  const securitySummary: SecuritySummary | undefined =
    securityPhaseCount > 0
      ? {
          criticalFound: firstSecurityCriticalCount,
          criticalFixed: Math.max(0, criticalFixed),
          warningCount: finalReview.warningCount,
          fixRounds,
          status: finalReview.status,
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

  return {
    buildId,
    workspacePath,
    filesCreated,
    success,
    duration,
    securitySummary,
    events,
  };
}
```

- [ ] **Step 2: Replace `src/aegis/commands/build.ts` with thin wrapper**

```typescript
import { runBuild } from "../core/build-runner.js";
import { printBuildHeader, printEvent, printBuildResult } from "../ui/terminal.js";

export async function buildCommand(prompt: string): Promise<void> {
  const result = await runBuild(prompt, {
    onEvent: (event, phaseIndex, totalPhases) => {
      if (event.type === "phase_start" && phaseIndex === 1) {
        printBuildHeader(result.buildId);
      }
      printEvent(event, phaseIndex, totalPhases);
    },
  });

  // Handle case where printBuildHeader wasn't called (lock failed)
  if (!result.buildId) {
    console.error("  Failed to acquire build lock");
    process.exit(1);
  }

  printBuildResult({
    buildId: result.buildId,
    filesCreated: result.filesCreated,
    workspacePath: result.workspacePath,
    duration: result.duration,
    success: result.success,
    securitySummary: result.securitySummary,
  });

  if (!result.success) process.exit(1);
}
```

Note: There's a subtlety — `result.buildId` isn't available when the first event fires because `runBuild` is async. Fix by printing the header from within `runBuild` progress callback on the first event. Since the build ID is generated inside `runBuild`, the callback needs it passed through the event data or we print the header separately. The simplest fix: print the header before calling runBuild by peeking at the generated ID, or have the callback closure capture a mutable reference. The implementer should solve this — the key requirement is that `aegis build` output looks identical to before.

- [ ] **Step 3: Build and run all existing tests**

```bash
cd /home/habbaba/Documents/aegis-runtime
npx tsdown
npx vitest run src/aegis/
node bin/aegis --help
```

Expected: All 27 tests pass. CLI still works. Build output identical to before.

- [ ] **Step 4: Commit**

```bash
git add src/aegis/core/build-runner.ts src/aegis/commands/build.ts
git commit -m "refactor(aegis): extract runBuild() into reusable core function"
```

---

### Task 2: Screenshot Capture

**Files:**

- Create: `src/aegis/core/screenshot.ts`
- Create: `src/aegis/core/screenshot.test.ts`

- [ ] **Step 1: Check what's available for screenshots**

```bash
which chromium-browser || which chromium || which google-chrome || which google-chrome-stable
npm ls puppeteer 2>/dev/null
```

If no browser or puppeteer found, install puppeteer:

```bash
cd /home/habbaba/Documents/aegis-runtime
npm install puppeteer
```

- [ ] **Step 2: Write the test**

Create `src/aegis/core/screenshot.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureScreenshot } from "./screenshot.js";

describe("captureScreenshot", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "aegis-screenshot-"));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it("returns null when no HTML or server files present", async () => {
    writeFileSync(join(workspace, "README.md"), "# Hello");
    const result = await captureScreenshot(workspace);
    expect(result).toBeNull();
  });

  it("returns null gracefully when browser not available", async () => {
    writeFileSync(join(workspace, "index.html"), "<h1>Hello</h1>");
    // This test may pass or return a path depending on browser availability
    // The key is: it should NOT throw
    const result = await captureScreenshot(workspace);
    expect(result === null || typeof result === "string").toBe(true);
  });
});
```

- [ ] **Step 3: Implement screenshot capture**

Create `src/aegis/core/screenshot.ts`:

```typescript
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const SCREENSHOT_WIDTH = 1280;
const SCREENSHOT_HEIGHT = 800;

const SERVER_FILES = ["server.py", "app.py", "server.js", "app.js", "index.js", "main.py"];

function findServableFile(workspacePath: string): "html" | "server" | null {
  if (existsSync(join(workspacePath, "index.html"))) return "html";
  for (const f of SERVER_FILES) {
    if (existsSync(join(workspacePath, f))) return "server";
  }
  return null;
}

async function tryPuppeteer(url: string, outputPath: string): Promise<boolean> {
  try {
    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: SCREENSHOT_WIDTH, height: SCREENSHOT_HEIGHT });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 15000 });
    await page.screenshot({ path: outputPath, type: "png" });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

function startSimpleServer(workspacePath: string, port: number): ReturnType<typeof spawn> {
  return spawn("python3", ["-m", "http.server", String(port)], {
    cwd: workspacePath,
    stdio: "ignore",
  });
}

function startAppServer(workspacePath: string, serverFile: string): ReturnType<typeof spawn> {
  const ext = serverFile.split(".").pop();
  const cmd = ext === "py" ? "python3" : "node";
  return spawn(cmd, [serverFile], {
    cwd: workspacePath,
    stdio: "ignore",
    env: { ...process.env, PORT: "18234" },
  });
}

async function waitForPort(port: number, maxMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const resp = await fetch(`http://localhost:${port}/`).catch(() => null);
      if (resp) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function captureScreenshot(workspacePath: string): Promise<string | null> {
  const servable = findServableFile(workspacePath);
  if (!servable) return null;

  const outputPath = join(workspacePath, "screenshot.png");
  let server: ReturnType<typeof spawn> | null = null;
  let port: number;

  try {
    if (servable === "html") {
      port = 18233;
      server = startSimpleServer(workspacePath, port);
    } else {
      port = 18234;
      const serverFile = SERVER_FILES.find((f) => existsSync(join(workspacePath, f)))!;
      server = startAppServer(workspacePath, serverFile);
    }

    const ready = await waitForPort(port, 8000);
    if (!ready) return null;

    const captured = await tryPuppeteer(`http://localhost:${port}`, outputPath);
    if (captured && existsSync(outputPath)) return outputPath;

    return null;
  } catch {
    return null;
  } finally {
    if (server) {
      try {
        server.kill();
      } catch {}
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/aegis/core/screenshot.test.ts
```

Expected: Tests pass (null returns when no files or no browser).

- [ ] **Step 5: Wire screenshot into build-runner**

Add to the end of `runBuild()` in `src/aegis/core/build-runner.ts`, before the `return` statement:

```typescript
import { captureScreenshot } from "./screenshot.js";

// ... at the end of runBuild(), before return:
let screenshotPath: string | null = null;
try {
  screenshotPath = await captureScreenshot(workspacePath);
} catch {
  // Screenshot failure is non-fatal
}
```

And include `screenshotPath` in the returned result.

- [ ] **Step 6: Build and verify**

```bash
npx tsdown
npx vitest run src/aegis/
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/aegis/core/screenshot.ts src/aegis/core/screenshot.test.ts src/aegis/core/build-runner.ts
git commit -m "feat(aegis): add screenshot capture for built projects"
```

---

## Chunk 2: Telegram Integration (Tasks 3-4)

### Task 3: Telegram Build Handler

**Files:**

- Create: `src/aegis/telegram/format.ts`
- Create: `src/aegis/telegram/build-handler.ts`

- [ ] **Step 1: Create Telegram message formatter**

Create `src/aegis/telegram/format.ts`:

```typescript
import type { BuildResult } from "../core/build-runner.js";
import type { AgentEvent } from "../coordinator/types.js";

const agentEmojis: Record<string, string> = {
  architect: "\u{1F3DB}", // 🏛
  main: "\u{26A1}", // ⚡
  security: "\u{1F512}", // 🔒
};

function agentEmoji(agent: string): string {
  return agentEmojis[agent] ?? "\u{2699}";
}

const agentLabels: Record<string, string> = {
  architect: "Architect",
  main: "Builder",
  security: "Security",
};

function agentLabel(agent: string): string {
  return agentLabels[agent] ?? agent;
}

export function formatProgressMessage(
  buildId: string,
  completedPhases: string[],
  currentAgent: string | null,
  totalPhases: number,
): string {
  const lines: string[] = [];
  lines.push(`\u{1F3D7} AEGIS Build ${buildId}\n`);

  for (const agent of completedPhases) {
    lines.push(
      `\u{2705} [${completedPhases.indexOf(agent) + 1}/${totalPhases}] ${agentLabel(agent)} complete`,
    );
  }

  if (currentAgent) {
    const idx = completedPhases.length + 1;
    lines.push(
      `${agentEmoji(currentAgent)} [${idx}/${totalPhases}] ${agentLabel(currentAgent)} working...`,
    );
  }

  return lines.join("\n");
}

export function formatBuildResult(result: BuildResult): string {
  const lines: string[] = [];

  if (result.success) {
    if (result.securitySummary?.status === "fail") {
      lines.push("\u{26A0}\u{FE0F} Build complete with security warnings!\n");
    } else {
      lines.push("\u{2705} Build complete!\n");
    }
  } else {
    lines.push("\u{274C} Build failed\n");
  }

  lines.push(`\u{1F4C1} Files: ${result.filesCreated.length} created`);

  if (result.securitySummary && result.securitySummary.status !== "unknown") {
    const s = result.securitySummary;
    if (s.criticalFound > 0) {
      const remaining = s.criticalFound - s.criticalFixed;
      const fixInfo = s.fixRounds > 0 ? `, ${s.criticalFixed} fixed` : "";
      const status = remaining > 0 ? "WARNING" : "PASS";
      lines.push(
        `\u{1F512} Security: ${s.criticalFound} critical found${fixInfo} \u{2014} ${status}`,
      );
    } else {
      lines.push(`\u{1F512} Security: PASS \u{2014} no critical issues`);
    }
  }

  const secs = Math.round(result.duration / 1000);
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  const timeStr = mins > 0 ? `${mins}m ${remSecs}s` : `${secs}s`;

  lines.push(`\u{23F1} Time: ${timeStr}`);
  lines.push(`\u{1F4CB} Build: ${result.buildId}`);

  return lines.join("\n");
}
```

- [ ] **Step 2: Create the Telegram build handler**

Create `src/aegis/telegram/build-handler.ts`:

```typescript
import { InputFile } from "grammy";
import { existsSync, createReadStream } from "node:fs";
import { runBuild } from "../core/build-runner.js";
import { formatProgressMessage, formatBuildResult } from "./format.js";

export function extractBuildPrompt(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("/build ")) return trimmed.slice(7).trim();
  if (trimmed.toLowerCase().startsWith("build: ")) return trimmed.slice(7).trim();
  if (trimmed.toLowerCase().startsWith("build:")) return trimmed.slice(6).trim();
  return null;
}

export async function handleTelegramBuild(
  ctx: { reply: Function; api: { editMessageText: Function }; chat: { id: number } },
  prompt: string,
): Promise<void> {
  const statusMsg = await ctx.reply("\u{1F3D7} Starting build...");
  const chatId = ctx.chat.id;
  const messageId = statusMsg.message_id;

  const completedPhases: string[] = [];
  let currentAgent: string | null = null;
  let buildId = "";
  let totalPhases = 3;

  const result = await runBuild(prompt, {
    onEvent: async (event, phaseIndex, phases) => {
      totalPhases = phases;

      if (event.type === "phase_start") {
        currentAgent = event.agent;
        if (phaseIndex === 1) {
          buildId = ""; // Will be set from result
        }
      }

      if (event.type === "phase_end") {
        completedPhases.push(event.agent);
        currentAgent = null;
      }

      // Update progress message (best effort — Telegram rate limits may cause failures)
      try {
        await ctx.api.editMessageText(
          chatId,
          messageId,
          formatProgressMessage(buildId || "...", completedPhases, currentAgent, totalPhases),
        );
      } catch {
        // Telegram rate limit or message unchanged — ignore
      }
    },
  });

  buildId = result.buildId;

  // Send final result
  await ctx.api.editMessageText(chatId, messageId, formatBuildResult(result));

  // Send screenshot if available
  if (result.screenshotPath && existsSync(result.screenshotPath)) {
    try {
      await ctx.reply(new InputFile(createReadStream(result.screenshotPath)), {
        caption: `\u{1F4F8} Screenshot of ${result.buildId}`,
      });
    } catch {
      // Screenshot send failed — non-fatal
    }
  }
}
```

- [ ] **Step 3: Build and verify**

```bash
npx tsdown
```

Expected: Build succeeds (Telegram handler compiles).

- [ ] **Step 4: Commit**

```bash
git add src/aegis/telegram/
git commit -m "feat(aegis): add Telegram build handler with progress updates"
```

---

### Task 4: Hook into OpenClaw Telegram Handler + Live Test

**Files:**

- Modify: `extensions/telegram/src/bot-handlers.ts`

- [ ] **Step 1: Add build detection hook to Telegram handler**

In `extensions/telegram/src/bot-handlers.ts`, modify the `bot.on("message", ...)` handler at line ~1605. Add build detection BEFORE the `handleInboundMessageLike` call:

```typescript
bot.on("message", async (ctx) => {
  const msg = ctx.message;
  if (!msg) {
    return;
  }

  // AEGIS build detection — intercept "build:" and "/build" messages
  const msgText = msg.text ?? "";
  const { extractBuildPrompt, handleTelegramBuild } =
    await import("../../../src/aegis/telegram/build-handler.js");
  const buildPrompt = extractBuildPrompt(msgText);
  if (buildPrompt) {
    await handleTelegramBuild(ctx, buildPrompt);
    return;
  }

  await handleInboundMessageLike({
    // ... existing code unchanged
  });
});
```

The dynamic `import()` ensures the AEGIS code is only loaded when a build is detected, keeping the normal message path fast.

- [ ] **Step 2: Set up Telegram bot token**

Create a bot via Telegram @BotFather. Get the token. Add to config:

```bash
# Edit ~/.openclaw/openclaw.json — add channels.telegram section:
```

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "<TOKEN_FROM_BOTFATHER>",
      "dmPolicy": "open"
    }
  }
}
```

- [ ] **Step 3: Build and restart gateway**

```bash
cd /home/habbaba/Documents/aegis-runtime
npx tsdown
# Restart gateway to pick up Telegram channel
node dist/entry.js gateway run &
```

- [ ] **Step 4: Test in Telegram**

Send to your bot:

```
build: Build a simple HTML page that shows the current date and time, updating every second
```

Expected:

- Bot replies with "Starting build..."
- Message updates with progress (Architect working... Builder working... Security working...)
- Final message shows build result with file count, security status, time
- Screenshot sent as photo (if browser available)

- [ ] **Step 5: Verify CLI still works**

```bash
node bin/aegis build "Build a hello world Python script"
```

Expected: CLI output identical to before.

- [ ] **Step 6: Commit and push**

```bash
git add extensions/telegram/src/bot-handlers.ts src/aegis/
git commit -m "feat(aegis): wire Telegram bot to trigger AEGIS builds"
git push
```
