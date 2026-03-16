import { runBuild } from "../core/build-runner.js";
import { printBuildHeader, printEvent, printBuildResult } from "../ui/terminal.js";

export async function buildCommand(prompt: string): Promise<void> {
  let headerPrinted = false;

  const result = await runBuild(prompt, {
    onEvent: (event, phaseIndex, totalPhases, buildId) => {
      if (!headerPrinted) {
        printBuildHeader(buildId);
        headerPrinted = true;
      }
      printEvent(event, phaseIndex, totalPhases);
    },
  });

  if (!result.buildId) {
    console.error("  Failed to acquire build lock");
    process.exit(1);
  }

  if (!headerPrinted) {
    printBuildHeader(result.buildId);
  }

  printBuildResult({
    buildId: result.buildId,
    filesCreated: result.filesCreated,
    workspacePath: result.workspacePath,
    duration: result.duration,
    success: result.success,
    securitySummary: result.securitySummary,
  });

  if (!result.success) {
    process.exit(1);
  }
}
