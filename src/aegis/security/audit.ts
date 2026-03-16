import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface AuditPhase {
  agent: string;
  started: string;
  completed: string;
  status: string;
}

export interface AuditEntry {
  buildId: string;
  timestamp: string;
  prompt: string;
  agents: string[];
  phases: AuditPhase[];
  result: string;
  filesCreated: string[];
  duration: number;
  prevHash: string;
  hash: string;
}

export interface ChainEntry {
  buildId: string;
  hash: string;
  timestamp: string;
}

type CreateAuditInput = Omit<AuditEntry, "hash" | "timestamp">;

export function createAuditEntry(input: CreateAuditInput): AuditEntry {
  const timestamp = new Date().toISOString();
  const entryWithoutHash = { ...input, timestamp };
  const hashInput = JSON.stringify(entryWithoutHash) + input.prevHash;
  const hash = "sha256:" + createHash("sha256").update(hashInput).digest("hex");
  return { ...entryWithoutHash, hash };
}

export function writeAuditEntry(auditDir: string, entry: AuditEntry): void {
  const buildsDir = join(auditDir, "builds");
  mkdirSync(buildsDir, { recursive: true });

  const entryPath = join(buildsDir, `${entry.buildId}.json`);
  writeFileSync(entryPath, JSON.stringify(entry, null, 2) + "\n");

  const chainPath = join(auditDir, "chain.json");
  const chain = loadChain(auditDir);
  chain.push({
    buildId: entry.buildId,
    hash: entry.hash,
    timestamp: entry.timestamp,
  });
  writeFileSync(chainPath, JSON.stringify(chain, null, 2) + "\n");
}

export function loadChain(auditDir: string): ChainEntry[] {
  const chainPath = join(auditDir, "chain.json");
  if (!existsSync(chainPath)) {
    return [];
  }
  return JSON.parse(readFileSync(chainPath, "utf-8"));
}

export function verifyChain(auditDir: string): boolean {
  const chain = loadChain(auditDir);
  if (chain.length === 0) {
    return true;
  }

  for (let i = 0; i < chain.length; i++) {
    const entryPath = join(auditDir, "builds", `${chain[i].buildId}.json`);
    if (!existsSync(entryPath)) {
      return false;
    }

    const entry: AuditEntry = JSON.parse(readFileSync(entryPath, "utf-8"));

    // Recompute hash and compare
    const { hash: storedHash, ...rest } = entry;
    const hashInput = JSON.stringify({ ...rest }) + entry.prevHash;
    const computedHash = "sha256:" + createHash("sha256").update(hashInput).digest("hex");
    if (computedHash !== storedHash) {
      return false;
    }
    if (storedHash !== chain[i].hash) {
      return false;
    }

    if (i > 0 && entry.prevHash !== chain[i - 1].hash) {
      return false;
    }
    if (i === 0 && entry.prevHash !== "") {
      return false;
    }
  }

  return true;
}
