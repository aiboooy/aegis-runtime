import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseSecurityReview } from "./security-review.js";

describe("parseSecurityReview", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "aegis-secreview-"));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it("parses FAIL status with critical and warning counts", () => {
    writeFileSync(
      join(workspace, "SECURITY-REVIEW.md"),
      [
        "# Security Review",
        "",
        "## Critical",
        "- [SQL_INJECTION] server.py:23 — User input in SQL query",
        "- [HARDCODED_SECRET] config.py:5 — API key in source",
        "",
        "## Warning",
        "- [MISSING_RATE_LIMIT] server.py:45 — No rate limiting",
        "",
        "## Info",
        "- [NO_CSP] index.html:1 — No CSP header",
        "",
        "## Status: FAIL",
      ].join("\n"),
    );

    const result = parseSecurityReview(workspace);
    expect(result.status).toBe("fail");
    expect(result.criticalCount).toBe(2);
    expect(result.warningCount).toBe(1);
    expect(result.infoCount).toBe(1);
    expect(result.content).toContain("SQL_INJECTION");
  });

  it("parses PASS status", () => {
    writeFileSync(
      join(workspace, "SECURITY-REVIEW.md"),
      [
        "# Security Review",
        "",
        "## Critical",
        "",
        "## Warning",
        "",
        "## Info",
        "- [SUGGESTION] server.py:1 — Consider adding logging",
        "",
        "## Status: PASS",
      ].join("\n"),
    );

    const result = parseSecurityReview(workspace);
    expect(result.status).toBe("pass");
    expect(result.criticalCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.infoCount).toBe(1);
  });

  it("returns unknown when file is missing", () => {
    const result = parseSecurityReview(workspace);
    expect(result.status).toBe("unknown");
    expect(result.criticalCount).toBe(0);
    expect(result.content).toBe("");
  });

  it("returns unknown when file has no status line", () => {
    writeFileSync(join(workspace, "SECURITY-REVIEW.md"), "Some random content without status");

    const result = parseSecurityReview(workspace);
    expect(result.status).toBe("unknown");
  });
});
