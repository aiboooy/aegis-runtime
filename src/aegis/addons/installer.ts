import { mkdirSync, writeFileSync, existsSync, unlinkSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { AddonConfig } from "./registry.js";

const ADDONS_DIR = join(homedir(), ".aegis", "addons");
const SECRETS_DIR = join(homedir(), ".aegis", "secrets");

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function installAddon(config: AddonConfig): Promise<boolean> {
  mkdirSync(ADDONS_DIR, { recursive: true });
  mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });

  const installedPath = join(ADDONS_DIR, `${config.name}.json`);
  if (existsSync(installedPath)) {
    console.log(`  Add-on "${config.name}" is already installed.`);
    return false;
  }

  console.log(`\n  Installing: ${config.name}`);
  console.log(`  ${config.description}\n`);
  console.log("  Permissions requested:");
  for (const perm of config.permissions) {
    console.log(`    - ${perm}`);
  }
  console.log();

  const confirm = await prompt("  Install? (y/n) ");
  if (confirm.toLowerCase() !== "y") {
    console.log("  Cancelled.");
    return false;
  }

  const secrets: Record<string, string> = {};
  for (const key of config.requires) {
    const value = await prompt(`  ${key}: `);
    if (!value) {
      console.log(`  ${key} is required. Cancelled.`);
      return false;
    }
    secrets[key] = value;
  }

  const secretsPath = join(SECRETS_DIR, `${config.name}.env`);
  const envContent =
    Object.entries(secrets)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n";
  writeFileSync(secretsPath, envContent, { mode: 0o600 });

  writeFileSync(installedPath, JSON.stringify(config, null, 2) + "\n");

  console.log(`\n  Add-on "${config.name}" installed successfully.`);
  console.log(`  Credentials saved to ${secretsPath}\n`);
  return true;
}

export function removeAddon(name: string): boolean {
  const installedPath = join(ADDONS_DIR, `${name}.json`);
  const secretsPath = join(SECRETS_DIR, `${name}.env`);

  if (!existsSync(installedPath)) {
    console.log(`  Add-on "${name}" is not installed.`);
    return false;
  }

  unlinkSync(installedPath);
  if (existsSync(secretsPath)) {
    unlinkSync(secretsPath);
  }

  console.log(`  Add-on "${name}" removed.`);
  return true;
}

export function listInstalledAddons(): string[] {
  if (!existsSync(ADDONS_DIR)) {
    return [];
  }
  return readdirSync(ADDONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""));
}
