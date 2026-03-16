import { resolveSessionKeyForRequest } from "../../commands/agent/session.js";
import { loadConfig } from "../../config/config.js";
import { callGateway, randomIdempotencyKey } from "../../gateway/call.js";
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
