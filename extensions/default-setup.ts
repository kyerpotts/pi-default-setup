import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const instructionsUrl = new URL("../system-instructions.md", import.meta.url);
const instructionsPath = fileURLToPath(instructionsUrl);

function readInstructions(): string {
  return readFileSync(instructionsUrl, "utf8").trimEnd();
}

function normalizeInstructions(text: string): string {
  return text.replace(/\r\n/g, "\n").trimEnd();
}

function writeInstructions(text: string): void {
  writeFileSync(instructionsUrl, `${normalizeInstructions(text)}\n`, "utf8");
}

function getCompletions(prefix: string): AutocompleteItem[] | null {
  const items = ["help", "show", "edit", "path", "reload"].map((value) => ({ value, label: value }));
  const filtered = items.filter((item) => item.value.startsWith(prefix.toLowerCase()));
  return filtered.length > 0 ? filtered : null;
}

function getHelpText(): string {
  return [
    "Usage: /default-setup <subcommand>",
    "",
    "Available subcommands:",
    "- help   Show this help text",
    "- show   Display the current appended instructions",
    "- edit   Open a multi-line editor and save changes",
    "- path   Show the instructions file path",
    "- reload Reload extensions, skills, prompts, and themes",
  ].join("\n");
}

export default function appendDefaultSetup(pi: ExtensionAPI) {
  pi.registerMessageRenderer("default-setup.instructions", (message, _options, theme) => {
    const details = message.details as { path?: string } | undefined;
    const heading = theme.fg("accent", theme.bold("Default setup instructions"));
    const path = details?.path ? `${theme.fg("muted", details.path)}\n\n` : "\n";
    const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
    box.addChild(new Text(`${heading}\n${path}${String(message.content)}`, 0, 0));
    return box;
  });

  pi.registerCommand("default-setup", {
    description: "Show or edit the appended default setup instructions",
    getArgumentCompletions: getCompletions,
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();

      if (!action || action === "help") {
        pi.sendMessage({
          customType: "default-setup.instructions",
          content: getHelpText(),
          display: true,
          details: { path: instructionsPath },
        });
        return;
      }

      if (action === "show") {
        pi.sendMessage({
          customType: "default-setup.instructions",
          content: readInstructions(),
          display: true,
          details: { path: instructionsPath },
        });
        return;
      }

      if (action === "edit") {
        const current = readInstructions();
        const edited = await ctx.ui.editor("Edit default setup instructions", current);
        if (edited == null) {
          ctx.ui.notify("Edit cancelled", "info");
          return;
        }

        if (normalizeInstructions(edited) === normalizeInstructions(current)) {
          ctx.ui.notify("No changes saved", "info");
          return;
        }

        writeInstructions(edited);
        ctx.ui.notify(`Updated ${instructionsPath}. Changes apply on the next turn.`, "info");
        return;
      }

      if (action === "path") {
        ctx.ui.notify(instructionsPath, "info");
        return;
      }

      if (action === "reload") {
        await ctx.reload();
        return;
      }

      ctx.ui.notify("Usage: /default-setup <help|show|edit|path|reload>", "warning");
    },
  });

  pi.on("before_agent_start", async (event) => {
    const appendedInstructions = readInstructions();
    return {
      systemPrompt: `${event.systemPrompt}\n\n${appendedInstructions}`,
    };
  });
}
