import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAuditEntry, writeAuditEntry, loadChain, verifyChain } from "./audit.js";

describe("audit", () => {
  let auditDir: string;

  beforeEach(() => {
    auditDir = mkdtempSync(join(tmpdir(), "aegis-audit-"));
  });

  afterEach(() => {
    rmSync(auditDir, { recursive: true, force: true });
  });

  describe("createAuditEntry", () => {
    it("creates entry with hash including prevHash", () => {
      const entry = createAuditEntry({
        buildId: "test-build-1",
        prompt: "Build a dashboard",
        agents: ["architect", "main"],
        phases: [
          {
            agent: "architect",
            started: "2026-03-16T14:00:00Z",
            completed: "2026-03-16T14:01:00Z",
            status: "success",
          },
        ],
        result: "success",
        filesCreated: ["SPEC.md"],
        duration: 60,
        prevHash: "",
      });

      expect(entry.buildId).toBe("test-build-1");
      expect(entry.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(entry.prevHash).toBe("");
    });

    it("includes prevHash in hash calculation", () => {
      const entry1 = createAuditEntry({
        buildId: "build-1",
        prompt: "test",
        agents: ["architect"],
        phases: [],
        result: "success",
        filesCreated: [],
        duration: 10,
        prevHash: "",
      });

      const entry2 = createAuditEntry({
        buildId: "build-2",
        prompt: "test",
        agents: ["architect"],
        phases: [],
        result: "success",
        filesCreated: [],
        duration: 10,
        prevHash: entry1.hash,
      });

      expect(entry2.prevHash).toBe(entry1.hash);
      expect(entry2.hash).not.toBe(entry1.hash);
    });
  });

  describe("writeAuditEntry + loadChain", () => {
    it("writes entry file and updates chain index", () => {
      const entry = createAuditEntry({
        buildId: "build-1",
        prompt: "test",
        agents: ["architect"],
        phases: [],
        result: "success",
        filesCreated: [],
        duration: 10,
        prevHash: "",
      });

      writeAuditEntry(auditDir, entry);

      expect(existsSync(join(auditDir, "builds", "build-1.json"))).toBe(true);

      const chain = loadChain(auditDir);
      expect(chain).toHaveLength(1);
      expect(chain[0].buildId).toBe("build-1");
      expect(chain[0].hash).toBe(entry.hash);
    });

    it("appends to existing chain", () => {
      const entry1 = createAuditEntry({
        buildId: "b1",
        prompt: "t",
        agents: [],
        phases: [],
        result: "success",
        filesCreated: [],
        duration: 1,
        prevHash: "",
      });
      writeAuditEntry(auditDir, entry1);

      const entry2 = createAuditEntry({
        buildId: "b2",
        prompt: "t",
        agents: [],
        phases: [],
        result: "success",
        filesCreated: [],
        duration: 1,
        prevHash: entry1.hash,
      });
      writeAuditEntry(auditDir, entry2);

      const chain = loadChain(auditDir);
      expect(chain).toHaveLength(2);
    });
  });

  describe("verifyChain", () => {
    it("returns true for valid chain", () => {
      const e1 = createAuditEntry({
        buildId: "b1",
        prompt: "t",
        agents: [],
        phases: [],
        result: "success",
        filesCreated: [],
        duration: 1,
        prevHash: "",
      });
      writeAuditEntry(auditDir, e1);

      const e2 = createAuditEntry({
        buildId: "b2",
        prompt: "t",
        agents: [],
        phases: [],
        result: "success",
        filesCreated: [],
        duration: 1,
        prevHash: e1.hash,
      });
      writeAuditEntry(auditDir, e2);

      expect(verifyChain(auditDir)).toBe(true);
    });

    it("returns true for empty chain", () => {
      expect(verifyChain(auditDir)).toBe(true);
    });

    it("returns false when entry is tampered", () => {
      const e1 = createAuditEntry({
        buildId: "b1",
        prompt: "t",
        agents: [],
        phases: [],
        result: "success",
        filesCreated: [],
        duration: 1,
        prevHash: "",
      });
      writeAuditEntry(auditDir, e1);

      const entryPath = join(auditDir, "builds", "b1.json");
      const tampered = JSON.parse(readFileSync(entryPath, "utf-8"));
      tampered.prompt = "TAMPERED";
      writeFileSync(entryPath, JSON.stringify(tampered, null, 2));

      expect(verifyChain(auditDir)).toBe(false);
    });
  });
});
