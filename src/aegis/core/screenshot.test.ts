import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { captureScreenshot } from "./screenshot.js";

describe("captureScreenshot", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "aegis-screenshot-"));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it("returns null when no servable files present", async () => {
    writeFileSync(join(workspace, "README.md"), "# Hello");
    const result = await captureScreenshot(workspace);
    expect(result).toBeNull();
  });

  it("does not throw when browser is unavailable", async () => {
    writeFileSync(join(workspace, "index.html"), "<h1>Hello</h1>");
    // May return null or a path - key is no throw
    const result = await captureScreenshot(workspace);
    expect(result === null || typeof result === "string").toBe(true);
  });
});
