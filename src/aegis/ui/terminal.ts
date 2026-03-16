import type { AgentEvent } from "../coordinator/types.js";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

const agentLabels: Record<string, string> = {
  architect: "Architect",
  main: "Builder",
  security: "Security",
};

function agentLabel(agent: string): string {
  return agentLabels[agent] ?? agent;
}

export function printBuildHeader(buildId: string): void {
  console.log();
  console.log(`${BOLD}  AEGIS Build ${buildId}${RESET}`);
  console.log();
}

export function printEvent(event: AgentEvent, phaseIndex: number, totalPhases: number): void {
  const label = agentLabel(event.agent);

  switch (event.type) {
    case "phase_start":
      process.stdout.write(
        `  ${DIM}[${phaseIndex}/${totalPhases}]${RESET} ${CYAN}${label} working...${RESET}`,
      );
      break;

    case "agent_response":
      process.stdout.write("\r\x1b[K");
      console.log(
        `  ${DIM}[${phaseIndex}/${totalPhases}]${RESET} ${GREEN}${label} complete${RESET}`,
      );
      if (event.data.text) {
        console.log();
        const lines = event.data.text.split("\n");
        for (const line of lines.slice(0, 30)) {
          console.log(`  ${DIM}${line}${RESET}`);
        }
        if (lines.length > 30) {
          console.log(`  ${DIM}... (${lines.length - 30} more lines)${RESET}`);
        }
        console.log();
      }
      break;

    case "phase_end":
      break;

    case "error":
      process.stdout.write("\r\x1b[K");
      console.log(`  ${RED}Error (${label}): ${event.data.error}${RESET}`);
      break;
  }
}

export function printBuildResult(opts: {
  buildId: string;
  filesCreated: string[];
  workspacePath: string;
  duration: number;
  success: boolean;
  securitySummary?: {
    criticalFound: number;
    criticalFixed: number;
    warningCount: number;
    fixRounds: number;
    status: "pass" | "fail" | "unknown";
  };
}): void {
  console.log();
  if (opts.success) {
    if (opts.securitySummary?.status === "fail") {
      console.log(`  ${YELLOW}${BOLD}Build complete with security warnings!${RESET}`);
    } else {
      console.log(`  ${GREEN}${BOLD}Build complete!${RESET}`);
    }
  } else {
    console.log(`  ${RED}${BOLD}Build failed${RESET}`);
  }
  console.log();

  if (opts.filesCreated.length > 0) {
    console.log(
      `  ${BOLD}Files:${RESET} ${opts.filesCreated.length} created in ${opts.workspacePath}`,
    );
    for (const f of opts.filesCreated.slice(0, 20)) {
      console.log(`    ${f}`);
    }
    if (opts.filesCreated.length > 20) {
      console.log(`    ... (${opts.filesCreated.length - 20} more)`);
    }
    console.log();
  }

  if (opts.securitySummary && opts.securitySummary.status !== "unknown") {
    const s = opts.securitySummary;
    const remaining = s.criticalFound - s.criticalFixed;
    if (s.criticalFound > 0) {
      const fixInfo = s.fixRounds > 0 ? `, ${s.criticalFixed} fixed` : "";
      const remainInfo = remaining > 0 ? ` (${remaining} remaining)` : "";
      const statusLabel = remaining > 0 ? `${YELLOW}WARNING${RESET}` : `${GREEN}PASS${RESET}`;
      console.log(
        `  ${BOLD}Security:${RESET} ${s.criticalFound} critical found${fixInfo}${remainInfo} — ${statusLabel}`,
      );
    } else {
      console.log(`  ${BOLD}Security:${RESET} ${GREEN}PASS${RESET} — no critical issues`);
    }
    if (s.warningCount > 0) {
      console.log(`  ${DIM}  ${s.warningCount} warning(s)${RESET}`);
    }
    console.log();
  }

  const secs = Math.round(opts.duration / 1000);
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  const timeStr = mins > 0 ? `${mins}m ${remSecs}s` : `${secs}s`;

  console.log(`  ${BOLD}Time:${RESET}  ${timeStr}`);
  console.log(`  ${BOLD}Audit:${RESET} ${opts.buildId}`);
  console.log();
}
