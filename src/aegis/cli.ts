import { Command } from "commander";

const program = new Command();

program.name("aegis").description("AEGIS — Multi-agent orchestration platform").version("0.1.0");

program
  .command("build")
  .description("Build a project using Architect + Builder agents")
  .argument("<prompt>", "What to build")
  .action(async (prompt: string) => {
    console.log(`[aegis] build: ${prompt}`);
    console.log("[aegis] Not yet implemented");
  });

program
  .command("status")
  .description("Show AEGIS status")
  .action(async () => {
    console.log("[aegis] Status: not yet implemented");
  });

await program.parseAsync(process.argv);
