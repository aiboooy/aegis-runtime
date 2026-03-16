import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseSecurityReview } from "../coordinator/security-review.js";
import { SequentialProtocol } from "../coordinator/sequential.js";
import type { AuditPhase } from "../security/audit.js";
import { createAuditEntry, writeAuditEntry, loadChain } from "../security/audit.js";
import { acquireLock, releaseLock } from "../security/lock.js";
import { printBuildHeader, printEvent, printBuildResult } from "../ui/terminal.js";

const AEGIS_DIR = join(homedir(), ".aegis");
const AUDIT_DIR = join(AEGIS_DIR, "audit");
const LOCK_PATH = join(AEGIS_DIR, "build.lock");
const WORKSPACE_BASE = join(homedir(), ".openclaw", "workspace", "builds");

function generateBuildId(): string {
  const date = new Date().toISOString().slice(0, 10);
  const short = randomUUID().slice(0, 8);
  return `${date}-${short}`;
}

export async function buildCommand(prompt: string): Promise<void> {
  mkdirSync(AEGIS_DIR, { recursive: true });
  mkdirSync(AUDIT_DIR, { recursive: true });
  mkdirSync(WORKSPACE_BASE, { recursive: true });

  const lock = acquireLock(LOCK_PATH);
  if (!lock.acquired) {
    console.error(`  ${lock.reason}`);
    process.exit(1);
  }

  const buildId = generateBuildId();
  const workspacePath = join(WORKSPACE_BASE, buildId);
  mkdirSync(workspacePath, { recursive: true });

  printBuildHeader(buildId);

  const protocol = new SequentialProtocol();
  const startTime = Date.now();
  const phases: AuditPhase[] = [];
  let currentPhaseStart = "";
  let currentPhaseAgent = "";
  let filesCreated: string[] = [];
  let success = true;
  let firstSecurityCriticalCount = 0;
  let securityPhaseCount = 0;

  try {
    let phaseIndex = 0;

    for await (const event of protocol.execute({ prompt, buildId, workspacePath })) {
      if (event.type === "phase_start") {
        phaseIndex++;
        currentPhaseStart = event.timestamp;
        currentPhaseAgent = event.agent;
      }

      printEvent(event, phaseIndex, protocol.agents.length);

      if (event.type === "phase_end") {
        phases.push({
          agent: currentPhaseAgent,
          started: currentPhaseStart,
          completed: event.timestamp,
          status: "success",
        });

        if (currentPhaseAgent === "security") {
          securityPhaseCount++;
          if (securityPhaseCount === 1) {
            const review = parseSecurityReview(workspacePath);
            firstSecurityCriticalCount = review.criticalCount;
          }
        }
      }

      if (event.type === "agent_response" && event.data.filesCreated) {
        filesCreated = event.data.filesCreated;
      }

      if (event.type === "error") {
        success = false;
        phases.push({
          agent: event.agent,
          started: currentPhaseStart || event.timestamp,
          completed: event.timestamp,
          status: "error",
        });
      }
    }
  } catch (err) {
    success = false;
    console.error(`  Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    releaseLock(LOCK_PATH);
  }

  const duration = Date.now() - startTime;

  const finalReview = parseSecurityReview(workspacePath);
  const fixRounds = securityPhaseCount > 1 ? securityPhaseCount - 1 : 0;
  const criticalFixed = firstSecurityCriticalCount - finalReview.criticalCount;

  const securitySummary =
    securityPhaseCount > 0
      ? {
          criticalFound: firstSecurityCriticalCount,
          criticalFixed: Math.max(0, criticalFixed),
          warningCount: finalReview.warningCount,
          fixRounds,
          status: finalReview.status,
        }
      : undefined;

  const chain = loadChain(AUDIT_DIR);
  const prevHash = chain.length > 0 ? chain[chain.length - 1].hash : "";

  const buildResult =
    securitySummary?.status === "fail" ? "success-with-warnings" : success ? "success" : "error";

  const entry = createAuditEntry({
    buildId,
    prompt,
    agents: protocol.agents,
    phases,
    result: buildResult,
    filesCreated,
    duration: Math.round(duration / 1000),
    prevHash,
  });
  writeAuditEntry(AUDIT_DIR, entry);

  printBuildResult({ buildId, filesCreated, workspacePath, duration, success, securitySummary });

  if (!success) {
    process.exit(1);
  }
}
