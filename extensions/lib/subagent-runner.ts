import { runPiSubprocess } from "./pi-subprocess";
import { getFinalOutput, parseJsonObject, parsePiJsonlOutput } from "./subagent-output";

export type ToolPreset = "none" | "read-only" | { tools: string[] };
export type ExpectedOutput = "text" | "json";

export interface SubagentJob {
  id: string;
  prompt: string;
  systemPrompt?: string;
  model?: string;
  cwd?: string;
  tools?: ToolPreset;
  expected?: ExpectedOutput;
  timeoutMs?: number;
  metadata?: Record<string, string>;
}

export interface SubagentResult {
  id: string;
  ok: boolean;
  text: string;
  json?: Record<string, unknown>;
  stderr: string;
  exitCode: number;
  stopReason?: string;
  errorMessage?: string;
  durationMs: number;
  metadata?: Record<string, string>;
}

interface SubagentOptions {
  cwd: string;
  modelRef?: string;
  signal?: AbortSignal;
}

interface BatchOptions extends SubagentOptions {
  maxConcurrency?: number;
}

function toolArgs(tools: ToolPreset | undefined): string[] {
  if (!tools || tools === "none") return ["--no-tools"];
  if (tools === "read-only") return ["--tools", "read,grep,find,ls"];
  return tools.tools.length ? ["--tools", tools.tools.join(",")] : ["--no-tools"];
}

function buildArgs(job: SubagentJob, modelRef?: string): string[] {
  const args = [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    ...toolArgs(job.tools),
  ];

  const selectedModel = job.model ?? modelRef;
  if (selectedModel) args.push("--model", selectedModel);
  if (job.systemPrompt) args.push("--append-system-prompt", job.systemPrompt);
  args.push(job.prompt);

  return args;
}

export async function runSubagent(job: SubagentJob, options: SubagentOptions): Promise<SubagentResult> {
  const result = await runPiSubprocess({
    cwd: job.cwd ?? options.cwd,
    args: buildArgs(job, options.modelRef),
    signal: options.signal,
    timeoutMs: job.timeoutMs,
  });

  const parsed = parsePiJsonlOutput(result.stdout);
  const text = getFinalOutput(parsed.messages);
  const output: SubagentResult = {
    id: job.id,
    ok: result.exitCode === 0,
    text,
    stderr: result.stderr,
    exitCode: result.exitCode,
    stopReason: parsed.stopReason,
    errorMessage: parsed.errorMessage,
    durationMs: result.durationMs,
    metadata: job.metadata,
  };

  if (job.expected === "json") {
    try {
      output.json = parseJsonObject(text);
    } catch (error) {
      output.ok = false;
      output.errorMessage = error instanceof Error ? error.message : String(error);
    }
  }

  if (parsed.errorMessage) output.ok = false;
  return output;
}

export async function runSubagents(jobs: SubagentJob[], options: BatchOptions): Promise<SubagentResult[]> {
  const maxConcurrency = Math.max(1, options.maxConcurrency ?? jobs.length);
  const results = new Array<SubagentResult>(jobs.length);
  let nextIndex = 0;

  async function worker() {
    while (!options.signal?.aborted) {
      const index = nextIndex++;
      if (index >= jobs.length) return;
      results[index] = await runSubagent(jobs[index], options);
    }
  }

  await Promise.all(Array.from({ length: Math.min(maxConcurrency, jobs.length) }, () => worker()));
  return results.filter((result): result is SubagentResult => Boolean(result));
}
