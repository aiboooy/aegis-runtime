import { describe, it, expect } from "vitest";
import { getAddonConfig, listAvailableAddons } from "./registry.js";

describe("addon registry", () => {
  it("lists available addons", () => {
    const addons = listAvailableAddons();
    expect(addons).toContain("slack");
    expect(addons).toContain("github");
  });

  it("returns config for known addon", () => {
    const config = getAddonConfig("slack");
    expect(config).not.toBeNull();
    expect(config!.name).toBe("slack");
    expect(config!.requires).toContain("SLACK_BOT_TOKEN");
    expect(config!.mcpServer.command).toBe("npx");
  });

  it("returns null for unknown addon", () => {
    expect(getAddonConfig("nonexistent")).toBeNull();
  });
});
