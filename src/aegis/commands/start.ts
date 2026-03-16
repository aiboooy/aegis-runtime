import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { callGateway } from "../../gateway/call.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../../utils/message-channel.js";

const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

function getAegisRuntimeDir(): string {
  if (process.env.AEGIS_RUNTIME_DIR) {
    return process.env.AEGIS_RUNTIME_DIR;
  }
  const cwd = process.cwd();
  if (existsSync(resolve(cwd, "dist/entry.js"))) {
    return cwd;
  }
  return resolve(cwd);
}

async function isGatewayRunning(): Promise<boolean> {
  try {
    await callGateway({
      method: "health",
      timeoutMs: 3000,
      clientName: GATEWAY_CLIENT_NAMES.CLI,
      mode: GATEWAY_CLIENT_MODES.CLI,
    });
    return true;
  } catch {
    return false;
  }
}

async function waitForHealth(maxMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await isGatewayRunning()) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export async function startCommand(): Promise<void> {
  if (await isGatewayRunning()) {
    console.log(`\n  ${GREEN}Gateway already running${RESET}\n`);
    return;
  }

  console.log("\n  Starting gateway...");

  const runtimeDir = getAegisRuntimeDir();
  const child = spawn("node", ["dist/entry.js", "gateway", "run"], {
    cwd: runtimeDir,
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  const healthy = await waitForHealth(15_000);

  if (healthy) {
    console.log(`  ${GREEN}Gateway started${RESET}\n`);
  } else {
    console.error("  Failed to start gateway within 15 seconds");
    process.exit(1);
  }
}
