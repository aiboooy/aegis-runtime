# AEGIS CLI Wrapper — Design Spec

**Date:** 2026-03-16
**Status:** Draft
**Phase:** 1.1

## Overview

Build `aegis` — a CLI that orchestrates multi-agent workflows on top of the OpenClaw runtime. The MVP ships a two-agent sequential workflow (Architect -> Builder). The architecture is designed to scale to N-agent teams with discussion protocols, while keeping all AEGIS code cleanly separated from OpenClaw source.

## Problem

OpenClaw is a single-agent tool. Every AI coding product today (Cursor, Devin, Claude Code) runs one agent per task. This produces "first draft" code from a single perspective. A team of specialized agents that collaborate — like a real engineering team — catches more bugs, produces better architecture, and handles complex projects that overwhelm a single agent.

## Solution

A standalone Node.js CLI (`bin/aegis`) that:

1. Orchestrates multi-agent workflows through the OpenClaw gateway
2. Ships with a curated MCP add-on system for easy integrations (Slack, GitHub, etc.)
3. Produces a hash-chain audit trail for every build
4. Is designed for future expansion to N-agent teams with discussion protocols

## Architecture

```
+-------------------------------+
|  bin/aegis  (AEGIS CODE)      |  -- CLI, orchestration, teams, discussion
|  +-------------------------+  |
|  | Agent Coordinator       |  |  -- Decides which agents run, in what order
|  | Discussion Protocol     |  |  -- Future: agents talk to each other
|  | Security Layer          |  |  -- Audit logging, sandbox enforcement
|  | MCP Add-on System       |  |  -- Plug-and-play integrations
|  +-------------------------+  |
+-------------------------------+
|  OpenClaw Gateway (theirs)    |  -- Single-agent execution engine
|  Agent Runner, Tools, etc.    |
+-------------------------------+
```

All AEGIS code lives in `src/aegis/`. Zero modifications to OpenClaw source files. This ensures clean upstream merges and clear ownership boundaries.

## CLI Commands

### Primary

```bash
# Two-agent build (the killer feature)
aegis build "Build a crypto dashboard with real-time prices"

# Single agent run
aegis run "Research Bitcoin APIs" --agent architect
aegis run "Fix the login bug" --agent main
```

### Agent Management

```bash
aegis agents list
aegis agents add security
```

### MCP Add-ons

```bash
aegis addon add slack              # install Slack MCP server
aegis addon add github             # install GitHub MCP server
aegis addon add custom ./my-server # install custom MCP server
aegis addon list                   # show installed add-ons
aegis addon remove slack           # remove an add-on
```

### Infrastructure

```bash
aegis start                      # start gateway + docker services
aegis status                     # health check
```

### Future (designed for, not built yet)

```bash
aegis build "..." --team fintech
aegis discuss "REST or GraphQL?" --agents architect,security
```

## Gateway Communication

AEGIS communicates with agents through OpenClaw's existing gateway RPC. The gateway uses a WebSocket JSON-RPC protocol. Our wrapper reuses the existing `callGateway()` function from `src/gateway/call.ts`.

### How a single agent call works

Based on actual OpenClaw code (`src/commands/agent-via-gateway.ts`):

```typescript
import { callGateway, randomIdempotencyKey } from "../gateway/call.js";

const response = await callGateway<GatewayAgentResponse>({
  method: "agent",
  params: {
    message: body,
    agentId: "architect",
    sessionKey,
    thinking: "medium",
    deliver: false,
    timeout: 600, // seconds
    idempotencyKey: randomIdempotencyKey(),
    extraSystemPrompt: "...", // per-run instructions
  },
  expectFinal: true, // wait past "accepted" for final result
  timeoutMs: 630_000, // gateway-level timeout (agent timeout + 30s buffer)
  clientName: "cli",
  mode: "cli",
});
```

Key protocol details:

- `callGateway()` opens a WebSocket, authenticates with the gateway token, sends a JSON-RPC request, and waits for the response
- `expectFinal: true` means the client ignores interim `{ status: "accepted" }` acks and waits for the terminal response containing the agent's output
- Response shape: `{ runId, status, summary, result: { payloads: [{ text }] } }`
- Gateway connection details are read from `~/.openclaw/openclaw.json`: port (`gateway.port`, default 18789), auth token (`gateway.auth.token`), bind address (`gateway.bind`)

### AEGIS gateway wrapper

`src/aegis/gateway/client.ts` wraps this into a simpler interface:

```typescript
import { callGateway, randomIdempotencyKey } from "../../gateway/call.js";
import { loadConfig } from "../../config/config.js";
import { resolveSessionKeyForRequest } from "../../commands/agent/session.js";

interface AgentRunOpts {
  agentId: string;
  message: string;
  timeoutSeconds?: number; // default 600
  extraSystemPrompt?: string; // injected per-run
}

interface AgentRunResult {
  runId: string;
  status: string;
  text: string; // concatenated payload text
  summary?: string;
}

async function runAgent(opts: AgentRunOpts): Promise<AgentRunResult> {
  const cfg = loadConfig();
  const timeoutSeconds = opts.timeoutSeconds ?? 600;
  const sessionKey = resolveSessionKeyForRequest({
    cfg,
    agentId: opts.agentId,
  }).sessionKey;

  const response = await callGateway({
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
    clientName: "cli",
    mode: "cli",
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

### Streaming (MVP approach)

For the MVP, the terminal shows an indeterminate progress spinner during each agent phase (matching OpenClaw's existing `withProgress()` pattern). The agent's full output is displayed after each phase completes.

Future enhancement: subscribe to gateway broadcast events via the `GatewayClient` class's `onEvent` callback to stream real-time text deltas during agent execution.

## Workspace Strategy

### The problem

OpenClaw's workspace is configured per-agent in `openclaw.json` under `agents.defaults.workspace` (currently `~/.openclaw/workspace/`). Both agents share this workspace, which is how the Architect's SPEC.md is visible to the Builder. We need per-build isolation without breaking this shared-workspace mechanism.

### Solution: subdirectories within the shared workspace

Each build creates a subdirectory within the existing shared workspace:

```
~/.openclaw/workspace/
  builds/
    2026-03-16-a1b2c3d4/     # build workspace
      SPEC.md                 # written by Architect
      server.py               # written by Builder
      index.html              # written by Builder
    2026-03-16-e5f6g7h8/     # another build
```

The `extraSystemPrompt` parameter (already supported by the gateway's agent RPC) injects per-run instructions telling each agent to work within a specific subdirectory:

```
Architect extraSystemPrompt:
  "Work in the directory /home/habbaba/.openclaw/workspace/builds/2026-03-16-a1b2c3d4/.
   Write all files there. Write your specification to SPEC.md in that directory."

Builder extraSystemPrompt:
  "Work in the directory /home/habbaba/.openclaw/workspace/builds/2026-03-16-a1b2c3d4/.
   Read SPEC.md from that directory and implement everything there."
```

This approach:

- Does NOT modify `openclaw.json` (no race conditions)
- Does NOT require a new workspace config mechanism
- Uses the existing `extraSystemPrompt` field that the gateway already supports
- Agents share the same parent workspace so file access works
- Each build is isolated by convention (different subdirectory)

### Concurrent builds

Builds are serialized in the MVP via a lockfile at `~/.aegis/build.lock`. If a build is already running, a second `aegis build` waits with a message: "Another build is in progress. Waiting..."

The lockfile contains the PID of the owning process. On startup, AEGIS checks if the PID is still alive (stale lock detection).

Future: concurrent builds are safe because each uses a different workspace subdirectory and session key. The only shared resource is the audit hash chain, which can be serialized with a simple file lock on `~/.aegis/audit/chain.json`.

## `aegis build` Workflow

### Step 1: Validate & Prepare

- Verify gateway is reachable (health check via `callGateway({ method: "health" })`)
- Acquire build lock (`~/.aegis/build.lock`)
- Generate build ID: `YYYY-MM-DD-{nanoid(8)}` (e.g., `2026-03-16-a1b2c3d4`)
- Create workspace subdirectory: `~/.openclaw/workspace/builds/{build-id}/`
- Start audit log entry with timestamp and prompt

### Step 2: Architect Phase

- Call `runAgent()` with:
  - `agentId: "architect"`
  - `message`: the user's prompt, prefixed with design instructions
  - `extraSystemPrompt`: directory instructions pointing to the build workspace
  - `timeoutSeconds: 600` (10 min)
- Show indeterminate spinner: `[1/2] Architect designing...`
- On completion, display Architect's response text
- Verify SPEC.md exists in the build workspace directory (check filesystem)
- **Failure conditions:**
  - Gateway error (connection refused, auth failure) -> show error, exit 1
  - Agent timeout (>10 min) -> show timeout error, exit 1
  - Agent completes but SPEC.md is missing or empty -> show "Architect did not produce a spec", exit 1
  - Agent returns error status -> show agent error text, exit 1

### Step 3: Builder Phase

- Call `runAgent()` with:
  - `agentId: "main"` (the builder agent)
  - `message`: instructions to implement from SPEC.md
  - `extraSystemPrompt`: directory instructions pointing to the build workspace
  - `timeoutSeconds: 600`
- Show indeterminate spinner: `[2/2] Builder implementing...`
- On completion, display Builder's response text
- **Failure conditions:**
  - Same as Architect (gateway error, timeout, agent error)
  - Builder completes but no files created -> show warning (non-fatal, the agent may have written to a different location)

### Step 4: Result

- List files created in the build workspace (recursive directory listing)
- Show summary: file count, build duration, build ID
- Write audit entry (see Security section)
- Release build lock
- Exit 0

### Key Design Decisions

- **Subdirectory isolation:** Each build gets its own subdirectory within the shared workspace. No config changes needed.
- **SPEC.md handoff:** The coordination protocol between agents. Simple, debuggable, human-readable.
- **Fail-fast:** If Architect fails or produces no spec, don't run Builder.
- **extraSystemPrompt injection:** Per-run instructions without modifying agent SOUL.md or config.

## Agent Configuration

### Default agents

AEGIS requires two agents configured in `~/.openclaw/openclaw.json` under `agents.list[]`:

```json
{
  "agents": {
    "defaults": {
      "model": { "primary": "custom-localhost-8317/supervisor-model" },
      "workspace": "/home/habbaba/.openclaw/workspace"
    },
    "list": [
      {
        "id": "main"
      },
      {
        "id": "architect",
        "name": "architect",
        "workspace": "/home/habbaba/.openclaw/workspace",
        "agentDir": "/home/habbaba/.openclaw/agents/architect/agent"
      }
    ]
  }
}
```

Agent system prompts (SOUL.md) are stored in agent directories:

- Architect: `~/.openclaw/agents/architect/agent/SOUL.md`
- Builder: `~/.openclaw/agents/main/agent/SOUL.md`

### `aegis agents add <name>`

Creates a new agent by:

1. Creating the agent directory: `~/.openclaw/agents/<name>/agent/`
2. Writing a SOUL.md with the role's system prompt (from a built-in template)
3. Adding an entry to `openclaw.json` `agents.list[]`

Built-in agent templates (for future expansion):

- `security` — reviews code for vulnerabilities, checks OWASP top 10
- `qa` — writes tests, validates edge cases
- `researcher` — web research, API discovery

MVP ships with `architect` and `main` already configured. `aegis agents add` is MVP scope but only the manual path (user provides SOUL.md content or picks from templates).

## `aegis start` and `aegis status`

### `aegis start`

Starts the OpenClaw gateway if not already running:

```typescript
async function start() {
  // 1. Check if gateway is already running
  try {
    await callGateway({ method: "health", timeoutMs: 3000 });
    log("Gateway already running on port 18789");
    return;
  } catch {
    // Not running, start it
  }

  // 2. Start gateway as detached child process
  const child = spawn("node", ["dist/entry.js", "gateway", "run"], {
    cwd: AEGIS_RUNTIME_DIR,
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  // 3. Wait for gateway to become healthy (poll health endpoint, max 15s)
  await waitForHealth(15_000);
  log("Gateway started on port 18789");
}
```

Does NOT start Docker services in MVP. Docker services (PostgreSQL, Redis) are a separate concern managed by `docker compose -f docker-compose.aegis.yml up -d`. Future: `aegis start --full` starts everything.

### `aegis status`

```bash
$ aegis status

  AEGIS Status
  Gateway:    running (port 18789)
  Agents:     2 configured (architect, main)
  Add-ons:    1 installed (slack)
  Workspace:  ~/.openclaw/workspace/
  Last build: 2026-03-16-a1b2c3d4 (success, 2m 34s ago)
```

Checks:

- Gateway reachability (health RPC)
- Configured agents (read `openclaw.json`)
- Installed add-ons (read `~/.aegis/addons/`)
- Last build info (read latest audit entry)

## File Structure

```
aegis-runtime/
+-- bin/
|   +-- aegis                          # Entry point (chmod +x, node shebang)
|                                      # Imports compiled JS from dist/aegis/
+-- src/aegis/                         # ALL AEGIS source (TypeScript)
|   +-- cli.ts                         # Commander program, registers commands
|   +-- commands/
|   |   +-- build.ts                   # aegis build -- two-agent workflow
|   |   +-- run.ts                     # aegis run -- single agent
|   |   +-- agents.ts                  # aegis agents list/add
|   |   +-- addon.ts                   # aegis addon add/list/remove
|   |   +-- start.ts                   # aegis start
|   |   +-- status.ts                  # aegis status
|   +-- coordinator/
|   |   +-- index.ts                   # Agent Coordinator -- dispatches to protocols
|   |   +-- sequential.ts             # Sequential protocol (Architect -> Builder)
|   |   +-- types.ts                   # Protocol interface & shared types
|   +-- gateway/
|   |   +-- client.ts                  # Wraps OpenClaw's callGateway() + loadConfig()
|   +-- addons/
|   |   +-- registry.ts               # Curated MCP server registry
|   |   +-- installer.ts              # Add-on install/remove logic
|   |   +-- configs/
|   |       +-- slack.json
|   |       +-- github.json
|   |       +-- notion.json
|   |       +-- postgres.json
|   +-- security/
|   |   +-- audit.ts                   # Hash-chain audit log
|   |   +-- lock.ts                    # Build lockfile management
|   +-- ui/
|       +-- terminal.ts                # Spinners, progress, result display
+-- src/                               # OpenClaw source (UNTOUCHED)
```

### Build strategy

AEGIS TypeScript is compiled by the existing `tsdown` build pipeline (configured in `tsdown.config.ts`). We add `src/aegis/**/*.ts` to the build inputs. The compiled output lands in `dist/aegis/`.

`bin/aegis` is a thin Node.js shim:

```javascript
#!/usr/bin/env node
import "./dist/aegis/cli.js";
```

This matches the pattern used by `openclaw.mjs` (the existing entry point).

## Coordinator Protocol Interface

The Coordinator is the extensibility point for multi-agent workflows:

```typescript
// coordinator/types.ts

interface AgentEvent {
  type: "phase_start" | "phase_end" | "agent_response" | "error";
  agent: string;
  data: {
    text?: string;
    error?: string;
    filesCreated?: string[];
  };
  timestamp: string;
}

interface BuildOpts {
  prompt: string;
  buildId: string;
  workspacePath: string; // absolute path to build subdirectory
  timeoutSeconds?: number; // per-agent timeout, default 600
}

interface Protocol {
  name: string;
  agents: string[];
  execute(opts: BuildOpts): AsyncGenerator<AgentEvent>;
}
```

### SequentialProtocol (MVP)

```typescript
// coordinator/sequential.ts

class SequentialProtocol implements Protocol {
  name = "sequential";
  agents = ["architect", "main"];

  async *execute(opts: BuildOpts): AsyncGenerator<AgentEvent> {
    // Phase 1: Architect
    yield { type: "phase_start", agent: "architect", data: {}, timestamp: now() };

    const archResult = await runAgent({
      agentId: "architect",
      message: buildArchitectPrompt(opts.prompt),
      extraSystemPrompt: `Work in directory: ${opts.workspacePath}`,
      timeoutSeconds: opts.timeoutSeconds,
    });

    yield {
      type: "agent_response",
      agent: "architect",
      data: { text: archResult.text },
      timestamp: now(),
    };

    // Verify SPEC.md
    if (!existsSync(join(opts.workspacePath, "SPEC.md"))) {
      yield {
        type: "error",
        agent: "architect",
        data: { error: "Architect did not produce SPEC.md" },
        timestamp: now(),
      };
      return;
    }

    yield { type: "phase_end", agent: "architect", data: {}, timestamp: now() };

    // Phase 2: Builder
    yield { type: "phase_start", agent: "main", data: {}, timestamp: now() };

    const buildResult = await runAgent({
      agentId: "main",
      message: buildBuilderPrompt(),
      extraSystemPrompt: `Work in directory: ${opts.workspacePath}`,
      timeoutSeconds: opts.timeoutSeconds,
    });

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

Future protocols:

- `DiscussionProtocol` — agents share a message bus, take turns responding
- `ParallelProtocol` — agents work simultaneously on different parts
- `TeamProtocol` — predefined agent compositions with role-based coordination

The CLI doesn't care which protocol runs — it just consumes the AgentEvent stream.

## Security & Audit

### Hash-Chain Audit Trail

Every build produces an audit entry stored in `~/.aegis/audit/builds/{build-id}.json`:

```json
{
  "buildId": "2026-03-16-a1b2c3d4",
  "timestamp": "2026-03-16T14:30:00Z",
  "prompt": "Build a fintech dashboard",
  "agents": ["architect", "main"],
  "phases": [
    {
      "agent": "architect",
      "started": "2026-03-16T14:30:00Z",
      "completed": "2026-03-16T14:31:12Z",
      "status": "success"
    },
    {
      "agent": "main",
      "started": "2026-03-16T14:31:13Z",
      "completed": "2026-03-16T14:32:34Z",
      "status": "success"
    }
  ],
  "result": "success",
  "filesCreated": ["SPEC.md", "server.py", "index.html", "test_server.py"],
  "duration": 154,
  "prevHash": "sha256:ab12cd34...",
  "hash": "sha256:ef56gh78..."
}
```

Each entry's `hash` = SHA-256 of `JSON.stringify(entry_without_hash) + prevHash`. Tampering breaks the chain. The chain index is stored in `~/.aegis/audit/chain.json` (array of `{ buildId, hash, timestamp }`).

The hash chain is protected during concurrent writes by a file lock on `chain.json` (using the same lockfile pattern as build serialization).

### MCP Add-on Security

- Add-ons come from curated registry only (no auto-download from internet)
- Each add-on config declares:
  ```json
  {
    "name": "slack",
    "description": "Post messages, read channels",
    "permissions": ["network:hooks.slack.com", "read:channels"],
    "requires": ["SLACK_BOT_TOKEN"],
    "mcpServer": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-slack"],
      "env": { "SLACK_BOT_TOKEN": "${SLACK_BOT_TOKEN}" }
    }
  }
  ```
- `aegis addon add <name>` shows permissions and prompts for required credentials
- Credentials stored in `~/.aegis/secrets/<name>.env` with file permissions 0600
- **Known limitation:** credentials are stored as plaintext in the MVP. Encrypted storage is deferred to Enterprise tier.
- Installed add-on configs are written to `~/.aegis/addons/<name>.json`
- Add-ons are wired into agent sessions by merging their MCP server configs into the agent's tool configuration at runtime (via `extraSystemPrompt` or by modifying the agent's TOOLS.md)

### MCP server lifecycle

MCP servers are started per-build (not persistent). The `SequentialProtocol` starts configured MCP servers before the first agent phase and stops them after the last phase completes. This ensures clean state per build and no resource leaks.

## Terminal UI

MVP uses indeterminate spinners (matching OpenClaw's existing `withProgress()` pattern):

```
  AEGIS Build 2026-03-16-a1b2c3d4

  [1/2] Architect designing... (spinner)

  -- Architect complete --
  (Architect's response text displayed here)

  [2/2] Builder implementing... (spinner)

  -- Builder complete --
  (Builder's response text displayed here)

  Build complete!

  Files: 4 created in ~/.openclaw/workspace/builds/2026-03-16-a1b2c3d4/
    SPEC.md
    server.py
    index.html
    test_server.py

  Time: 2m 34s
  Audit: 2026-03-16-a1b2c3d4
```

Future enhancement: real-time streaming output by subscribing to gateway broadcast events via the `GatewayClient` class's `onEvent` callback.

## Future: Multi-Agent Army

The architecture supports scaling to N agents with discussion:

```
aegis build "Build a fintech dashboard" --team fintech

  AEGIS -- 5 agents mobilized

  Architect    -- Designing system...
  Security     -- "That API needs rate limiting"
  Backend      -- Building FastAPI server
  Frontend     -- Building React dashboard
  QA           -- Writing test plan

  -- Agent Discussion --
  Security: "CoinGecko calls should go through a proxy"
  Architect: "Good catch. Updating SPEC.md"
  Backend: "Acknowledged, implementing proxy"
```

This requires the DiscussionProtocol (shared message bus, turn-taking, conflict resolution). The Coordinator interface is already designed for this — we just add new Protocol implementations.

## What We Build Now (MVP)

1. `bin/aegis` — entry point shim
2. `src/aegis/cli.ts` — Commander program with `build`, `run`, `agents`, `addon`, `start`, `status`
3. `src/aegis/commands/build.ts` — two-agent sequential workflow
4. `src/aegis/commands/run.ts` — single agent execution
5. `src/aegis/commands/addon.ts` — MCP add-on installer
6. `src/aegis/commands/agents.ts` — agent listing and creation
7. `src/aegis/commands/start.ts` — gateway startup
8. `src/aegis/commands/status.ts` — health check
9. `src/aegis/coordinator/sequential.ts` — sequential protocol
10. `src/aegis/gateway/client.ts` — gateway communication wrapper
11. `src/aegis/security/audit.ts` — hash-chain audit logging
12. `src/aegis/security/lock.ts` — build lockfile
13. `src/aegis/ui/terminal.ts` — spinners and result display
14. `src/aegis/addons/configs/` — initial MCP server configs (slack, github)

## What We Don't Build Yet

- Discussion protocol (Week 3-4)
- Team definitions (Week 4)
- Parallel protocol (Month 2)
- `aegis discuss` command (Month 2)
- Real-time streaming output via gateway events (Week 2)
- Encrypted credential storage (Enterprise tier)
- Agent marketplace integration (Phase 5)
- `--watch` flag for builds (future — undefined behavior, deferred)
- Docker service management in `aegis start` (future — `aegis start --full`)

## Dependencies

- Node.js >= 22.16.0 (per package.json)
- Commander.js (already in OpenClaw's deps)
- OpenClaw gateway running locally
- tsdown build pipeline (existing, add `src/aegis/` to inputs)
- Agent configs in `~/.openclaw/openclaw.json` (architect + main already configured)

## Success Criteria

1. `aegis build "Build a crypto dashboard"` produces a working project in a build-specific workspace subdirectory
2. Architect writes SPEC.md, Builder implements from it, using `extraSystemPrompt` for directory routing
3. Progress spinners visible in terminal during both phases, full output shown after each phase
4. Audit entry created with valid hash chain
5. `aegis addon add slack` installs Slack MCP server config and makes it available to agents
6. `aegis status` reports gateway health, configured agents, and installed add-ons
7. Concurrent `aegis build` calls are serialized via lockfile
8. Zero changes to OpenClaw source files
