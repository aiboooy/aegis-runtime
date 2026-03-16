import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";

export interface LockResult {
  acquired: boolean;
  reason?: string;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireLock(lockPath: string): LockResult {
  if (existsSync(lockPath)) {
    const content = readFileSync(lockPath, "utf-8").trim();
    const pid = parseInt(content, 10);

    if (!isNaN(pid) && isProcessAlive(pid)) {
      return {
        acquired: false,
        reason: `Another build is already running (PID ${pid})`,
      };
    }

    unlinkSync(lockPath);
  }

  try {
    writeFileSync(lockPath, String(process.pid), { flag: "wx" });
    return { acquired: true };
  } catch {
    return {
      acquired: false,
      reason: "Another build is already running",
    };
  }
}

export function releaseLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    // Ignore — lock may already be removed
  }
}
