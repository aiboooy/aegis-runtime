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
    ]);

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
});
