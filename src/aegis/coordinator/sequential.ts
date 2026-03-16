import { existsSync, readdirSync } from "node:fs";
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
