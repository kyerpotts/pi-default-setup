import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";

const instructionsUrl = new URL("../system-instructions.md", import.meta.url);

export default function appendDefaultSetup(pi: ExtensionAPI) {
  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${readFileSync(instructionsUrl, "utf8").trimEnd()}`,
  }));
}
