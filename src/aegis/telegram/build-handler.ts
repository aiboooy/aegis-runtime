import { existsSync, createReadStream } from "node:fs";
import { runBuild } from "../core/build-runner.js";
import { formatProgressMessage, formatBuildResult } from "./format.js";

export function extractBuildPrompt(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("/build ")) {
    return trimmed.slice(7).trim();
  }
  if (trimmed.toLowerCase().startsWith("build: ")) {
    return trimmed.slice(7).trim();
  }
  if (trimmed.toLowerCase().startsWith("build:")) {
    return trimmed.slice(6).trim();
  }
  return null;
}

export async function handleTelegramBuild(
  ctx: {
    reply: (...args: unknown[]) => Promise<{ message_id: number }>;
    replyWithPhoto: (...args: unknown[]) => Promise<unknown>;
    api: { editMessageText: (chatId: number, messageId: number, text: string) => Promise<unknown> };
    chat: { id: number };
  },
  prompt: string,
): Promise<void> {
  const statusMsg = await ctx.reply("\u{1F3D7} Starting build...");
  const chatId = ctx.chat.id;
  const messageId = statusMsg.message_id;

  const completedPhases: string[] = [];
  let currentAgent: string | null = null;
  let buildId = "";
  let totalPhases = 3;

  const result = await runBuild(prompt, {
    onEvent: (event, _phaseIndex, phases, eventBuildId) => {
      totalPhases = phases;
      buildId = eventBuildId;

      if (event.type === "phase_start") {
        currentAgent = event.agent;
      }

      if (event.type === "phase_end") {
        completedPhases.push(event.agent);
        currentAgent = null;
      }

      // Update progress message (best effort, fire-and-forget)
      ctx.api
        .editMessageText(
          chatId,
          messageId,
          formatProgressMessage(buildId || "...", completedPhases, currentAgent, totalPhases),
        )
        .catch(() => {
          // Telegram rate limit or message unchanged — ignore
        });
    },
  });

  // Send final result
  try {
    await ctx.api.editMessageText(chatId, messageId, formatBuildResult(result));
  } catch {
    // If edit fails, send as new message
    await ctx.reply(formatBuildResult(result));
  }

  // Send screenshot if available (screenshotPath added by screenshot capture feature)
  const screenshotPath = (result as unknown as Record<string, unknown>).screenshotPath as
    | string
    | undefined;
  if (screenshotPath && existsSync(screenshotPath)) {
    try {
      const { InputFile } = await import("grammy");
      await ctx.replyWithPhoto(new InputFile(createReadStream(screenshotPath)), {
        caption: `\u{1F4F8} Screenshot of ${result.buildId}`,
      });
    } catch {
      // Screenshot send failed — non-fatal
    }
  }
}
