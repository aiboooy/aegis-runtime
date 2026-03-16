import type { BuildResult } from "../core/build-runner.js";

const agentLabels: Record<string, string> = {
  architect: "Architect",
  main: "Builder",
  security: "Security",
};

const agentEmojis: Record<string, string> = {
  architect: "\u{1F3DB}",
  main: "\u{26A1}",
  security: "\u{1F512}",
};

function agentLabel(agent: string): string {
  return agentLabels[agent] ?? agent;
}

function agentEmoji(agent: string): string {
  return agentEmojis[agent] ?? "\u{2699}";
}

export function formatProgressMessage(
  buildId: string,
  completedPhases: string[],
  currentAgent: string | null,
  totalPhases: number,
): string {
  const lines: string[] = [];
  lines.push(`\u{1F3D7} AEGIS Build ${buildId}\n`);

  for (let i = 0; i < completedPhases.length; i++) {
    const agent = completedPhases[i];
    lines.push(`\u{2705} [${i + 1}/${totalPhases}] ${agentLabel(agent)} complete`);
  }

  if (currentAgent) {
    const idx = completedPhases.length + 1;
    lines.push(
      `${agentEmoji(currentAgent)} [${idx}/${totalPhases}] ${agentLabel(currentAgent)} working...`,
    );
  }

  return lines.join("\n");
}

export function formatBuildResult(result: BuildResult): string {
  const lines: string[] = [];

  if (result.success) {
    if (result.securitySummary?.status === "fail") {
      lines.push("\u{26A0}\u{FE0F} Build complete with security warnings!\n");
    } else {
      lines.push("\u{2705} Build complete!\n");
    }
  } else {
    lines.push("\u{274C} Build failed\n");
  }

  lines.push(`\u{1F4C1} Files: ${result.filesCreated.length} created`);

  if (result.securitySummary && result.securitySummary.status !== "unknown") {
    const s = result.securitySummary;
    if (s.criticalFound > 0) {
      const remaining = s.criticalFound - s.criticalFixed;
      const fixInfo = s.fixRounds > 0 ? `, ${s.criticalFixed} fixed` : "";
      const status = remaining > 0 ? "WARNING" : "PASS";
      lines.push(
        `\u{1F512} Security: ${s.criticalFound} critical found${fixInfo} \u{2014} ${status}`,
      );
    } else {
      lines.push(`\u{1F512} Security: PASS \u{2014} no critical issues`);
    }
  }

  const secs = Math.round(result.duration / 1000);
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  const timeStr = mins > 0 ? `${mins}m ${remSecs}s` : `${secs}s`;

  lines.push(`\u{23F1} Time: ${timeStr}`);
  lines.push(`\u{1F4CB} Build: ${result.buildId}`);

  return lines.join("\n");
}
