import type { Message } from "@earendil-works/pi-ai";

export interface ParsedJsonlOutput {
  messages: Message[];
  stopReason?: string;
  errorMessage?: string;
}

export function parsePiJsonlOutput(stdout: string): ParsedJsonlOutput {
  const messages: Message[] = [];
  let stopReason: string | undefined;
  let errorMessage: string | undefined;

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as Record<string, any>;
      if (event.type !== "message_end" || !event.message) continue;
      const message = event.message as Message;
      messages.push(message);
      if (message.role === "assistant") {
        stopReason = message.stopReason;
        errorMessage = message.errorMessage;
      }
    } catch {
      // Ignore malformed non-JSONL output from subprocesses.
    }
  }

  return { messages, stopReason, errorMessage };
}

export function getFinalOutput(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    for (const part of message.content) {
      if (part.type === "text") return part.text;
    }
  }
  return "";
}

export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

export function parseJsonObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(stripCodeFence(text)) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected JSON object output");
  }
  return parsed as Record<string, unknown>;
}
