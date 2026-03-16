import { installAddon, removeAddon, listInstalledAddons } from "../addons/installer.js";
import { getAddonConfig, listAvailableAddons } from "../addons/registry.js";

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export async function addonAdd(name: string): Promise<void> {
  const config = getAddonConfig(name);
  if (!config) {
    const available = listAvailableAddons();
    console.error(`  Unknown add-on: "${name}"`);
    console.error(`  Available: ${available.join(", ")}`);
    process.exit(1);
  }
  await installAddon(config);
}

export async function addonList(): Promise<void> {
  const available = listAvailableAddons();
  const installed = listInstalledAddons();

  console.log(`\n  ${BOLD}Add-ons${RESET}\n`);

  for (const name of available) {
    const config = getAddonConfig(name);
    const isInstalled = installed.includes(name);
    const status = isInstalled ? `${GREEN}installed${RESET}` : `${DIM}available${RESET}`;
    console.log(
      `  ${isInstalled ? GREEN : ""}${name}${RESET} — ${config?.description ?? ""} [${status}]`,
    );
  }
  console.log();
}

export async function addonRemove(name: string): Promise<void> {
  removeAddon(name);
}
