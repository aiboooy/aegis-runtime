export interface AgentEvent {
  type: "phase_start" | "phase_end" | "agent_response" | "error";
  agent: string;
  data: {
    text?: string;
    error?: string;
    filesCreated?: string[];
  };
  timestamp: string;
}

export interface BuildOpts {
  prompt: string;
  buildId: string;
  workspacePath: string;
  timeoutSeconds?: number;
}

export interface Protocol {
  name: string;
  agents: string[];
  execute(opts: BuildOpts): AsyncGenerator<AgentEvent>;
}
