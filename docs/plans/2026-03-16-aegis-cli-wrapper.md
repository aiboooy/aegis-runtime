# AEGIS CLI Wrapper Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `aegis` CLI that orchestrates two-agent workflows (Architect -> Builder) on top of the OpenClaw gateway.

**Architecture:** Standalone Node.js CLI (`bin/aegis`) that calls OpenClaw's gateway RPC to run agents sequentially. All code in `src/aegis/`, zero changes to OpenClaw source. Uses Commander.js for CLI, OpenClaw's `callGateway()` for agent execution, and a Protocol interface for future multi-agent expansion.

**Tech Stack:** TypeScript, Node.js 22.16+, Commander.js 14, Vitest, OpenClaw gateway RPC, tsdown build

**Spec:** `docs/specs/2026-03-16-aegis-cli-wrapper-design.md`

---

## File Map

| File                                  | Responsibility                                           |
| ------------------------------------- | -------------------------------------------------------- |
| `bin/aegis`                           | Entry point shim (imports compiled JS)                   |
| `src/aegis/cli.ts`                    | Commander program, registers all commands                |
| `src/aegis/gateway/client.ts`         | Wraps OpenClaw's `callGateway()` into `runAgent()`       |
| `src/aegis/coordinator/types.ts`      | Protocol, AgentEvent, BuildOpts interfaces               |
| `src/aegis/coordinator/sequential.ts` | Architect -> Builder sequential protocol                 |
| `src/aegis/commands/build.ts`         | `aegis build` command handler                            |
| `src/aegis/commands/run.ts`           | `aegis run` command handler                              |
| `src/aegis/commands/agents.ts`        | `aegis agents list/add` command handler                  |
| `src/aegis/commands/addon.ts`         | `aegis addon add/list/remove` command handler            |
| `src/aegis/commands/start.ts`         | `aegis start` command handler                            |
| `src/aegis/commands/status.ts`        | `aegis status` command handler                           |
| `src/aegis/security/audit.ts`         | Hash-chain audit logging                                 |
| `src/aegis/security/lock.ts`          | Build lockfile (PID-based)                               |
| `src/aegis/ui/terminal.ts`            | Spinners, progress, result display                       |
| `src/aegis/addons/registry.ts`        | MCP add-on registry (inline configs, no filesystem read) |
| `src/aegis/addons/installer.ts`       | MCP add-on install/remove                                |

**Test files** (mirror source structure):

| Test File                                  | Tests                                                   |
| ------------------------------------------ | ------------------------------------------------------- |
| `src/aegis/security/audit.test.ts`         | Hash-chain creation, verification, corruption detection |
| `src/aegis/security/lock.test.ts`          | Lock acquire, release, stale detection                  |
| `src/aegis/coordinator/sequential.test.ts` | Protocol flow, error handling, SPEC.md verification     |
| `src/aegis/gateway/client.test.ts`         | runAgent wrapper (mocked callGateway)                   |
| `src/aegis/addons/registry.test.ts`        | Registry loading, config validation                     |
| `src/aegis/cli.test.ts`                    | Command registration, argument parsing                  |

---

## Chunk 1: Foundation (Tasks 1-4)

### Task 1: Build Pipeline Setup

**Files:**

- Create: `bin/aegis`
- Create: `src/aegis/cli.ts`
- Modify: `tsdown.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Create the entry point shim**

Create `bin/aegis`:

```javascript
#!/usr/bin/env node

import module from "node:module";

if (module.enableCompileCache && !process.env.NODE_DISABLE_COMPILE_CACHE) {
  try {
    module.enableCompileCache();
  } catch {}
}

await import("../dist/aegis/cli.js");
```

```bash
chmod +x bin/aegis
```

- [ ] **Step 2: Create minimal CLI entry point**

Create `src/aegis/cli.ts`:

```typescript
import { Command } from "commander";

const program = new Command();

program.name("aegis").description("AEGIS — Multi-agent orchestration platform").version("0.1.0");

program
  .command("build")
  .description("Build a project using Architect + Builder agents")
  .argument("<prompt>", "What to build")
  .action(async (prompt: string) => {
    console.log(`[aegis] build: ${prompt}`);
    console.log("[aegis] Not yet implemented");
  });

program
  .command("status")
  .description("Show AEGIS status")
  .action(async () => {
    console.log("[aegis] Status: not yet implemented");
  });

await program.parseAsync(process.argv);
```

- [ ] **Step 3: Add AEGIS to tsdown build config**

Modify `tsdown.config.ts` — add a new entry to the `defineConfig` array (before the closing `]`):

```typescript
  nodeBuildConfig({
    entry: "src/aegis/cli.ts",
    outDir: "dist/aegis",
  }),
```

- [ ] **Step 4: Add aegis binary to package.json**

Modify `package.json` — change the `"bin"` field from:

```json
"bin": {
  "openclaw": "openclaw.mjs"
},
```

to:

```json
"bin": {
  "openclaw": "openclaw.mjs",
  "aegis": "bin/aegis"
},
```

Also add `"bin/"` to the `"files"` array so it's included in npm pack/publish.

- [ ] **Step 5: Build and verify**

```bash
cd /home/habbaba/Documents/aegis-runtime
npx tsdown
node bin/aegis --help
node bin/aegis build "test prompt"
```

Expected: Help text shows "AEGIS" and commands. Build command prints placeholder.

- [ ] **Step 6: Commit**

```bash
git add bin/aegis src/aegis/cli.ts tsdown.config.ts package.json
git commit -m "feat(aegis): scaffold CLI entry point and build pipeline"
```

---

### Task 2: Gateway Client Wrapper

**Files:**

- Create: `src/aegis/gateway/client.ts`
- Create: `src/aegis/gateway/client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/aegis/gateway/client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// We'll mock the OpenClaw imports
vi.mock("../../gateway/call.js", () => ({
  callGateway: vi.fn(),
  randomIdempotencyKey: vi.fn(() => "test-idem-key"),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: vi.fn(() => ({
    agents: {
      defaults: { workspace: "/tmp/test-workspace" },
      list: [{ id: "main" }, { id: "architect" }],
    },
  })),
}));

vi.mock("../../commands/agent/session.js", () => ({
  resolveSessionKeyForRequest: vi.fn(() => ({
    sessionKey: "test-session-key",
  })),
}));

import { callGateway } from "../../gateway/call.js";
import { runAgent } from "./client.js";

describe("runAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls gateway with correct params and returns text", async () => {
    const mockCallGateway = vi.mocked(callGateway);
    mockCallGateway.mockResolvedValue({
      runId: "run-123",
      status: "completed",
      summary: "Done",
      result: {
        payloads: [{ text: "Hello from agent" }],
      },
    });

    const result = await runAgent({
      agentId: "architect",
      message: "Design a system",
    });

    expect(result.runId).toBe("run-123");
    expect(result.status).toBe("completed");
    expect(result.text).toBe("Hello from agent");
    expect(mockCallGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "agent",
        expectFinal: true,
        params: expect.objectContaining({
          agentId: "architect",
          message: "Design a system",
          deliver: false,
        }),
      }),
    );
  });

  it("concatenates multiple payloads", async () => {
    vi.mocked(callGateway).mockResolvedValue({
      runId: "run-456",
      status: "completed",
      result: {
        payloads: [{ text: "Part 1" }, { text: "Part 2" }],
      },
    });

    const result = await runAgent({
      agentId: "main",
      message: "Build it",
    });

    expect(result.text).toBe("Part 1\nPart 2");
  });

  it("handles empty response gracefully", async () => {
    vi.mocked(callGateway).mockResolvedValue({});

    const result = await runAgent({
      agentId: "main",
      message: "Build it",
    });

    expect(result.text).toBe("");
    expect(result.status).toBe("unknown");
  });

  it("passes extraSystemPrompt when provided", async () => {
    vi.mocked(callGateway).mockResolvedValue({
      result: { payloads: [{ text: "ok" }] },
    });

    await runAgent({
      agentId: "architect",
      message: "Design",
      extraSystemPrompt: "Work in /workspace/builds/abc/",
    });

    expect(callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          extraSystemPrompt: "Work in /workspace/builds/abc/",
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/habbaba/Documents/aegis-runtime
npx vitest run src/aegis/gateway/client.test.ts
```

Expected: FAIL — `./client.js` module not found.

- [ ] **Step 3: Implement the gateway client**

Create `src/aegis/gateway/client.ts`:

```typescript
import { callGateway, randomIdempotencyKey } from "../../gateway/call.js";
import { loadConfig } from "../../config/config.js";
import { resolveSessionKeyForRequest } from "../../commands/agent/session.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../../utils/message-channel.js";

export interface AgentRunOpts {
  agentId: string;
  message: string;
  timeoutSeconds?: number;
  extraSystemPrompt?: string;
}

export interface AgentRunResult {
  runId: string;
  status: string;
  text: string;
  summary?: string;
}

type GatewayAgentResponse = {
  runId?: string;
  status?: string;
  summary?: string;
  result?: {
    payloads?: Array<{ text?: string }>;
  };
};

export async function runAgent(opts: AgentRunOpts): Promise<AgentRunResult> {
  const cfg = loadConfig();
  const timeoutSeconds = opts.timeoutSeconds ?? 600;

  const { sessionKey } = resolveSessionKeyForRequest({
    cfg,
    agentId: opts.agentId,
  });

  const response = await callGateway<GatewayAgentResponse>({
    config: cfg,
    method: "agent",
    params: {
      message: opts.message,
      agentId: opts.agentId,
      sessionKey,
      deliver: false,
      timeout: timeoutSeconds,
      idempotencyKey: randomIdempotencyKey(),
      extraSystemPrompt: opts.extraSystemPrompt,
    },
    expectFinal: true,
    timeoutMs: (timeoutSeconds + 30) * 1000,
    clientName: GATEWAY_CLIENT_NAMES.CLI,
    mode: GATEWAY_CLIENT_MODES.CLI,
  });

  const payloads = response?.result?.payloads ?? [];
  const text = payloads
    .map((p) => p.text ?? "")
    .join("\n")
    .trim();

  return {
    runId: response?.runId ?? "",
    status: response?.status ?? "unknown",
    text,
    summary: response?.summary,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/aegis/gateway/client.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/aegis/gateway/
git commit -m "feat(aegis): add gateway client wrapper with runAgent()"
```

---

### Task 3: Audit System

**Files:**

- Create: `src/aegis/security/audit.ts`
- Create: `src/aegis/security/audit.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/aegis/security/audit.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createAuditEntry,
  writeAuditEntry,
  loadChain,
  verifyChain,
  type AuditEntry,
} from "./audit.js";

describe("audit", () => {
  let auditDir: string;

  beforeEach(() => {
    auditDir = mkdtempSync(join(tmpdir(), "aegis-audit-"));
  });

  afterEach(() => {
    rmSync(auditDir, { recursive: true, force: true });
  });

  describe("createAuditEntry", () => {
    it("creates entry with hash including prevHash", () => {
      const entry = createAuditEntry({
        buildId: "test-build-1",
        prompt: "Build a dashboard",
        agents: ["architect", "main"],
        phases: [
          {
            agent: "architect",
            started: "2026-03-16T14:00:00Z",
            completed: "2026-03-16T14:01:00Z",
            status: "success",
          },
        ],
        result: "success",
        filesCreated: ["SPEC.md"],
        duration: 60,
        prevHash: "",
      });

      expect(entry.buildId).toBe("test-build-1");
      expect(entry.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(entry.prevHash).toBe("");
    });

    it("includes prevHash in hash calculation", () => {
      const entry1 = createAuditEntry({
        buildId: "build-1",
        prompt: "test",
        agents: ["architect"],
        phases: [],
        result: "success",
        filesCreated: [],
        duration: 10,
        prevHash: "",
      });

      const entry2 = createAuditEntry({
        buildId: "build-2",
        prompt: "test",
        agents: ["architect"],
        phases: [],
        result: "success",
        filesCreated: [],
        duration: 10,
        prevHash: entry1.hash,
      });

      expect(entry2.prevHash).toBe(entry1.hash);
      expect(entry2.hash).not.toBe(entry1.hash);
    });
  });

  describe("writeAuditEntry + loadChain", () => {
    it("writes entry file and updates chain index", () => {
      const entry = createAuditEntry({
        buildId: "build-1",
        prompt: "test",
        agents: ["architect"],
        phases: [],
        result: "success",
        filesCreated: [],
        duration: 10,
        prevHash: "",
      });

      writeAuditEntry(auditDir, entry);

      expect(existsSync(join(auditDir, "builds", "build-1.json"))).toBe(true);

      const chain = loadChain(auditDir);
      expect(chain).toHaveLength(1);
      expect(chain[0].buildId).toBe("build-1");
      expect(chain[0].hash).toBe(entry.hash);
    });

    it("appends to existing chain", () => {
      const entry1 = createAuditEntry({
        buildId: "b1",
        prompt: "t",
        agents: [],
        phases: [],
        result: "success",
        filesCreated: [],
        duration: 1,
        prevHash: "",
      });
      writeAuditEntry(auditDir, entry1);

      const entry2 = createAuditEntry({
        buildId: "b2",
        prompt: "t",
        agents: [],
        phases: [],
        result: "success",
        filesCreated: [],
        duration: 1,
        prevHash: entry1.hash,
      });
      writeAuditEntry(auditDir, entry2);

      const chain = loadChain(auditDir);
      expect(chain).toHaveLength(2);
    });
  });

  describe("verifyChain", () => {
    it("returns true for valid chain", () => {
      const e1 = createAuditEntry({
        buildId: "b1",
        prompt: "t",
        agents: [],
        phases: [],
        result: "success",
        filesCreated: [],
        duration: 1,
        prevHash: "",
      });
      writeAuditEntry(auditDir, e1);

      const e2 = createAuditEntry({
        buildId: "b2",
        prompt: "t",
        agents: [],
        phases: [],
        result: "success",
        filesCreated: [],
        duration: 1,
        prevHash: e1.hash,
      });
      writeAuditEntry(auditDir, e2);

      expect(verifyChain(auditDir)).toBe(true);
    });

    it("returns true for empty chain", () => {
      expect(verifyChain(auditDir)).toBe(true);
    });

    it("returns false when entry is tampered", () => {
      const e1 = createAuditEntry({
        buildId: "b1",
        prompt: "t",
        agents: [],
        phases: [],
        result: "success",
        filesCreated: [],
        duration: 1,
        prevHash: "",
      });
      writeAuditEntry(auditDir, e1);

      // Tamper with the entry file
      const entryPath = join(auditDir, "builds", "b1.json");
      const tampered = JSON.parse(readFileSync(entryPath, "utf-8"));
      tampered.prompt = "TAMPERED";
      writeFileSync(entryPath, JSON.stringify(tampered, null, 2));

      expect(verifyChain(auditDir)).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/aegis/security/audit.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the audit system**

Create `src/aegis/security/audit.ts`:

```typescript
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface AuditPhase {
  agent: string;
  started: string;
  completed: string;
  status: string;
}

export interface AuditEntry {
  buildId: string;
  timestamp: string;
  prompt: string;
  agents: string[];
  phases: AuditPhase[];
  result: string;
  filesCreated: string[];
  duration: number;
  prevHash: string;
  hash: string;
}

export interface ChainEntry {
  buildId: string;
  hash: string;
  timestamp: string;
}

type CreateAuditInput = Omit<AuditEntry, "hash" | "timestamp">;

export function createAuditEntry(input: CreateAuditInput): AuditEntry {
  const timestamp = new Date().toISOString();
  const entryWithoutHash = { ...input, timestamp };
  const hashInput = JSON.stringify(entryWithoutHash) + input.prevHash;
  const hash = "sha256:" + createHash("sha256").update(hashInput).digest("hex");

  return { ...entryWithoutHash, hash };
}

export function writeAuditEntry(auditDir: string, entry: AuditEntry): void {
  const buildsDir = join(auditDir, "builds");
  mkdirSync(buildsDir, { recursive: true });

  // Write the individual build entry
  const entryPath = join(buildsDir, `${entry.buildId}.json`);
  writeFileSync(entryPath, JSON.stringify(entry, null, 2) + "\n");

  // Update the chain index
  const chainPath = join(auditDir, "chain.json");
  const chain = loadChain(auditDir);
  chain.push({
    buildId: entry.buildId,
    hash: entry.hash,
    timestamp: entry.timestamp,
  });
  writeFileSync(chainPath, JSON.stringify(chain, null, 2) + "\n");
}

export function loadChain(auditDir: string): ChainEntry[] {
  const chainPath = join(auditDir, "chain.json");
  if (!existsSync(chainPath)) {
    return [];
  }
  return JSON.parse(readFileSync(chainPath, "utf-8"));
}

export function verifyChain(auditDir: string): boolean {
  const chain = loadChain(auditDir);
  if (chain.length === 0) return true;

  for (let i = 0; i < chain.length; i++) {
    const entryPath = join(auditDir, "builds", `${chain[i].buildId}.json`);
    if (!existsSync(entryPath)) return false;

    const entry: AuditEntry = JSON.parse(readFileSync(entryPath, "utf-8"));
    if (entry.hash !== chain[i].hash) return false;

    if (i > 0 && entry.prevHash !== chain[i - 1].hash) return false;
    if (i === 0 && entry.prevHash !== "") return false;
  }

  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/aegis/security/audit.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/aegis/security/audit.ts src/aegis/security/audit.test.ts
git commit -m "feat(aegis): add hash-chain audit trail"
```

---

### Task 4: Build Lockfile

**Files:**

- Create: `src/aegis/security/lock.ts`
- Create: `src/aegis/security/lock.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/aegis/security/lock.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireLock, releaseLock } from "./lock.js";

describe("build lock", () => {
  let lockDir: string;

  beforeEach(() => {
    lockDir = mkdtempSync(join(tmpdir(), "aegis-lock-"));
  });

  afterEach(() => {
    rmSync(lockDir, { recursive: true, force: true });
  });

  it("acquires lock when no lock exists", () => {
    const lockPath = join(lockDir, "build.lock");
    const result = acquireLock(lockPath);
    expect(result.acquired).toBe(true);
    releaseLock(lockPath);
  });

  it("fails to acquire when lock held by current process", () => {
    const lockPath = join(lockDir, "build.lock");
    const r1 = acquireLock(lockPath);
    expect(r1.acquired).toBe(true);

    const r2 = acquireLock(lockPath);
    expect(r2.acquired).toBe(false);
    expect(r2.reason).toMatch(/already running/);

    releaseLock(lockPath);
  });

  it("acquires lock when stale (dead PID)", () => {
    const lockPath = join(lockDir, "build.lock");
    // Write a lock with a PID that almost certainly doesn't exist
    writeFileSync(lockPath, "999999999");

    const result = acquireLock(lockPath);
    expect(result.acquired).toBe(true);
    releaseLock(lockPath);
  });

  it("releases lock", () => {
    const lockPath = join(lockDir, "build.lock");
    acquireLock(lockPath);
    releaseLock(lockPath);

    // Should be able to acquire again
    const result = acquireLock(lockPath);
    expect(result.acquired).toBe(true);
    releaseLock(lockPath);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/aegis/security/lock.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the lock manager**

Create `src/aegis/security/lock.ts`:

```typescript
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";

export interface LockResult {
  acquired: boolean;
  reason?: string;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireLock(lockPath: string): LockResult {
  // Check for existing lock and handle stale PIDs
  if (existsSync(lockPath)) {
    const content = readFileSync(lockPath, "utf-8").trim();
    const pid = parseInt(content, 10);

    if (!isNaN(pid) && isProcessAlive(pid)) {
      return {
        acquired: false,
        reason: `Another build is already running (PID ${pid})`,
      };
    }

    // Stale lock — remove it
    unlinkSync(lockPath);
  }

  // Atomic create — flag 'wx' fails if file already exists (TOCTOU-safe)
  try {
    writeFileSync(lockPath, String(process.pid), { flag: "wx" });
    return { acquired: true };
  } catch {
    // Another process created the lock between our check and write
    return {
      acquired: false,
      reason: "Another build is already running",
    };
  }
}

export function releaseLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    // Ignore — lock may already be removed
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/aegis/security/lock.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/aegis/security/lock.ts src/aegis/security/lock.test.ts
git commit -m "feat(aegis): add build lockfile with stale PID detection"
```

---

## Chunk 2: Coordinator & Build Command (Tasks 5-7)

### Task 5: Coordinator Types & Sequential Protocol

**Files:**

- Create: `src/aegis/coordinator/types.ts`
- Create: `src/aegis/coordinator/sequential.ts`
- Create: `src/aegis/coordinator/sequential.test.ts`

- [ ] **Step 1: Create the types file**

Create `src/aegis/coordinator/types.ts`:

```typescript
export interface AgentEvent {
  type: "phase_start" | "phase_end" | "agent_response" | "error";
  agent: string;
  data: {
    text?: string;
    error?: string;
    filesCreated?: string[];
  };
  timestamp: string;
}

export interface BuildOpts {
  prompt: string;
  buildId: string;
  workspacePath: string;
  timeoutSeconds?: number;
}

export interface Protocol {
  name: string;
  agents: string[];
  execute(opts: BuildOpts): AsyncGenerator<AgentEvent>;
}
```

- [ ] **Step 2: Write the failing test for SequentialProtocol**

Create `src/aegis/coordinator/sequential.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentEvent } from "./types.js";

// Mock the gateway client
vi.mock("../gateway/client.js", () => ({
  runAgent: vi.fn(),
}));

import { runAgent } from "../gateway/client.js";
import { SequentialProtocol } from "./sequential.js";

describe("SequentialProtocol", () => {
  let workspacePath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    workspacePath = mkdtempSync(join(tmpdir(), "aegis-workspace-"));
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it("runs architect then builder when SPEC.md is created", async () => {
    const mockRunAgent = vi.mocked(runAgent);

    // Architect creates SPEC.md
    mockRunAgent.mockImplementationOnce(async (opts) => {
      writeFileSync(join(workspacePath, "SPEC.md"), "# Spec\nBuild a dashboard");
      return { runId: "r1", status: "completed", text: "Spec written.", summary: "" };
    });

    // Builder implements
    mockRunAgent.mockImplementationOnce(async (opts) => {
      writeFileSync(join(workspacePath, "server.py"), "# server");
      return { runId: "r2", status: "completed", text: "Built.", summary: "" };
    });

    const protocol = new SequentialProtocol();
    const events: AgentEvent[] = [];

    for await (const event of protocol.execute({
      prompt: "Build a dashboard",
      buildId: "test-build",
      workspacePath,
    })) {
      events.push(event);
    }

    // Should have: phase_start(arch), agent_response(arch), phase_end(arch),
    //             phase_start(main), agent_response(main), phase_end(main)
    const types = events.map((e) => `${e.type}:${e.agent}`);
    expect(types).toEqual([
      "phase_start:architect",
      "agent_response:architect",
      "phase_end:architect",
      "phase_start:main",
      "agent_response:main",
      "phase_end:main",
    ]);

    // Verify architect was called with extraSystemPrompt containing workspace path
    expect(mockRunAgent).toHaveBeenCalledTimes(2);
    expect(mockRunAgent.mock.calls[0][0].agentId).toBe("architect");
    expect(mockRunAgent.mock.calls[0][0].extraSystemPrompt).toContain(workspacePath);
    expect(mockRunAgent.mock.calls[1][0].agentId).toBe("main");
    expect(mockRunAgent.mock.calls[1][0].extraSystemPrompt).toContain(workspacePath);
  });

  it("emits error and stops when architect fails to create SPEC.md", async () => {
    vi.mocked(runAgent).mockResolvedValueOnce({
      runId: "r1",
      status: "completed",
      text: "I could not design this.",
      summary: "",
    });

    const protocol = new SequentialProtocol();
    const events: AgentEvent[] = [];

    for await (const event of protocol.execute({
      prompt: "Build something impossible",
      buildId: "test-fail",
      workspacePath,
    })) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    expect(types).toContain("error");
    // Should NOT have builder phase
    expect(types).not.toContain("phase_start:main");

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent?.data.error).toContain("SPEC.md");
  });

  it("handles gateway error during architect phase", async () => {
    vi.mocked(runAgent).mockRejectedValueOnce(new Error("Gateway connection refused"));

    const protocol = new SequentialProtocol();
    const events: AgentEvent[] = [];

    for await (const event of protocol.execute({
      prompt: "Build",
      buildId: "test-err",
      workspacePath,
    })) {
      events.push(event);
    }

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent?.data.error).toContain("Gateway connection refused");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run src/aegis/coordinator/sequential.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement SequentialProtocol**

Create `src/aegis/coordinator/sequential.ts`:

```typescript
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { runAgent } from "../gateway/client.js";
import type { AgentEvent, BuildOpts, Protocol } from "./types.js";

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
    `Design a system for the following request:`,
    ``,
    userPrompt,
    ``,
    `Write a detailed SPEC.md to the current directory with:`,
    `- Exact API endpoints, URLs, request/response formats`,
    `- Database schema (CREATE TABLE statements) if needed`,
    `- Frontend layout with sections and data sources`,
    `- External API URLs with example responses`,
    `- Technology choices and dependencies`,
  ].join("\n");
}

function buildBuilderPrompt(): string {
  return [
    `Read SPEC.md in the current directory and implement everything exactly as specified.`,
    ``,
    `Write all code files. Run and test the code. Fix any errors before finishing.`,
    `Use Tailwind CSS via CDN for frontends. Use FastAPI for Python backends.`,
    `Include error handling and run your code before saying done.`,
  ].join("\n");
}

function workspaceSystemPrompt(workspacePath: string): string {
  return `IMPORTANT: Work exclusively in the directory: ${workspacePath}\nCreate all files there. Do not use any other directory.`;
}

export class SequentialProtocol implements Protocol {
  name = "sequential";
  agents = ["architect", "main"];

  async *execute(opts: BuildOpts): AsyncGenerator<AgentEvent> {
    // Phase 1: Architect
    yield { type: "phase_start", agent: "architect", data: {}, timestamp: now() };

    let archResult;
    try {
      archResult = await runAgent({
        agentId: "architect",
        message: buildArchitectPrompt(opts.prompt),
        extraSystemPrompt: workspaceSystemPrompt(opts.workspacePath),
        timeoutSeconds: opts.timeoutSeconds,
      });
    } catch (err) {
      yield {
        type: "error",
        agent: "architect",
        data: { error: err instanceof Error ? err.message : String(err) },
        timestamp: now(),
      };
      return;
    }

    yield {
      type: "agent_response",
      agent: "architect",
      data: { text: archResult.text },
      timestamp: now(),
    };

    // Verify SPEC.md was created
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

    yield { type: "phase_end", agent: "architect", data: {}, timestamp: now() };

    // Phase 2: Builder
    yield { type: "phase_start", agent: "main", data: {}, timestamp: now() };

    let buildResult;
    try {
      buildResult = await runAgent({
        agentId: "main",
        message: buildBuilderPrompt(),
        extraSystemPrompt: workspaceSystemPrompt(opts.workspacePath),
        timeoutSeconds: opts.timeoutSeconds,
      });
    } catch (err) {
      yield {
        type: "error",
        agent: "main",
        data: { error: err instanceof Error ? err.message : String(err) },
        timestamp: now(),
      };
      return;
    }

    const filesCreated = listFilesRecursive(opts.workspacePath);

    yield {
      type: "agent_response",
      agent: "main",
      data: { text: buildResult.text, filesCreated },
      timestamp: now(),
    };

    yield { type: "phase_end", agent: "main", data: {}, timestamp: now() };
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/aegis/coordinator/sequential.test.ts
```

Expected: All 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/aegis/coordinator/
git commit -m "feat(aegis): add coordinator with SequentialProtocol (Architect -> Builder)"
```

---

### Task 6: Terminal UI

**Files:**

- Create: `src/aegis/ui/terminal.ts`

- [ ] **Step 1: Implement terminal UI helpers**

Create `src/aegis/ui/terminal.ts`:

```typescript
import type { AgentEvent } from "../coordinator/types.js";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

const agentLabels: Record<string, string> = {
  architect: "Architect",
  main: "Builder",
};

function agentLabel(agent: string): string {
  return agentLabels[agent] ?? agent;
}

export function printBuildHeader(buildId: string): void {
  console.log();
  console.log(`${BOLD}  AEGIS Build ${buildId}${RESET}`);
  console.log();
}

export function printEvent(event: AgentEvent, phaseIndex: number, totalPhases: number): void {
  const label = agentLabel(event.agent);

  switch (event.type) {
    case "phase_start":
      process.stdout.write(
        `  ${DIM}[${phaseIndex}/${totalPhases}]${RESET} ${CYAN}${label} working...${RESET}`,
      );
      break;

    case "agent_response":
      // Clear the "working..." line
      process.stdout.write("\r\x1b[K");
      console.log(
        `  ${DIM}[${phaseIndex}/${totalPhases}]${RESET} ${GREEN}${label} complete${RESET}`,
      );
      if (event.data.text) {
        console.log();
        // Indent agent response
        const lines = event.data.text.split("\n");
        for (const line of lines.slice(0, 30)) {
          console.log(`  ${DIM}${line}${RESET}`);
        }
        if (lines.length > 30) {
          console.log(`  ${DIM}... (${lines.length - 30} more lines)${RESET}`);
        }
        console.log();
      }
      break;

    case "phase_end":
      // Nothing extra — agent_response already printed output
      break;

    case "error":
      process.stdout.write("\r\x1b[K");
      console.log(`  ${RED}Error (${label}): ${event.data.error}${RESET}`);
      break;
  }
}

export function printBuildResult(opts: {
  buildId: string;
  filesCreated: string[];
  workspacePath: string;
  duration: number;
  success: boolean;
}): void {
  console.log();
  if (opts.success) {
    console.log(`  ${GREEN}${BOLD}Build complete!${RESET}`);
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

  const secs = Math.round(opts.duration / 1000);
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  const timeStr = mins > 0 ? `${mins}m ${remSecs}s` : `${secs}s`;

  console.log(`  ${BOLD}Time:${RESET}  ${timeStr}`);
  console.log(`  ${BOLD}Audit:${RESET} ${opts.buildId}`);
  console.log();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/aegis/ui/terminal.ts
git commit -m "feat(aegis): add terminal UI helpers for build output"
```

---

### Task 7: Build Command

**Files:**

- Create: `src/aegis/commands/build.ts`
- Modify: `src/aegis/cli.ts`

- [ ] **Step 1: Implement the build command**

Create `src/aegis/commands/build.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { SequentialProtocol } from "../coordinator/sequential.js";
import type { AgentEvent } from "../coordinator/types.js";
import {
  createAuditEntry,
  writeAuditEntry,
  loadChain,
  type AuditPhase,
} from "../security/audit.js";
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
  // Ensure directories exist
  mkdirSync(AEGIS_DIR, { recursive: true });
  mkdirSync(AUDIT_DIR, { recursive: true });
  mkdirSync(WORKSPACE_BASE, { recursive: true });

  // Acquire lock
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

  try {
    let phaseIndex = 0;

    for await (const event of protocol.execute({
      prompt,
      buildId,
      workspacePath,
    })) {
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

  // Write audit entry
  const chain = loadChain(AUDIT_DIR);
  const prevHash = chain.length > 0 ? chain[chain.length - 1].hash : "";

  const entry = createAuditEntry({
    buildId,
    prompt,
    agents: protocol.agents,
    phases,
    result: success ? "success" : "error",
    filesCreated,
    duration: Math.round(duration / 1000),
    prevHash,
  });
  writeAuditEntry(AUDIT_DIR, entry);

  printBuildResult({
    buildId,
    filesCreated,
    workspacePath,
    duration,
    success,
  });

  if (!success) {
    process.exit(1);
  }
}
```

- [ ] **Step 2: Wire the build command into CLI**

Replace `src/aegis/cli.ts` with:

```typescript
import { Command } from "commander";
import { buildCommand } from "./commands/build.js";

const program = new Command();

program.name("aegis").description("AEGIS — Multi-agent orchestration platform").version("0.1.0");

program
  .command("build")
  .description("Build a project using Architect + Builder agents")
  .argument("<prompt>", "What to build")
  .action(async (prompt: string) => {
    await buildCommand(prompt);
  });

program
  .command("status")
  .description("Show AEGIS status")
  .action(async () => {
    console.log("[aegis] Status: not yet implemented");
  });

await program.parseAsync(process.argv);
```

- [ ] **Step 3: Build and smoke test**

```bash
cd /home/habbaba/Documents/aegis-runtime
npx tsdown
node bin/aegis --help
node bin/aegis build --help
```

Expected: Help shows `build <prompt>` command with description.

- [ ] **Step 4: Commit**

```bash
git add src/aegis/commands/build.ts src/aegis/cli.ts
git commit -m "feat(aegis): implement build command with audit trail and lockfile"
```

---

## Chunk 3: Remaining Commands (Tasks 8-12)

### Task 8: Run Command

**Files:**

- Create: `src/aegis/commands/run.ts`
- Modify: `src/aegis/cli.ts`

- [ ] **Step 1: Implement run command**

Create `src/aegis/commands/run.ts`:

```typescript
import { runAgent } from "../gateway/client.js";

export async function runCommand(message: string, opts: { agent?: string }): Promise<void> {
  const agentId = opts.agent ?? "main";

  console.log(`\n  Running agent: ${agentId}\n`);

  try {
    const result = await runAgent({
      agentId,
      message,
    });

    if (result.text) {
      console.log(result.text);
    } else {
      console.log("  No response from agent.");
    }
    console.log();
  } catch (err) {
    console.error(`  Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
```

- [ ] **Step 2: Add run command to CLI**

Add to `src/aegis/cli.ts` (after the build command):

```typescript
import { runCommand } from "./commands/run.js";

// ... after program.command("build") block:

program
  .command("run")
  .description("Run a single agent")
  .argument("<message>", "Message to send to the agent")
  .option("--agent <id>", "Agent to use", "main")
  .action(async (message: string, opts: { agent?: string }) => {
    await runCommand(message, opts);
  });
```

- [ ] **Step 3: Build and verify**

```bash
npx tsdown
node bin/aegis run --help
```

Expected: Shows run command with `--agent` option.

- [ ] **Step 4: Commit**

```bash
git add src/aegis/commands/run.ts src/aegis/cli.ts
git commit -m "feat(aegis): add run command for single agent execution"
```

---

### Task 9: Agents Command

**Files:**

- Create: `src/aegis/commands/agents.ts`
- Modify: `src/aegis/cli.ts`

- [ ] **Step 1: Implement agents command**

Create `src/aegis/commands/agents.ts`:

```typescript
import { loadConfig } from "../../config/config.js";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

export async function agentsList(): Promise<void> {
  const cfg = loadConfig();
  const agents = cfg.agents?.list ?? [];

  console.log(`\n  ${BOLD}Configured Agents${RESET}\n`);

  if (agents.length === 0) {
    console.log("  No agents configured.");
    console.log();
    return;
  }

  for (const agent of agents) {
    const id = agent.id ?? "unknown";
    const agentDir = join(homedir(), ".openclaw", "agents", id, "agent");
    const soulPath = join(agentDir, "SOUL.md");
    const hasSoul = existsSync(soulPath);
    const soulPreview = hasSoul
      ? readFileSync(soulPath, "utf-8").split("\n")[0].slice(0, 60)
      : "no SOUL.md";

    console.log(`  ${GREEN}${id}${RESET}`);
    console.log(`    ${DIM}${soulPreview}${RESET}`);
  }
  console.log();
}

const AGENT_TEMPLATES: Record<string, string> = {
  security: [
    "You are the Security Reviewer Agent. You review code for vulnerabilities.",
    "",
    "## Your Focus",
    "- OWASP Top 10 vulnerabilities",
    "- SQL injection, XSS, CSRF",
    "- Authentication and authorization flaws",
    "- Insecure dependencies",
    "- Secrets exposure",
    "",
    "## How You Work",
    "1. Read the code in /workspace",
    "2. Identify security issues",
    "3. Write SECURITY-REVIEW.md with findings and severity ratings",
    "4. Suggest fixes for each issue",
  ].join("\n"),
  qa: [
    "You are the QA Agent. You write comprehensive tests.",
    "",
    "## Your Focus",
    "- Edge cases and boundary conditions",
    "- Error handling paths",
    "- Integration between components",
    "- Performance concerns",
    "",
    "## How You Work",
    "1. Read the code in /workspace",
    "2. Write test files for every module",
    "3. Run the tests and fix failures",
    "4. Write QA-REPORT.md with coverage summary",
  ].join("\n"),
  researcher: [
    "You are the Researcher Agent. You gather information and analyze APIs.",
    "",
    "## Your Focus",
    "- Finding relevant APIs and services",
    "- Evaluating technology options",
    "- Benchmarking and comparison",
    "",
    "## How You Work",
    "1. Research the topic using web search",
    "2. Find real, working API endpoints",
    "3. Write RESEARCH.md with findings, URLs, and code examples",
  ].join("\n"),
};

export async function agentsAdd(name: string, opts: { template?: string }): Promise<void> {
  const agentDir = join(homedir(), ".openclaw", "agents", name, "agent");

  if (existsSync(agentDir)) {
    console.error(`  Agent "${name}" already exists at ${agentDir}`);
    process.exit(1);
  }

  mkdirSync(agentDir, { recursive: true });

  const templateName = opts.template ?? name;
  const soul = AGENT_TEMPLATES[templateName];

  if (soul) {
    writeFileSync(join(agentDir, "SOUL.md"), soul + "\n");
    console.log(`  Created agent "${name}" with ${templateName} template`);
  } else {
    const defaultSoul = `You are the ${name} agent.\n\nDescribe your role and capabilities here.\n`;
    writeFileSync(join(agentDir, "SOUL.md"), defaultSoul);
    console.log(`  Created agent "${name}" with default SOUL.md`);
    console.log(`  Edit: ${join(agentDir, "SOUL.md")}`);
  }

  console.log();
  console.log(
    `  NOTE: To complete setup, add the agent to ~/.openclaw/openclaw.json agents.list[]`,
  );
  console.log(`  Available templates: ${Object.keys(AGENT_TEMPLATES).join(", ")}`);
  console.log();
}
```

- [ ] **Step 2: Add agents command to CLI**

Add to `src/aegis/cli.ts`:

```typescript
import { agentsList, agentsAdd } from "./commands/agents.js";

const agentsCmd = program.command("agents").description("Manage agents");

agentsCmd
  .command("list")
  .description("List configured agents")
  .action(async () => {
    await agentsList();
  });

agentsCmd
  .command("add")
  .description("Create a new agent")
  .argument("<name>", "Agent name/ID")
  .option("--template <name>", "Use a built-in template (security, qa, researcher)")
  .action(async (name: string, opts: { template?: string }) => {
    await agentsAdd(name, opts);
  });
```

- [ ] **Step 3: Build and verify**

```bash
npx tsdown
node bin/aegis agents list
node bin/aegis agents add --help
```

Expected: Lists architect and main agents. Add shows help.

- [ ] **Step 4: Commit**

```bash
git add src/aegis/commands/agents.ts src/aegis/cli.ts
git commit -m "feat(aegis): add agents list/add commands with templates"
```

---

### Task 10: Start & Status Commands

**Files:**

- Create: `src/aegis/commands/start.ts`
- Create: `src/aegis/commands/status.ts`
- Modify: `src/aegis/cli.ts`

- [ ] **Step 1: Implement start command**

Create `src/aegis/commands/start.ts`:

```typescript
import { spawn } from "node:child_process";
import { callGateway } from "../../gateway/call.js";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../../utils/message-channel.js";

const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

// Resolve the aegis-runtime root by looking for package.json upward from cwd
function getAegisRuntimeDir(): string {
  // When installed via npm, process.env.AEGIS_RUNTIME_DIR can override
  if (process.env.AEGIS_RUNTIME_DIR) {
    return process.env.AEGIS_RUNTIME_DIR;
  }
  // Default: look for dist/entry.js relative to cwd
  const cwd = process.cwd();
  if (existsSync(resolve(cwd, "dist/entry.js"))) {
    return cwd;
  }
  // Fallback: assume standard install location
  return resolve(cwd);
}

async function isGatewayRunning(): Promise<boolean> {
  try {
    await callGateway({
      method: "health",
      timeoutMs: 3000,
      clientName: GATEWAY_CLIENT_NAMES.CLI,
      mode: GATEWAY_CLIENT_MODES.CLI,
    });
    return true;
  } catch {
    return false;
  }
}

async function waitForHealth(maxMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await isGatewayRunning()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export async function startCommand(): Promise<void> {
  if (await isGatewayRunning()) {
    console.log(`\n  ${GREEN}Gateway already running${RESET}\n`);
    return;
  }

  console.log("\n  Starting gateway...");

  const runtimeDir = getAegisRuntimeDir();
  const child = spawn("node", ["dist/entry.js", "gateway", "run"], {
    cwd: runtimeDir,
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  const healthy = await waitForHealth(15_000);

  if (healthy) {
    console.log(`  ${GREEN}Gateway started${RESET}\n`);
  } else {
    console.error("  Failed to start gateway within 15 seconds");
    process.exit(1);
  }
}
```

- [ ] **Step 2: Implement status command**

Create `src/aegis/commands/status.ts`:

```typescript
import { callGateway } from "../../gateway/call.js";
import { loadConfig } from "../../config/config.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../../utils/message-channel.js";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadChain } from "../security/audit.js";

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export async function statusCommand(): Promise<void> {
  console.log(`\n  ${BOLD}AEGIS Status${RESET}\n`);

  // Gateway
  let gatewayStatus: string;
  try {
    await callGateway({
      method: "health",
      timeoutMs: 3000,
      clientName: GATEWAY_CLIENT_NAMES.CLI,
      mode: GATEWAY_CLIENT_MODES.CLI,
    });
    gatewayStatus = `${GREEN}running${RESET}`;
  } catch {
    gatewayStatus = `${RED}not running${RESET}`;
  }
  console.log(`  ${BOLD}Gateway:${RESET}    ${gatewayStatus}`);

  // Agents
  const cfg = loadConfig();
  const agents = cfg.agents?.list ?? [];
  const agentIds = agents.map((a: { id?: string }) => a.id ?? "unknown").join(", ");
  console.log(`  ${BOLD}Agents:${RESET}     ${agents.length} configured (${agentIds})`);

  // Add-ons
  const addonsDir = join(homedir(), ".aegis", "addons");
  let addonCount = 0;
  if (existsSync(addonsDir)) {
    addonCount = readdirSync(addonsDir).filter((f) => f.endsWith(".json")).length;
  }
  console.log(`  ${BOLD}Add-ons:${RESET}    ${addonCount} installed`);

  // Workspace
  const workspace = cfg.agents?.defaults?.workspace ?? join(homedir(), ".openclaw", "workspace");
  console.log(`  ${BOLD}Workspace:${RESET}  ${workspace}`);

  // Last build
  const auditDir = join(homedir(), ".aegis", "audit");
  const chain = loadChain(auditDir);
  if (chain.length > 0) {
    const last = chain[chain.length - 1];
    console.log(`  ${BOLD}Last build:${RESET} ${last.buildId} ${DIM}(${last.timestamp})${RESET}`);
  } else {
    console.log(`  ${BOLD}Last build:${RESET} ${DIM}none${RESET}`);
  }

  console.log();
}
```

- [ ] **Step 3: Wire both into CLI**

Add to `src/aegis/cli.ts`:

```typescript
import { startCommand } from "./commands/start.js";
import { statusCommand } from "./commands/status.js";

program
  .command("start")
  .description("Start the AEGIS gateway")
  .action(async () => {
    await startCommand();
  });

// Replace the existing status stub:
program
  .command("status")
  .description("Show AEGIS status")
  .action(async () => {
    await statusCommand();
  });
```

- [ ] **Step 4: Build and verify**

```bash
npx tsdown
node bin/aegis status
node bin/aegis start --help
```

Expected: Status shows gateway status, agents, add-ons count, workspace path.

- [ ] **Step 5: Commit**

```bash
git add src/aegis/commands/start.ts src/aegis/commands/status.ts src/aegis/cli.ts
git commit -m "feat(aegis): add start and status commands"
```

---

### Task 11: MCP Addon System

**Files:**

- Create: `src/aegis/addons/registry.ts`
- Create: `src/aegis/addons/installer.ts`
- Create: `src/aegis/addons/registry.test.ts`
- Create: `src/aegis/commands/addon.ts`
- Modify: `src/aegis/cli.ts`

- [ ] **Step 1: Write failing test for registry**

Create `src/aegis/addons/registry.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { getAddonConfig, listAvailableAddons } from "./registry.js";

describe("addon registry", () => {
  it("lists available addons", () => {
    const addons = listAvailableAddons();
    expect(addons).toContain("slack");
    expect(addons).toContain("github");
  });

  it("returns config for known addon", () => {
    const config = getAddonConfig("slack");
    expect(config).not.toBeNull();
    expect(config!.name).toBe("slack");
    expect(config!.requires).toContain("SLACK_BOT_TOKEN");
    expect(config!.mcpServer.command).toBe("npx");
  });

  it("returns null for unknown addon", () => {
    const config = getAddonConfig("nonexistent");
    expect(config).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/aegis/addons/registry.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the registry**

Note: Configs are inlined as objects rather than read from JSON files on disk. This avoids `import.meta.url` / `fileURLToPath` issues after tsdown bundles everything into a single `dist/aegis/cli.js`.

Create `src/aegis/addons/registry.ts`:

```typescript
export interface AddonConfig {
  name: string;
  description: string;
  permissions: string[];
  requires: string[];
  mcpServer: {
    command: string;
    args: string[];
    env: Record<string, string>;
  };
}

const BUILTIN_ADDONS: Record<string, AddonConfig> = {
  slack: {
    name: "slack",
    description: "Post messages and read channels via Slack",
    permissions: ["network:hooks.slack.com", "read:channels", "write:messages"],
    requires: ["SLACK_BOT_TOKEN"],
    mcpServer: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack"],
      env: { SLACK_BOT_TOKEN: "${SLACK_BOT_TOKEN}" },
    },
  },
  github: {
    name: "github",
    description: "Create PRs, issues, read repos via GitHub",
    permissions: ["network:api.github.com", "read:repos", "write:issues", "write:pulls"],
    requires: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
    mcpServer: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}" },
    },
  },
};

export function listAvailableAddons(): string[] {
  return Object.keys(BUILTIN_ADDONS);
}

export function getAddonConfig(name: string): AddonConfig | null {
  return BUILTIN_ADDONS[name] ?? null;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/aegis/addons/registry.test.ts
```

Expected: All 3 tests PASS.

- [ ] **Step 6: Implement the installer**

Create `src/aegis/addons/installer.ts`:

```typescript
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import type { AddonConfig } from "./registry.js";

const ADDONS_DIR = join(homedir(), ".aegis", "addons");
const SECRETS_DIR = join(homedir(), ".aegis", "secrets");

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function installAddon(config: AddonConfig): Promise<boolean> {
  mkdirSync(ADDONS_DIR, { recursive: true });
  mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });

  const installedPath = join(ADDONS_DIR, `${config.name}.json`);
  if (existsSync(installedPath)) {
    console.log(`  Add-on "${config.name}" is already installed.`);
    return false;
  }

  // Show permissions
  console.log(`\n  Installing: ${config.name}`);
  console.log(`  ${config.description}\n`);
  console.log("  Permissions requested:");
  for (const perm of config.permissions) {
    console.log(`    - ${perm}`);
  }
  console.log();

  // Confirm
  const confirm = await prompt("  Install? (y/n) ");
  if (confirm.toLowerCase() !== "y") {
    console.log("  Cancelled.");
    return false;
  }

  // Collect credentials
  const secrets: Record<string, string> = {};
  for (const key of config.requires) {
    const value = await prompt(`  ${key}: `);
    if (!value) {
      console.log(`  ${key} is required. Cancelled.`);
      return false;
    }
    secrets[key] = value;
  }

  // Save secrets (0600 permissions)
  const secretsPath = join(SECRETS_DIR, `${config.name}.env`);
  const envContent =
    Object.entries(secrets)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n";
  writeFileSync(secretsPath, envContent, { mode: 0o600 });

  // Save addon config
  writeFileSync(installedPath, JSON.stringify(config, null, 2) + "\n");

  console.log(`\n  Add-on "${config.name}" installed successfully.`);
  console.log(`  Credentials saved to ${secretsPath}\n`);
  return true;
}

export function removeAddon(name: string): boolean {
  const installedPath = join(ADDONS_DIR, `${name}.json`);
  const secretsPath = join(SECRETS_DIR, `${name}.env`);

  if (!existsSync(installedPath)) {
    console.log(`  Add-on "${name}" is not installed.`);
    return false;
  }

  unlinkSync(installedPath);
  if (existsSync(secretsPath)) {
    unlinkSync(secretsPath);
  }

  console.log(`  Add-on "${name}" removed.`);
  return true;
}

export function listInstalledAddons(): string[] {
  if (!existsSync(ADDONS_DIR)) return [];
  return readdirSync(ADDONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""));
}
```

- [ ] **Step 7: Implement addon command**

Create `src/aegis/commands/addon.ts`:

```typescript
import { getAddonConfig, listAvailableAddons } from "../addons/registry.js";
import { installAddon, removeAddon, listInstalledAddons } from "../addons/installer.js";

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export async function addonAdd(name: string): Promise<void> {
  const config = getAddonConfig(name);
  if (!config) {
    const available = listAvailableAddons();
    console.error(`  Unknown add-on: "${name}"`);
    console.error(`  Available: ${available.join(", ")}`);
    process.exit(1);
  }

  await installAddon(config);
}

export async function addonList(): Promise<void> {
  const available = listAvailableAddons();
  const installed = listInstalledAddons();

  console.log(`\n  ${BOLD}Add-ons${RESET}\n`);

  for (const name of available) {
    const config = getAddonConfig(name);
    const isInstalled = installed.includes(name);
    const status = isInstalled ? `${GREEN}installed${RESET}` : `${DIM}available${RESET}`;
    console.log(
      `  ${isInstalled ? GREEN : ""}${name}${RESET} — ${config?.description ?? ""} [${status}]`,
    );
  }
  console.log();
}

export async function addonRemove(name: string): Promise<void> {
  removeAddon(name);
}
```

- [ ] **Step 8: Wire addon command into CLI**

Add to `src/aegis/cli.ts`:

```typescript
import { addonAdd, addonList, addonRemove } from "./commands/addon.js";

const addonCmd = program.command("addon").description("Manage MCP add-ons");

addonCmd
  .command("add")
  .description("Install an MCP add-on")
  .argument("<name>", "Add-on name (e.g., slack, github)")
  .action(async (name: string) => {
    await addonAdd(name);
  });

addonCmd
  .command("list")
  .description("List available and installed add-ons")
  .action(async () => {
    await addonList();
  });

addonCmd
  .command("remove")
  .description("Remove an installed add-on")
  .argument("<name>", "Add-on name")
  .action(async (name: string) => {
    await addonRemove(name);
  });
```

- [ ] **Step 9: Build and verify**

```bash
npx tsdown
node bin/aegis addon list
node bin/aegis addon add --help
```

Expected: Lists slack and github as available. Add shows help.

- [ ] **Step 10: Commit**

```bash
git add src/aegis/addons/ src/aegis/commands/addon.ts src/aegis/cli.ts
git commit -m "feat(aegis): add MCP addon system with registry and installer"
```

---

### Task 12: Final CLI Assembly & Integration Test

**Files:**

- Modify: `src/aegis/cli.ts` (final version with all commands)
- Create: `src/aegis/cli.test.ts`

- [ ] **Step 1: Write the complete cli.ts**

Replace `src/aegis/cli.ts` with the final assembled version containing all imports and commands:

```typescript
import { Command } from "commander";
import { buildCommand } from "./commands/build.js";
import { runCommand } from "./commands/run.js";
import { agentsList, agentsAdd } from "./commands/agents.js";
import { addonAdd, addonList, addonRemove } from "./commands/addon.js";
import { startCommand } from "./commands/start.js";
import { statusCommand } from "./commands/status.js";

const program = new Command();

program.name("aegis").description("AEGIS — Multi-agent orchestration platform").version("0.1.0");

// Primary commands
program
  .command("build")
  .description("Build a project using Architect + Builder agents")
  .argument("<prompt>", "What to build")
  .action(async (prompt: string) => {
    await buildCommand(prompt);
  });

program
  .command("run")
  .description("Run a single agent")
  .argument("<message>", "Message to send to the agent")
  .option("--agent <id>", "Agent to use", "main")
  .action(async (message: string, opts: { agent?: string }) => {
    await runCommand(message, opts);
  });

// Agent management
const agentsCmd = program.command("agents").description("Manage agents");

agentsCmd
  .command("list")
  .description("List configured agents")
  .action(async () => {
    await agentsList();
  });

agentsCmd
  .command("add")
  .description("Create a new agent")
  .argument("<name>", "Agent name/ID")
  .option("--template <name>", "Use a built-in template (security, qa, researcher)")
  .action(async (name: string, opts: { template?: string }) => {
    await agentsAdd(name, opts);
  });

// MCP Add-ons
const addonCmd = program.command("addon").description("Manage MCP add-ons");

addonCmd
  .command("add")
  .description("Install an MCP add-on")
  .argument("<name>", "Add-on name (e.g., slack, github)")
  .action(async (name: string) => {
    await addonAdd(name);
  });

addonCmd
  .command("list")
  .description("List available and installed add-ons")
  .action(async () => {
    await addonList();
  });

addonCmd
  .command("remove")
  .description("Remove an installed add-on")
  .argument("<name>", "Add-on name")
  .action(async (name: string) => {
    await addonRemove(name);
  });

// Infrastructure
program
  .command("start")
  .description("Start the AEGIS gateway")
  .action(async () => {
    await startCommand();
  });

program
  .command("status")
  .description("Show AEGIS status")
  .action(async () => {
    await statusCommand();
  });

await program.parseAsync(process.argv);
```

- [ ] **Step 2: Write CLI registration test**

Create `src/aegis/cli.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const AEGIS_RUNTIME_DIR = join(import.meta.dirname, "..", "..");
const BIN = join(AEGIS_RUNTIME_DIR, "bin", "aegis");

describe("aegis CLI", () => {
  it("shows help with all expected commands", () => {
    const output = execFileSync("node", [BIN, "--help"], {
      encoding: "utf-8",
      cwd: AEGIS_RUNTIME_DIR,
    });

    expect(output).toContain("AEGIS");
    expect(output).toContain("build");
    expect(output).toContain("run");
    expect(output).toContain("agents");
    expect(output).toContain("addon");
    expect(output).toContain("start");
    expect(output).toContain("status");
  });

  it("shows version", () => {
    const output = execFileSync("node", [BIN, "--version"], {
      encoding: "utf-8",
      cwd: AEGIS_RUNTIME_DIR,
    });

    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 3: Run all AEGIS tests**

```bash
cd /home/habbaba/Documents/aegis-runtime
npx vitest run src/aegis/
```

Expected: All tests pass (gateway client, audit, lock, sequential protocol, registry, cli).

- [ ] **Step 4: Build and full smoke test**

```bash
npx tsdown
node bin/aegis --help
node bin/aegis build --help
node bin/aegis run --help
node bin/aegis agents --help
node bin/aegis addon --help
node bin/aegis start --help
node bin/aegis status
```

Expected: All commands show proper help text. Status shows current state.

- [ ] **Step 5: Commit**

```bash
git add src/aegis/
git commit -m "feat(aegis): complete CLI with all commands assembled"
```

---

## Chunk 4: End-to-End Validation (Task 13)

### Task 13: Live Integration Test

This task requires the gateway to be running. It validates the full `aegis build` flow.

- [ ] **Step 1: Ensure gateway is running**

```bash
cd /home/habbaba/Documents/aegis-runtime
node dist/entry.js gateway run &
sleep 3
node bin/aegis status
```

Expected: Status shows gateway running, 2 agents configured.

- [ ] **Step 2: Test aegis run (single agent)**

```bash
node bin/aegis run "Hello, are you working?" --agent main
```

Expected: Agent responds with text output.

- [ ] **Step 3: Test aegis build (two-agent workflow)**

```bash
node bin/aegis build "Build a simple Python web server that returns JSON with the current time at /api/time"
```

Expected:

- Architect phase runs, creates SPEC.md
- Builder phase runs, creates Python files
- Build summary shows files created
- Audit entry written to `~/.aegis/audit/`
- Files in `~/.openclaw/workspace/builds/<build-id>/`

- [ ] **Step 4: Verify audit trail**

```bash
ls ~/.aegis/audit/builds/
cat ~/.aegis/audit/chain.json
```

Expected: Build entry exists with valid hash chain.

- [ ] **Step 5: Test agents list**

```bash
node bin/aegis agents list
```

Expected: Shows architect and main agents with SOUL.md preview.

- [ ] **Step 6: Test addon list**

```bash
node bin/aegis addon list
```

Expected: Shows slack and github as available.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat(aegis): Phase 1.1 complete — aegis CLI with two-agent build workflow"
```
