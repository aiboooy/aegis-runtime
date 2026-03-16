import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AgentEvent } from "./types.js";

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

    mockRunAgent.mockImplementationOnce(async () => {
      writeFileSync(join(workspacePath, "SPEC.md"), "# Spec\nBuild a dashboard");
      return { runId: "r1", status: "completed", text: "Spec written.", summary: "" };
    });

    mockRunAgent.mockImplementationOnce(async () => {
      writeFileSync(join(workspacePath, "server.py"), "# server");
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
      prompt: "Build a dashboard",
      buildId: "test-build",
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
    expect(events.some((e) => e.type === "phase_start" && e.agent === "main")).toBe(false);

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
      "phase_start:main",
      "agent_response:main",
      "phase_end:main",
      "phase_start:security",
      "agent_response:security",
      "phase_end:security",
    ]);

    expect(mockRunAgent).toHaveBeenCalledTimes(5);
    expect(mockRunAgent.mock.calls[3][0].message).toContain("SECURITY-REVIEW.md");
  });
});
