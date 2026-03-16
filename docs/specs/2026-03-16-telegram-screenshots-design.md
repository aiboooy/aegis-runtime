# Telegram Bot + Screenshots — Design Spec

**Date:** 2026-03-16
**Status:** Draft
**Depends on:** Phase 1.1 + Security Reviewer (complete)

## Overview

Wire OpenClaw's existing Telegram integration to trigger AEGIS builds. Users send "build: ..." in Telegram, the 3-agent pipeline runs, and results + screenshots are sent back to chat. Requires refactoring the build logic into a reusable function that both CLI and Telegram consume.

## Architecture

```
Telegram handler ──→ runBuild() ←── aegis build CLI
                         │
                    SequentialProtocol
                    (Architect → Builder → Security)
                         │
                    Screenshot capture
                         │
                    BuildResult
                    ├── filesCreated
                    ├── securitySummary
                    └── screenshotPath
```

One function (`runBuild()`), multiple consumers. No REST API needed yet — Telegram calls the function directly in-process since it runs inside the same OpenClaw gateway.

## Sub-project 1: Refactor Build into Reusable Core

### New file: `src/aegis/core/build-runner.ts`

Extract the orchestration logic from `src/aegis/commands/build.ts` into a reusable function:

```typescript
export interface BuildResult {
  buildId: string;
  workspacePath: string;
  filesCreated: string[];
  success: boolean;
  duration: number;
  events: AgentEvent[];
  securitySummary?: {
    criticalFound: number;
    criticalFixed: number;
    warningCount: number;
    fixRounds: number;
    status: "pass" | "fail" | "unknown";
  };
  screenshotPath?: string;
}

export interface BuildProgressCallback {
  onEvent: (event: AgentEvent, phaseIndex: number, totalPhases: number) => void;
}

export async function runBuild(
  prompt: string,
  progress?: BuildProgressCallback,
): Promise<BuildResult>;
```

Key differences from the current `buildCommand()`:

- Returns a `BuildResult` instead of printing to terminal
- Accepts an optional `BuildProgressCallback` for live updates (Telegram sends typing indicators / progress messages)
- Does NOT call `process.exit()` — caller decides what to do with errors
- Still handles lockfile, audit trail, workspace creation internally

### Modified: `src/aegis/commands/build.ts`

Becomes a thin wrapper:

```typescript
export async function buildCommand(prompt: string): Promise<void> {
  const result = await runBuild(prompt, {
    onEvent: (event, phaseIndex, totalPhases) => {
      printEvent(event, phaseIndex, totalPhases);
    },
  });
  printBuildResult({ ...result });
  if (!result.success) process.exit(1);
}
```

## Sub-project 2: Telegram Integration

### How detection works

Modify `extensions/telegram/src/bot-handlers.ts` to detect build requests before normal message processing. When a message starts with `build:` or `/build`, route to the AEGIS build handler instead of the standard agent chat dispatch.

### Detection logic

```typescript
function extractBuildPrompt(text: string): string | null {
  if (text.startsWith("/build ")) return text.slice(7).trim();
  if (text.toLowerCase().startsWith("build: ")) return text.slice(7).trim();
  if (text.toLowerCase().startsWith("build:")) return text.slice(6).trim();
  return null;
}
```

### Handler: `src/aegis/telegram/build-handler.ts`

New file that handles build requests from Telegram:

```typescript
export async function handleTelegramBuild(ctx: TelegramContext, prompt: string): Promise<void>;
```

Flow:

1. Send initial message: "Starting build..."
2. Call `runBuild(prompt, { onEvent })` with progress callback
3. On `phase_start`: edit message to show current phase
4. On `agent_response`: edit message to show completion
5. On `error`: edit message to show error
6. After build completes: send final summary message
7. If `screenshotPath` exists: send photo via `ctx.replyWithPhoto()`

### Message format in Telegram

Progress (edited message during build):

```
🏗 AEGIS Build 2026-03-16-abc123

✅ [1/3] Architect — SPEC.md written
⚡ [2/3] Builder working...
```

Final result:

```
✅ Build complete!

📁 Files: 4 created
🔒 Security: PASS — no critical issues
⏱ Time: 2m 34s
📋 Build: 2026-03-16-abc123
```

Plus screenshot sent as a separate photo message with caption.

### Telegram config changes

Add to `~/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "<from @BotFather>",
      "dmPolicy": "open"
    }
  }
}
```

The bot token needs to be created via Telegram's @BotFather. This is a runtime configuration step, not a code change.

## Sub-project 3: Screenshot Capture

### New file: `src/aegis/core/screenshot.ts`

After the Builder finishes, attempt to capture a screenshot of the built project:

```typescript
export async function captureScreenshot(workspacePath: string): Promise<string | null>;
```

Logic:

1. Check if workspace contains `index.html` (static site)
   - If yes: serve it with a simple HTTP server, capture screenshot, kill server
2. Check if workspace contains a server file (`server.py`, `app.py`, `server.js`, `app.js`)
   - If yes: start the server, wait for it to bind a port, capture screenshot, kill server
3. If neither: return null (no screenshot possible)

Screenshot capture uses `puppeteer` or `playwright`. Check which is available in the OpenClaw deps. If neither, use a subprocess call to a headless Chrome/Chromium.

### Screenshot dimensions

- Width: 1280px
- Height: 800px
- Format: PNG
- Saved as: `{workspacePath}/screenshot.png`

### Integration into build-runner

At the end of `runBuild()`, after security review:

```typescript
const screenshotPath = await captureScreenshot(workspacePath);
result.screenshotPath = screenshotPath;
```

Screenshot failure is non-fatal — if it fails, `screenshotPath` is null and the build still succeeds.

## Files Changed

| File                                      | Change                                  |
| ----------------------------------------- | --------------------------------------- |
| `src/aegis/core/build-runner.ts`          | Create — extracted build orchestration  |
| `src/aegis/core/screenshot.ts`            | Create — screenshot capture utility     |
| `src/aegis/commands/build.ts`             | Modify — thin wrapper around runBuild() |
| `src/aegis/telegram/build-handler.ts`     | Create — Telegram build request handler |
| `extensions/telegram/src/bot-handlers.ts` | Modify — add build detection hook       |

## Files NOT Changed

| File                       | Reason                 |
| -------------------------- | ---------------------- |
| `src/aegis/coordinator/*`  | Protocol unchanged     |
| `src/aegis/gateway/*`      | Client unchanged       |
| `src/aegis/security/*`     | Audit + lock unchanged |
| `src/aegis/ui/terminal.ts` | CLI display unchanged  |

## Implementation Order

1. **Refactor build-runner** — extract `runBuild()`, update CLI to use it, verify all existing tests pass
2. **Screenshot capture** — implement `captureScreenshot()`, test with a simple HTML file
3. **Telegram handler** — add build detection hook, implement build-handler, test with real Telegram bot

## Success Criteria

1. `aegis build "..."` still works exactly as before (thin wrapper)
2. Telegram message "build: Build a weather dashboard" triggers 3-agent build
3. Telegram receives progress updates during build
4. Telegram receives screenshot of running app (when applicable)
5. Telegram receives final summary with file count, security status, time
6. Screenshot failure doesn't break the build
7. Non-build Telegram messages still route to normal chat
