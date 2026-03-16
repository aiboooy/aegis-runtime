import { Command } from "commander";
import { addonAdd, addonList, addonRemove } from "./commands/addon.js";
import { agentsList, agentsAdd } from "./commands/agents.js";
import { buildCommand } from "./commands/build.js";
import { runCommand } from "./commands/run.js";
import { startCommand } from "./commands/start.js";
import { statusCommand } from "./commands/status.js";

const program = new Command();

program.name("aegis").description("AEGIS — Multi-agent orchestration platform").version("0.1.0");

program
  .command("build")
  .description("Build a project using Architect + Builder agents")
  .argument("<prompt>", "What to build")
  .action(async (prompt: string) => {
    await buildCommand(prompt);
  });

program
  .command("run")
  .description("Run a single agent")
  .argument("<message>", "Message to send to the agent")
  .option("--agent <id>", "Agent to use", "main")
  .action(async (message: string, opts: { agent?: string }) => {
    await runCommand(message, opts);
  });

const agentsCmd = program.command("agents").description("Manage agents");

agentsCmd
  .command("list")
  .description("List configured agents")
  .action(async () => {
    await agentsList();
  });

agentsCmd
  .command("add")
  .description("Create a new agent")
  .argument("<name>", "Agent name/ID")
  .option("--template <name>", "Use a built-in template (security, qa, researcher)")
  .action(async (name: string, opts: { template?: string }) => {
    await agentsAdd(name, opts);
  });

const addonCmd = program.command("addon").description("Manage MCP add-ons");

addonCmd
  .command("add")
  .description("Install an MCP add-on")
  .argument("<name>", "Add-on name (e.g., slack, github)")
  .action(async (name: string) => {
    await addonAdd(name);
  });

addonCmd
  .command("list")
  .description("List available and installed add-ons")
  .action(async () => {
    await addonList();
  });

addonCmd
  .command("remove")
  .description("Remove an installed add-on")
  .argument("<name>", "Add-on name")
  .action(async (name: string) => {
    await addonRemove(name);
  });

program
  .command("start")
  .description("Start the AEGIS gateway")
  .action(async () => {
    await startCommand();
  });

program
  .command("status")
  .description("Show AEGIS status")
  .action(async () => {
    await statusCommand();
  });

await program.parseAsync(process.argv);
