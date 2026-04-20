import { spawn } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Message } from "@mariozechner/pi-ai";
import { getMarkdownTheme, parseFrontmatter, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";

const AGENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "markov-design-agents");

type ConvergenceStatus = "not_ready" | "maturing" | "near_convergence" | "converged_enough_for_decision";
type ReadinessStatus = "needs_user_input" | "ready_after_revision" | "stop";
type RiskSeverity = "low" | "medium" | "high";
type DecisionStatus = "tentative" | "accepted";
type TradeoffStatus = "identified" | "accepted" | "unresolved";
type ArtifactType = "rfc" | "hld" | "topology" | "final-summary";

interface RejectedAlternative {
  alternative: string;
  reason_rejected: string;
}

interface RiskItem {
  risk: string;
  severity: RiskSeverity;
  notes: string;
}

interface DecisionItem {
  decision: string;
  rationale: string;
  status: DecisionStatus;
}

interface TradeoffItem {
  tradeoff: string;
  benefit: string;
  cost: string;
  status: TradeoffStatus;
}

interface ConfidenceLevels {
  problem_understanding: number;
  domain_fit: number;
  technical_feasibility: number;
  operational_viability: number;
  constraint_alignment: number;
}

interface CanonicalState {
  design_snapshot: string;
  assumptions: string[];
  open_questions: string[];
  rejected_alternatives: RejectedAlternative[];
  risks: RiskItem[];
  decisions: DecisionItem[];
  confidence_levels: ConfidenceLevels;
  tradeoffs: TradeoffItem[];
  change_log: string[];
  iteration: number;
}

interface StageResult {
  agent: string;
  status: "ok" | "needs_user_input" | "invalid";
  findings: string[];
  recommended_changes: string[];
  open_questions: string[];
  proposed_state_patch: Record<string, unknown>;
  [key: string]: unknown;
}

interface SynthesisResult extends StageResult {
  what_works: string[];
  what_does_not_work: string[];
  remaining_unknowns: string[];
  proposed_state: CanonicalState;
  readiness_status: ReadinessStatus;
  convergence_status: ConvergenceStatus;
}

interface WriterResult {
  agent: string;
  status: "ok" | "invalid";
  artifact_type: ArtifactType;
  artifact_markdown: string;
}

interface AgentConfig {
  name: string;
  description: string;
  model?: string;
  systemPrompt: string;
}

interface RunAgentResult {
  exitCode: number;
  messages: Message[];
  stderr: string;
  stopReason?: string;
  errorMessage?: string;
}

function getModelRef(model: { provider: string; id: string } | undefined): string | undefined {
  return model ? `${model.provider}/${model.id}` : undefined;
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const execName = basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }

  return { command: "pi", args };
}

function getFinalOutput(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    for (const part of message.content) {
      if (part.type === "text") return part.text;
    }
  }
  return "";
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function parseJsonObject(text: string): Record<string, unknown> {
  return JSON.parse(stripCodeFence(text)) as Record<string, unknown>;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeStringArray(value: unknown): string[] {
  return isStringArray(value) ? value : [];
}

function sanitizeConfidenceLevels(value: unknown): ConfidenceLevels {
  const source = isRecord(value) ? value : {};
  const read = (key: keyof ConfidenceLevels) => {
    const raw = source[key];
    return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  };
  return {
    problem_understanding: read("problem_understanding"),
    domain_fit: read("domain_fit"),
    technical_feasibility: read("technical_feasibility"),
    operational_viability: read("operational_viability"),
    constraint_alignment: read("constraint_alignment"),
  };
}

function sanitizeRejectedAlternatives(value: unknown): RejectedAlternative[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => ({
      alternative: typeof item.alternative === "string" ? item.alternative : "",
      reason_rejected: typeof item.reason_rejected === "string" ? item.reason_rejected : "",
    }))
    .filter((item) => item.alternative || item.reason_rejected);
}

function sanitizeRisks(value: unknown): RiskItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => ({
      risk: typeof item.risk === "string" ? item.risk : "",
      severity: item.severity === "low" || item.severity === "medium" || item.severity === "high" ? item.severity : "medium",
      notes: typeof item.notes === "string" ? item.notes : "",
    }))
    .filter((item) => item.risk);
}

function sanitizeDecisions(value: unknown): DecisionItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => ({
      decision: typeof item.decision === "string" ? item.decision : "",
      rationale: typeof item.rationale === "string" ? item.rationale : "",
      status: item.status === "accepted" ? "accepted" : "tentative",
    }))
    .filter((item) => item.decision);
}

function sanitizeTradeoffs(value: unknown): TradeoffItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => ({
      tradeoff: typeof item.tradeoff === "string" ? item.tradeoff : "",
      benefit: typeof item.benefit === "string" ? item.benefit : "",
      cost: typeof item.cost === "string" ? item.cost : "",
      status: item.status === "accepted" || item.status === "unresolved" ? item.status : "identified",
    }))
    .filter((item) => item.tradeoff);
}

function createInitialState(initialGoal: string): CanonicalState {
  return {
    design_snapshot: initialGoal,
    assumptions: [],
    open_questions: [],
    rejected_alternatives: [],
    risks: [],
    decisions: [],
    confidence_levels: {
      problem_understanding: 0,
      domain_fit: 0,
      technical_feasibility: 0,
      operational_viability: 0,
      constraint_alignment: 0,
    },
    tradeoffs: [],
    change_log: ["Initialized Markov Design workflow"],
    iteration: 0,
  };
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function dedupeObjects<T>(values: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function mergeCanonicalState(base: CanonicalState, patch: Record<string, unknown>): CanonicalState {
  return {
    design_snapshot:
      typeof patch.design_snapshot === "string" && patch.design_snapshot.trim() ? patch.design_snapshot : base.design_snapshot,
    assumptions: dedupeStrings([...base.assumptions, ...sanitizeStringArray(patch.assumptions)]),
    open_questions: dedupeStrings([...base.open_questions, ...sanitizeStringArray(patch.open_questions)]),
    rejected_alternatives: dedupeObjects([
      ...base.rejected_alternatives,
      ...sanitizeRejectedAlternatives(patch.rejected_alternatives),
    ]),
    risks: dedupeObjects([...base.risks, ...sanitizeRisks(patch.risks)]),
    decisions: dedupeObjects([...base.decisions, ...sanitizeDecisions(patch.decisions)]),
    confidence_levels: sanitizeConfidenceLevels({
      ...base.confidence_levels,
      ...(isRecord(patch.confidence_levels) ? patch.confidence_levels : {}),
    }),
    tradeoffs: dedupeObjects([...base.tradeoffs, ...sanitizeTradeoffs(patch.tradeoffs)]),
    change_log: dedupeStrings([...base.change_log, ...sanitizeStringArray(patch.change_log)]),
    iteration:
      typeof patch.iteration === "number" && Number.isFinite(patch.iteration)
        ? patch.iteration
        : base.iteration + 1,
  };
}

function loadAgents(): Map<string, AgentConfig> {
  const agents = new Map<string, AgentConfig>();
  for (const entry of readdirSync(AGENTS_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = join(AGENTS_DIR, entry.name);
    const raw = readFileSync(filePath, "utf8");
    const { frontmatter, body } = parseFrontmatter<Record<string, string>>(raw);
    agents.set(basename(entry.name, ".md"), {
      name: basename(entry.name, ".md"),
      description: frontmatter.description || basename(entry.name, ".md"),
      model: frontmatter.model,
      systemPrompt: body.trim(),
    });
  }
  return agents;
}

async function runAgent(
  agent: AgentConfig,
  payload: Record<string, unknown>,
  cwd: string,
  signal?: AbortSignal,
  modelOverride?: string,
): Promise<RunAgentResult> {
  const args = [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "--no-tools",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
  ];

  const selectedModel = modelOverride ?? agent.model;
  if (selectedModel) args.push("--model", selectedModel);
  if (agent.systemPrompt) args.push("--append-system-prompt", agent.systemPrompt);
  args.push(JSON.stringify(payload, null, 2));

  return await new Promise<RunAgentResult>((resolve) => {
    const invocation = getPiInvocation(args);
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const messages: Message[] = [];
    let stderr = "";
    let stopReason: string | undefined;
    let errorMessage: string | undefined;
    let buffer = "";

    const processLine = (line: string) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line) as Record<string, any>;
        if (event.type === "message_end" && event.message) {
          const message = event.message as Message;
          messages.push(message);
          if (message.role === "assistant") {
            stopReason = message.stopReason;
            errorMessage = message.errorMessage;
          }
        }
      } catch {
        // ignore malformed lines from subprocess output
      }
    };

    child.stdout.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) processLine(line);
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (buffer.trim()) processLine(buffer);
      resolve({
        exitCode: code ?? 1,
        messages,
        stderr,
        stopReason,
        errorMessage,
      });
    });

    child.on("error", (error) => {
      resolve({
        exitCode: 1,
        messages,
        stderr: error.message,
        stopReason,
        errorMessage,
      });
    });

    if (signal) {
      const kill = () => {
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 3000);
      };
      if (signal.aborted) kill();
      else signal.addEventListener("abort", kill, { once: true });
    }
  });
}

function validateStageResult(value: Record<string, unknown>): StageResult {
  if (
    typeof value.agent !== "string" ||
    (value.status !== "ok" && value.status !== "needs_user_input" && value.status !== "invalid")
  ) {
    throw new Error("Invalid stage output contract");
  }

  return {
    agent: value.agent,
    status: value.status,
    findings: sanitizeStringArray(value.findings),
    recommended_changes: sanitizeStringArray(value.recommended_changes),
    open_questions: sanitizeStringArray(value.open_questions),
    proposed_state_patch: isRecord(value.proposed_state_patch) ? value.proposed_state_patch : {},
    ...value,
  };
}

function validateSynthesisResult(value: Record<string, unknown>): SynthesisResult {
  const base = validateStageResult(value);
  const readiness =
    value.readiness_status === "ready_after_revision" || value.readiness_status === "stop"
      ? value.readiness_status
      : "needs_user_input";
  const convergence =
    value.convergence_status === "maturing" ||
    value.convergence_status === "near_convergence" ||
    value.convergence_status === "converged_enough_for_decision"
      ? value.convergence_status
      : "not_ready";

  return {
    ...base,
    what_works: sanitizeStringArray(value.what_works),
    what_does_not_work: sanitizeStringArray(value.what_does_not_work),
    remaining_unknowns: sanitizeStringArray(value.remaining_unknowns),
    proposed_state: mergeCanonicalState(createInitialState(""), isRecord(value.proposed_state) ? value.proposed_state : {}),
    readiness_status: readiness,
    convergence_status: convergence,
  };
}

function validateWriterResult(value: Record<string, unknown>): WriterResult {
  if (
    typeof value.agent !== "string" ||
    (value.status !== "ok" && value.status !== "invalid") ||
    (value.artifact_type !== "rfc" &&
      value.artifact_type !== "hld" &&
      value.artifact_type !== "topology" &&
      value.artifact_type !== "final-summary") ||
    typeof value.artifact_markdown !== "string"
  ) {
    throw new Error("Invalid writer output contract");
  }

  return value as WriterResult;
}

function formatList(items: string[], empty = "None") {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`;
}

function formatRisks(items: RiskItem[], limit = 5): string {
  if (items.length === 0) return "- None";
  return items.slice(0, limit).map((item) => `- ${item.risk} (${item.severity})${item.notes ? ` — ${item.notes}` : ""}`).join("\n");
}

function formatDecisions(items: DecisionItem[], limit = 5): string {
  if (items.length === 0) return "- None";
  return items
    .slice(0, limit)
    .map((item) => `- ${item.decision} [${item.status}]${item.rationale ? ` — ${item.rationale}` : ""}`)
    .join("\n");
}

function formatTradeoffs(items: TradeoffItem[], limit = 5): string {
  if (items.length === 0) return "- None";
  return items
    .slice(0, limit)
    .map((item) => `- ${item.tradeoff} [${item.status}]\n  - Benefit: ${item.benefit || "n/a"}\n  - Cost: ${item.cost || "n/a"}`)
    .join("\n");
}

function buildNodeReportMarkdown(
  iteration: number,
  nodeGoal: string,
  synthesis: SynthesisResult,
  state: CanonicalState,
  clarifier: StageResult,
  adversary: StageResult,
  constraintReviewer: StageResult,
): string {
  return [
    `# Markov Design Node ${iteration}`,
    "",
    `## Current State Assessment`,
    `- Node goal: ${nodeGoal}`,
    `- Convergence status: ${synthesis.convergence_status}`,
    `- Readiness status: ${synthesis.readiness_status}`,
    "",
    "## What Works",
    formatList(synthesis.what_works),
    "",
    "## What Does Not Work",
    formatList(synthesis.what_does_not_work),
    "",
    "## Remaining Unknowns",
    formatList(synthesis.remaining_unknowns),
    "",
    "## Key Assumptions Exposed",
    formatList(state.assumptions.slice(0, 8)),
    "",
    "## Constraint Issues",
    formatList(sanitizeStringArray(constraintReviewer.constraint_conflicts)),
    "",
    "## Top Open Questions for the User",
    formatList(dedupeStrings([...synthesis.open_questions, ...state.open_questions]).slice(0, 5)),
    "",
    "## Recommended State Updates",
    formatList(synthesis.recommended_changes),
    "",
    "## Proposed State Preview",
    `- Design snapshot: ${state.design_snapshot || "(empty)"}`,
    "",
    "### Risks",
    formatRisks(state.risks),
    "",
    "### Decisions",
    formatDecisions(state.decisions),
    "",
    "### Tradeoffs",
    formatTradeoffs(state.tradeoffs),
    "",
    "### Confidence Levels",
    `- Problem understanding: ${state.confidence_levels.problem_understanding}`,
    `- Domain fit: ${state.confidence_levels.domain_fit}`,
    `- Technical feasibility: ${state.confidence_levels.technical_feasibility}`,
    `- Operational viability: ${state.confidence_levels.operational_viability}`,
    `- Constraint alignment: ${state.confidence_levels.constraint_alignment}`,
    "",
    "## Stage Highlights",
    "### Clarifier",
    formatList(clarifier.findings.slice(0, 5)),
    "",
    "### Adversary",
    formatList(adversary.findings.slice(0, 5)),
    "",
    "### Constraint Reviewer",
    formatList(constraintReviewer.findings.slice(0, 5)),
  ].join("\n");
}

async function runStage(
  ctx: Parameters<ExtensionAPI["registerCommand"]>[1]["handler"] extends (
    args: string,
    ctx: infer T,
  ) => any
    ? T
    : never,
  agents: Map<string, AgentConfig>,
  agentName: string,
  payload: Record<string, unknown>,
) {
  const agent = agents.get(agentName);
  if (!agent) throw new Error(`Missing bundled agent: ${agentName}`);
  ctx.ui.setStatus("markov-design", `Running ${agentName}...`);
  const result = await runAgent(agent, payload, ctx.cwd, ctx.signal, getModelRef(ctx.model));
  const output = getFinalOutput(result.messages);
  if (result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted") {
    throw new Error(result.errorMessage || result.stderr || output || `${agentName} failed`);
  }
  if (!output.trim()) throw new Error(`${agentName} returned no output`);
  return parseJsonObject(output);
}

function nextNodeGoal(initialGoal: string, state: CanonicalState, userInputs: string[]): string {
  return userInputs[0] || state.open_questions[0] || state.design_snapshot || initialGoal;
}

export default function markovDesign(pi: ExtensionAPI) {
  pi.registerMessageRenderer("markov-design.report", (message, _options, theme) => {
    const container = new Container();
    container.addChild(new Text(theme.fg("accent", theme.bold("Markov Design Report")), 0, 0));
    container.addChild(new Spacer(1));
    container.addChild(new Markdown(String(message.content), 0, 0, getMarkdownTheme()));
    return container;
  });

  pi.registerMessageRenderer("markov-design.artifact", (message, _options, theme) => {
    const container = new Container();
    container.addChild(new Text(theme.fg("success", theme.bold("Markov Design Artifact")), 0, 0));
    container.addChild(new Spacer(1));
    container.addChild(new Markdown(String(message.content), 0, 0, getMarkdownTheme()));
    return container;
  });

  pi.registerCommand("markov-design", {
    description: "Start the Markov Design workflow",
    handler: async (args, ctx) => {
      const agents = loadAgents();
      let hitIterationLimit = false;

      try {
        const requestedGoal = args.trim() || (await ctx.ui.input("Markov Design", "What should this design workflow focus on?"));
        if (!requestedGoal?.trim()) {
          ctx.ui.notify("Markov Design cancelled", "info");
          return;
        }

        const initialGoal = requestedGoal.trim();
        const title = initialGoal.split("\n")[0].slice(0, 80);
        pi.setSessionName(`Markov: ${title}`);

        let state = createInitialState(initialGoal);
        let convergence: ConvergenceStatus = "not_ready";
        let userInputs = [initialGoal];
        let finalSynthesis: SynthesisResult | null = null;

        for (let iteration = 1; iteration <= 12; iteration++) {
          const nodeGoal = nextNodeGoal(initialGoal, state, userInputs);
          const baseEnvelope = {
            canonical_state: state,
            current_node: `node-${iteration}`,
            node_goal: nodeGoal,
            user_inputs: userInputs,
            convergence_status: convergence,
          };

          const clarifier = validateStageResult(
            await runStage(ctx, agents, "markov-clarifier", {
              ...baseEnvelope,
              prior_stage_outputs: [],
            }),
          );
          const adversary = validateStageResult(
            await runStage(ctx, agents, "markov-adversary", {
              ...baseEnvelope,
              prior_stage_outputs: [clarifier],
            }),
          );
          const constraintReviewer = validateStageResult(
            await runStage(ctx, agents, "markov-constraint-reviewer", {
              ...baseEnvelope,
              prior_stage_outputs: [clarifier, adversary],
            }),
          );
          const synthesis = validateSynthesisResult(
            await runStage(ctx, agents, "markov-synthesis", {
              ...baseEnvelope,
              prior_stage_outputs: [clarifier, adversary, constraintReviewer],
            }),
          );

          if (clarifier.status === "invalid" || adversary.status === "invalid" || constraintReviewer.status === "invalid" || synthesis.status === "invalid") {
            throw new Error("Markov stage returned invalid output");
          }

          state = mergeCanonicalState(state, synthesis.proposed_state_patch);
          convergence = synthesis.convergence_status;
          finalSynthesis = synthesis;

          pi.sendMessage({
            customType: "markov-design.report",
            content: buildNodeReportMarkdown(iteration, nodeGoal, synthesis, state, clarifier, adversary, constraintReviewer),
            display: true,
            details: { iteration, convergence },
          });

          const action = await ctx.ui.select("Markov Design", [
            "Revise the design",
            "Answer open questions",
            "Accept/reject tradeoffs",
            "Confirm readiness for next node",
            "Stop and summarize",
          ]);

          if (!action) {
            ctx.ui.notify("Markov Design cancelled", "info");
            return;
          }

          if (action === "Stop and summarize") {
            const artifactChoice = await ctx.ui.select("Generate artifact", [
              "RFC",
              "High-level design document",
              "Topological design graph",
              "Skip artifact generation",
            ]);
            if (!artifactChoice) {
              ctx.ui.notify("Artifact generation cancelled", "info");
              return;
            }

            const writerName =
              artifactChoice === "RFC"
                ? "markov-rfc-writer"
                : artifactChoice === "High-level design document"
                  ? "markov-hld-writer"
                  : artifactChoice === "Topological design graph"
                    ? "markov-topology-writer"
                    : "markov-final-summary-writer";

            const writer = validateWriterResult(
              await runStage(ctx, agents, writerName, {
                canonical_state: state,
                final_synthesis: finalSynthesis,
                artifact_title: title,
                artifact_goal: initialGoal,
                user_constraints: state.assumptions,
              }),
            );

            if (writer.status === "invalid") {
              throw new Error(`${writerName} returned invalid output`);
            }

            pi.sendMessage({
              customType: "markov-design.artifact",
              content: writer.artifact_markdown,
              display: true,
              details: { artifactType: writer.artifact_type },
            });
            return;
          }

          const prompt =
            action === "Revise the design"
              ? "Describe the revision you want to make to the design."
              : action === "Answer open questions"
                ? `Answer these open questions:\n\n${state.open_questions.slice(0, 5).map((item, index) => `${index + 1}. ${item}`).join("\n")}`
                : action === "Accept/reject tradeoffs"
                  ? `Review these tradeoffs and state what to accept, reject, or reframe:\n\n${state.tradeoffs
                      .slice(0, 5)
                      .map((item, index) => `${index + 1}. ${item.tradeoff} [${item.status}]`)
                      .join("\n")}`
                  : "State what should be the focus of the next node.";

          const response = await ctx.ui.editor(`Markov Design: ${action}`, prompt);
          if (!response?.trim()) {
            userInputs = [`User selected: ${action}`];
            state.change_log = dedupeStrings([...state.change_log, `Iteration ${iteration}: ${action}`]);
          } else {
            userInputs = [response.trim()];
            state.change_log = dedupeStrings([...state.change_log, `Iteration ${iteration}: ${action} — ${response.trim()}`]);
          }

          if (iteration === 12) {
            hitIterationLimit = true;
          }
        }

        if (hitIterationLimit && finalSynthesis) {
          ctx.ui.notify("Markov Design reached the iteration limit without final artifact generation", "warning");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Markov Design failed: ${message}`, "error");
        throw error;
      } finally {
        ctx.ui.setStatus("markov-design", undefined);
      }
    },
  });
}
