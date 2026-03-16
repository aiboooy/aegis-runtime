import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../config/config.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { callGateway } from "../../gateway/call.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../../utils/message-channel.js";
import { loadChain } from "../security/audit.js";

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export async function statusCommand(): Promise<void> {
  console.log(`\n  ${BOLD}AEGIS Status${RESET}\n`);

  let gatewayStatus: string;
  try {
    await callGateway({
      method: "health",
      timeoutMs: 3000,
      clientName: GATEWAY_CLIENT_NAMES.CLI,
      mode: GATEWAY_CLIENT_MODES.CLI,
    });
    gatewayStatus = `${GREEN}running${RESET}`;
  } catch {
    gatewayStatus = `${RED}not running${RESET}`;
  }
  console.log(`  ${BOLD}Gateway:${RESET}    ${gatewayStatus}`);

  const cfg: OpenClawConfig = loadConfig();
  const agents = cfg.agents?.list ?? [];
  const agentIds = agents.map((a) => a.id ?? "unknown").join(", ");
  console.log(`  ${BOLD}Agents:${RESET}     ${agents.length} configured (${agentIds})`);

  const addonsDir = join(homedir(), ".aegis", "addons");
  let addonCount = 0;
  if (existsSync(addonsDir)) {
    addonCount = readdirSync(addonsDir).filter((f) => f.endsWith(".json")).length;
  }
  console.log(`  ${BOLD}Add-ons:${RESET}    ${addonCount} installed`);

  const workspace = cfg.agents?.defaults?.workspace ?? join(homedir(), ".openclaw", "workspace");
  console.log(`  ${BOLD}Workspace:${RESET}  ${workspace}`);

  const auditDir = join(homedir(), ".aegis", "audit");
  const chain = loadChain(auditDir);
  if (chain.length > 0) {
    const last = chain[chain.length - 1];
    console.log(`  ${BOLD}Last build:${RESET} ${last.buildId} ${DIM}(${last.timestamp})${RESET}`);
  } else {
    console.log(`  ${BOLD}Last build:${RESET} ${DIM}none${RESET}`);
  }

  console.log();
}
