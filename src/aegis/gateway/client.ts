import { randomUUID } from "node:crypto";
import { loadConfig } from "../../config/config.js";
import { callGateway, randomIdempotencyKey } from "../../gateway/call.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../../utils/message-channel.js";

export interface AgentRunOpts {
  agentId: string;
  message: string;
  timeoutSeconds?: number;
  extraSystemPrompt?: string;
  sessionId?: string;
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

  // Use provided sessionId or generate a fresh one to avoid context pollution
  const sessionId = opts.sessionId ?? `aegis-${randomUUID()}`;

  const response = await callGateway<GatewayAgentResponse>({
    config: cfg,
    method: "agent",
    params: {
      message: opts.message,
      agentId: opts.agentId,
      sessionId,
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
