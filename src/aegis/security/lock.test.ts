import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { acquireLock, releaseLock } from "./lock.js";

describe("build lock", () => {
  let lockDir: string;

  beforeEach(() => {
    lockDir = mkdtempSync(join(tmpdir(), "aegis-lock-"));
  });

  afterEach(() => {
    rmSync(lockDir, { recursive: true, force: true });
  });

  it("acquires lock when no lock exists", () => {
    const lockPath = join(lockDir, "build.lock");
    const result = acquireLock(lockPath);
    expect(result.acquired).toBe(true);
    releaseLock(lockPath);
  });

  it("fails to acquire when lock held by current process", () => {
    const lockPath = join(lockDir, "build.lock");
    const r1 = acquireLock(lockPath);
    expect(r1.acquired).toBe(true);

    const r2 = acquireLock(lockPath);
    expect(r2.acquired).toBe(false);
    expect(r2.reason).toMatch(/already running/);

    releaseLock(lockPath);
  });

  it("acquires lock when stale (dead PID)", () => {
    const lockPath = join(lockDir, "build.lock");
    writeFileSync(lockPath, "999999999");

    const result = acquireLock(lockPath);
    expect(result.acquired).toBe(true);
    releaseLock(lockPath);
  });

  it("releases lock", () => {
    const lockPath = join(lockDir, "build.lock");
    acquireLock(lockPath);
    releaseLock(lockPath);

    const result = acquireLock(lockPath);
    expect(result.acquired).toBe(true);
    releaseLock(lockPath);
  });
});
