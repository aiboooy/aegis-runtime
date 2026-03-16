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
aegis build "Create a REST API for task management" --watch

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
aegis add slack                  # install Slack MCP server
aegis add github                 # install GitHub MCP server
aegis add notion                 # install Notion MCP server
aegis add postgres               # install PostgreSQL MCP server
aegis add custom ./my-server     # install custom MCP server
aegis addons list                # show installed add-ons
aegis addons remove slack        # remove an add-on
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

## `aegis build` Workflow

### Step 1: Validate & Prepare

- Connect to OpenClaw gateway (WebSocket RPC)
- Create fresh workspace directory: `~/.openclaw/workspace/builds/{build-id}/`
- Generate unique build-id
- Start audit log entry

### Step 2: Architect Phase

- Send to Architect agent via gateway:
  ```
  Design a system for: {user_prompt}
  Write a detailed SPEC.md to the workspace with:
  - Exact API endpoints, URLs, request/response formats
  - Database schema (CREATE TABLE statements)
  - Frontend layout with sections and data sources
  - External API URLs with example responses
  ```
- Stream Architect output to terminal in real-time
- Wait for completion
- Verify SPEC.md exists and is non-empty
- If Architect fails: stop, show error, do not proceed to Builder

### Step 3: Builder Phase

- Send to Builder agent via gateway:
  ```
  Read SPEC.md in the workspace and implement everything exactly as specified.
  Write all code files. Run and test the code. Fix any errors.
  ```
- Stream Builder output to terminal in real-time
- Wait for completion

### Step 4: Result

- Show summary: files created, tests run/passed, server URL if applicable
- Log build to audit trail
- If Builder fails: show partial output and error

### Key Design Decisions

- **Isolated workspaces:** Each build gets its own directory so builds don't clobber each other
- **SPEC.md handoff:** The coordination protocol between agents. Simple, debuggable, human-readable.
- **Fail-fast:** If Architect fails, don't run Builder on garbage input
- **MCP available to both:** All installed add-ons are accessible to both Architect and Builder

## File Structure

```
aegis-runtime/
+-- bin/
|   +-- aegis                          # Entry point (chmod +x, node shebang)
+-- src/aegis/                         # ALL AEGIS code lives here
|   +-- cli.ts                         # Commander program, registers commands
|   +-- commands/
|   |   +-- build.ts                   # aegis build -- two-agent workflow
|   |   +-- run.ts                     # aegis run -- single agent
|   |   +-- agents.ts                  # aegis agents list/add
|   |   +-- addons.ts                  # aegis add/addons -- MCP management
|   |   +-- start.ts                   # aegis start -- gateway + services
|   |   +-- status.ts                  # aegis status -- health check
|   +-- coordinator/
|   |   +-- index.ts                   # Agent Coordinator
|   |   +-- sequential.ts             # Sequential protocol (Architect -> Builder)
|   |   +-- types.ts                   # Protocol interface & shared types
|   +-- gateway/
|   |   +-- client.ts                  # Thin wrapper around OpenClaw gateway RPC
|   +-- addons/
|   |   +-- registry.ts               # Curated MCP server registry
|   |   +-- configs/
|   |       +-- slack.json
|   |       +-- github.json
|   |       +-- notion.json
|   |       +-- postgres.json
|   +-- security/
|   |   +-- audit.ts                   # Hash-chain audit log
|   +-- ui/
|       +-- terminal.ts                # Spinners, progress, streaming output
+-- src/                               # OpenClaw source (UNTOUCHED)
```

## Coordinator Protocol Interface

The Coordinator is the extensibility point for multi-agent workflows:

```typescript
interface AgentEvent {
  type: "phase_start" | "phase_end" | "output" | "error" | "file_written" | "test_result";
  agent: string;
  data: unknown;
  timestamp: string;
}

interface BuildOpts {
  prompt: string;
  workspace: string;
  buildId: string;
  watch?: boolean;
  team?: string;
  addons?: string[];
}

interface Protocol {
  name: string;
  agents: string[];
  execute(opts: BuildOpts): AsyncGenerator<AgentEvent>;
}
```

MVP ships `SequentialProtocol` (Architect -> Builder). Future protocols:

- `DiscussionProtocol` — agents share a message bus, take turns responding
- `ParallelProtocol` — agents work simultaneously on different parts
- `TeamProtocol` — predefined agent compositions with role-based coordination

The CLI doesn't care which protocol runs — it just streams AgentEvents to the terminal UI.

## Gateway Communication

The CLI communicates with agents through the OpenClaw gateway's WebSocket RPC:

```typescript
// gateway/client.ts
async function callAgent(opts: {
  agentId: string;
  message: string;
  sessionId?: string;
  workspace?: string;
  onStream?: (chunk: string) => void;
}): Promise<AgentResult>;
```

Gateway connection details are read from `~/.openclaw/openclaw.json`:

- Port: `gateway.port` (default 18789)
- Auth: `gateway.auth.token`
- Bind: `gateway.bind` (loopback)

## Security & Audit

### Hash-Chain Audit Trail

Every build produces an audit entry stored in `~/.aegis/audit/builds/{build-id}.json`:

```json
{
  "buildId": "a1b2c3d4",
  "timestamp": "2026-03-16T14:30:00Z",
  "prompt": "Build a fintech dashboard",
  "agents": ["architect", "main"],
  "phases": [
    {
      "agent": "architect",
      "started": "2026-03-16T14:30:00Z",
      "completed": "2026-03-16T14:31:12Z",
      "tokensUsed": 4200,
      "filesWritten": ["SPEC.md"],
      "model": "claude-opus-4-6"
    },
    {
      "agent": "main",
      "started": "2026-03-16T14:31:13Z",
      "completed": "2026-03-16T14:32:34Z",
      "tokensUsed": 12400,
      "filesWritten": ["server.py", "index.html", "test_server.py"],
      "model": "claude-opus-4-6"
    }
  ],
  "result": "success",
  "filesCreated": 4,
  "testsPassed": 3,
  "duration": 154,
  "prevHash": "sha256:ab12cd34...",
  "hash": "sha256:ef56gh78..."
}
```

Each entry's `hash` includes the `prevHash` of the previous entry. Tampering breaks the chain. The chain index is stored in `~/.aegis/audit/chain.json`.

### MCP Add-on Security

- Add-ons come from curated registry only (no auto-download from internet)
- Each add-on declares permissions:
  ```json
  {
    "name": "slack",
    "permissions": ["network:hooks.slack.com", "read:channels"],
    "requires": ["SLACK_BOT_TOKEN"]
  }
  ```
- `aegis add <name>` shows permissions and asks for confirmation
- Credentials stored in `~/.aegis/secrets/` with file permissions 0600
- Agents can only use explicitly installed add-ons

## Terminal UI

Streaming output during builds:

```
  AEGIS Build a1b2c3d4

  [1/2] Architect designing...
  > Researching CoinGecko API
  > Designing database schema
  > Writing SPEC.md
  v Spec complete (47 lines)

  [2/2] Builder implementing...
  > Reading SPEC.md
  > Writing server.py
  > Writing index.html
  > Running tests... v 3/3 pass
  > Starting server on :8000

  v Build complete!

  Files: 4 created
    workspace/SPEC.md
    workspace/server.py
    workspace/index.html
    workspace/test_server.py

  Tests: 3/3 passing
  Server: http://localhost:8000
  Time: 2m 34s
  Audit: build-a1b2c3d4
```

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

1. `bin/aegis` entry point
2. `src/aegis/cli.ts` — Commander program with `build`, `run`, `agents`, `add`, `addons`, `start`, `status` commands
3. `src/aegis/commands/build.ts` — Architect -> Builder sequential workflow
4. `src/aegis/commands/run.ts` — Single agent execution
5. `src/aegis/commands/addons.ts` — MCP add-on installer
6. `src/aegis/coordinator/sequential.ts` — Sequential protocol
7. `src/aegis/gateway/client.ts` — Gateway communication
8. `src/aegis/security/audit.ts` — Hash-chain audit logging
9. `src/aegis/ui/terminal.ts` — Streaming terminal output
10. `src/aegis/addons/configs/` — Initial MCP server configs (slack, github)

## What We Don't Build Yet

- Discussion protocol (Week 3-4)
- Team definitions (Week 4)
- Parallel protocol (Month 2)
- `aegis discuss` command (Month 2)
- Encrypted credential storage (Enterprise tier)
- Agent marketplace integration (Phase 5)

## Dependencies

- Node.js 22.12+ (same as OpenClaw)
- Commander.js (already in OpenClaw's deps)
- OpenClaw gateway running locally
- Agent configs in `~/.openclaw/agents/` (architect + main already configured)

## Success Criteria

1. `aegis build "Build a crypto dashboard"` produces a working project
2. Architect writes SPEC.md, Builder implements from it
3. Streaming output visible in terminal during both phases
4. Audit entry created with hash chain
5. `aegis add slack` installs Slack MCP server and makes it available to agents
6. Zero changes to OpenClaw source files
