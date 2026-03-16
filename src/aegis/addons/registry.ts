export interface AddonConfig {
  name: string;
  description: string;
  permissions: string[];
  requires: string[];
  mcpServer: {
    command: string;
    args: string[];
    env: Record<string, string>;
  };
}

const BUILTIN_ADDONS: Record<string, AddonConfig> = {
  slack: {
    name: "slack",
    description: "Post messages and read channels via Slack",
    permissions: ["network:hooks.slack.com", "read:channels", "write:messages"],
    requires: ["SLACK_BOT_TOKEN"],
    mcpServer: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack"],
      env: { SLACK_BOT_TOKEN: "${SLACK_BOT_TOKEN}" },
    },
  },
  github: {
    name: "github",
    description: "Create PRs, issues, read repos via GitHub",
    permissions: ["network:api.github.com", "read:repos", "write:issues", "write:pulls"],
    requires: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
    mcpServer: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}" },
    },
  },
};

export function listAvailableAddons(): string[] {
  return Object.keys(BUILTIN_ADDONS);
}

export function getAddonConfig(name: string): AddonConfig | null {
  return BUILTIN_ADDONS[name] ?? null;
}
