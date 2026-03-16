import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../config/config.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

export async function agentsList(): Promise<void> {
  const cfg: OpenClawConfig = loadConfig();
  const agents = cfg.agents?.list ?? [];

  console.log(`\n  ${BOLD}Configured Agents${RESET}\n`);

  if (agents.length === 0) {
    console.log("  No agents configured.\n");
    return;
  }

  for (const agent of agents) {
    const id = agent.id ?? "unknown";
    const agentDir = join(homedir(), ".openclaw", "agents", id, "agent");
    const soulPath = join(agentDir, "SOUL.md");
    const hasSoul = existsSync(soulPath);
    const soulPreview = hasSoul
      ? readFileSync(soulPath, "utf-8").split("\n")[0].slice(0, 60)
      : "no SOUL.md";

    console.log(`  ${GREEN}${id}${RESET}`);
    console.log(`    ${DIM}${soulPreview}${RESET}`);
  }
  console.log();
}

const AGENT_TEMPLATES: Record<string, string> = {
  security: [
    "You are the Security Reviewer Agent. You review code for vulnerabilities.",
    "",
    "## Your Focus",
    "- OWASP Top 10 vulnerabilities",
    "- SQL injection, XSS, CSRF",
    "- Authentication and authorization flaws",
    "- Insecure dependencies",
    "- Secrets exposure",
    "",
    "## How You Work",
    "1. Read the code in /workspace",
    "2. Identify security issues",
    "3. Write SECURITY-REVIEW.md with findings and severity ratings",
    "4. Suggest fixes for each issue",
  ].join("\n"),
  qa: [
    "You are the QA Agent. You write comprehensive tests.",
    "",
    "## Your Focus",
    "- Edge cases and boundary conditions",
    "- Error handling paths",
    "- Integration between components",
    "- Performance concerns",
    "",
    "## How You Work",
    "1. Read the code in /workspace",
    "2. Write test files for every module",
    "3. Run the tests and fix failures",
    "4. Write QA-REPORT.md with coverage summary",
  ].join("\n"),
  researcher: [
    "You are the Researcher Agent. You gather information and analyze APIs.",
    "",
    "## Your Focus",
    "- Finding relevant APIs and services",
    "- Evaluating technology options",
    "- Benchmarking and comparison",
    "",
    "## How You Work",
    "1. Research the topic using web search",
    "2. Find real, working API endpoints",
    "3. Write RESEARCH.md with findings, URLs, and code examples",
  ].join("\n"),
};

export async function agentsAdd(name: string, opts: { template?: string }): Promise<void> {
  const agentDir = join(homedir(), ".openclaw", "agents", name, "agent");

  if (existsSync(agentDir)) {
    console.error(`  Agent "${name}" already exists at ${agentDir}`);
    process.exit(1);
  }

  mkdirSync(agentDir, { recursive: true });

  const templateName = opts.template ?? name;
  const soul = AGENT_TEMPLATES[templateName];

  if (soul) {
    writeFileSync(join(agentDir, "SOUL.md"), soul + "\n");
    console.log(`  Created agent "${name}" with ${templateName} template`);
  } else {
    const defaultSoul = `You are the ${name} agent.\n\nDescribe your role and capabilities here.\n`;
    writeFileSync(join(agentDir, "SOUL.md"), defaultSoul);
    console.log(`  Created agent "${name}" with default SOUL.md`);
    console.log(`  Edit: ${join(agentDir, "SOUL.md")}`);
  }

  console.log();
  console.log(
    `  NOTE: To complete setup, add the agent to ~/.openclaw/openclaw.json agents.list[]`,
  );
  console.log(`  Available templates: ${Object.keys(AGENT_TEMPLATES).join(", ")}`);
  console.log();
}
