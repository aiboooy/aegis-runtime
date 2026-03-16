import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { runAgent } from "../gateway/client.js";
import { parseSecurityReview } from "./security-review.js";
import type { AgentEvent, BuildOpts, Protocol } from "./types.js";

const MAX_FIX_ROUNDS = 2;

function now(): string {
  return new Date().toISOString();
}

function listFilesRecursive(dir: string, base?: string): string[] {
  const root = base ?? dir;
  const files: string[] = [];
  if (!existsSync(dir)) {
    return files;
  }

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
  sessionId?: string,
): AsyncGenerator<AgentEvent> {
  yield { type: "phase_start", agent: agentId, data: {}, timestamp: now() };

  let result;
  try {
    result = await runAgent({
      agentId,
      message,
      extraSystemPrompt: workspaceSystemPrompt(workspacePath),
      timeoutSeconds,
      sessionId,
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
    // Fresh session IDs per build — prevents context pollution between builds
    const buildSession = randomUUID().slice(0, 8);
    const sessions = {
      architect: `aegis-${buildSession}-architect`,
      main: `aegis-${buildSession}-builder`,
      security: `aegis-${buildSession}-security`,
    };

    // Phase 1: Architect
    let hadError = false;
    for await (const event of runPhase(
      "architect",
      buildArchitectPrompt(opts.prompt),
      opts.workspacePath,
      opts.timeoutSeconds,
      sessions.architect,
    )) {
      yield event;
      if (event.type === "error") {
        hadError = true;
      }
    }
    if (hadError) {
      return;
    }

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
      sessions.main,
    )) {
      yield event;
      if (event.type === "error") {
        hadError = true;
      }
    }
    if (hadError) {
      return;
    }

    // Phase 3: Security Review
    for await (const event of runPhase(
      "security",
      buildSecurityReviewPrompt(),
      opts.workspacePath,
      opts.timeoutSeconds,
      sessions.security,
    )) {
      yield event;
      if (event.type === "error") {
        hadError = true;
      }
    }
    if (hadError) {
      return;
    }

    // Fix loop (if security review failed)
    let review = parseSecurityReview(opts.workspacePath);
    let fixRound = 0;

    while (review.status === "fail" && fixRound < MAX_FIX_ROUNDS) {
      fixRound++;

      const reviewPath = join(opts.workspacePath, "SECURITY-REVIEW.md");
      if (existsSync(reviewPath)) {
        unlinkSync(reviewPath);
      }

      // Builder fix round — same session so it remembers what it built
      for await (const event of runPhase(
        "main",
        buildFixPrompt(review.content),
        opts.workspacePath,
        opts.timeoutSeconds,
        sessions.main,
      )) {
        yield event;
        if (event.type === "error") {
          hadError = true;
        }
      }
      if (hadError) {
        return;
      }

      // Security re-review — same session for consistency
      for await (const event of runPhase(
        "security",
        buildSecurityReviewPrompt(),
        opts.workspacePath,
        opts.timeoutSeconds,
        sessions.security,
      )) {
        yield event;
        if (event.type === "error") {
          hadError = true;
        }
      }
      if (hadError) {
        return;
      }

      review = parseSecurityReview(opts.workspacePath);
    }
  }
}
