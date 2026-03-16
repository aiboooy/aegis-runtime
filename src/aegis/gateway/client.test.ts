import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("../../utils/message-channel.js", () => ({
  GATEWAY_CLIENT_NAMES: { CLI: "cli" },
  GATEWAY_CLIENT_MODES: { CLI: "cli" },
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
