import { runAgent } from "../gateway/client.js";

export async function runCommand(message: string, opts: { agent?: string }): Promise<void> {
  const agentId = opts.agent ?? "main";

  console.log(`\n  Running agent: ${agentId}\n`);

  try {
    const result = await runAgent({ agentId, message });

    if (result.text) {
      console.log(result.text);
    } else {
      console.log("  No response from agent.");
    }
    console.log();
  } catch (err) {
    console.error(`  Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
