import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { StringEnum } from "@mariozechner/pi-ai";
import { withFileMutationQueue, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

type CommandResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

type GitSnapshot = {
  repoRoot: string;
  branch: string;
  status: string;
  diffStat: string;
  cachedDiffStat: string;
  diff: string;
  cachedDiff: string;
};

type MediaKind = "image" | "video";

type MediaItem = {
  path: string;
  kind: MediaKind;
  caption?: string;
};

const MediaItemSchema = Type.Object({
  path: Type.String({ description: "Path to an image or video file, relative to the current working directory unless absolute" }),
  kind: StringEnum(["image", "video"] as const, { description: "Whether the media file is an image or video" }),
  caption: Type.Optional(Type.String({ description: "Optional caption to show under the media" })),
});

const EvaluationDeckParams = Type.Object({
  title: Type.String({ description: "Title for the evaluation deck" }),
  summary: Type.String({ description: "Short summary of what changed and what the user should learn from the deck" }),
  focus: Type.Optional(Type.String({ description: "Optional evaluation focus such as UX, architecture, bug fix, or performance" })),
  outputPath: Type.Optional(
    Type.String({ description: "HTML output file path. Defaults to .pi/evaluations/<timestamp>-evaluation-deck.html" }),
  ),
  verificationCommands: Type.Optional(
    Type.Array(Type.String(), {
      description: "Commands to verify the work, such as tests, lint, builds, or app-specific checks. Any failing command causes the tool to error after writing the deck.",
    }),
  ),
  captureCommands: Type.Optional(
    Type.Array(Type.String(), {
      description: "Optional commands to generate screenshots or videos before the deck is written. If any command fails, the tool errors after writing the deck.",
    }),
  ),
  media: Type.Optional(
    Type.Array(MediaItemSchema, {
      description: "Screenshots or videos to embed in the deck. Paths are resolved relative to the current working directory unless absolute.",
    }),
  ),
  includeGitDiff: Type.Optional(
    Type.Boolean({
      description: "Whether to include git status, diff stats, and full diffs when inside a git repository. Defaults to true.",
      default: true,
    }),
  ),
});

type EvaluationDeckInput = {
  title: string;
  summary: string;
  focus?: string;
  outputPath?: string;
  verificationCommands?: string[];
  captureCommands?: string[];
  media?: MediaItem[];
  includeGitDiff?: boolean;
};

type EvaluationDeckResult = {
  outputPath: string;
  mediaCount: number;
  verificationCommands: string[];
  captureCommands: string[];
  repoRoot?: string;
};

function stripLeadingAt(path: string): string {
  return path.startsWith("@") ? path.slice(1) : path;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function makeTimestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function runShellCommand(pi: ExtensionAPI, command: string, cwd: string, signal?: AbortSignal): Promise<CommandResult> {
  const result = await pi.exec("bash", ["-lc", `cd ${shellQuote(cwd)} && ${command}`], { signal });
  return {
    command,
    exitCode: result.code ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

async function maybeCollectGitSnapshot(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<GitSnapshot | null> {
  const repoCheck = await runShellCommand(pi, "git rev-parse --show-toplevel", cwd, signal);
  if (repoCheck.exitCode !== 0) return null;

  const repoRoot = repoCheck.stdout.trim().split(/\r?\n/).at(-1)?.trim();
  if (!repoRoot) return null;

  const [branch, status, diffStat, cachedDiffStat, diff, cachedDiff] = await Promise.all([
    runShellCommand(pi, "git rev-parse --abbrev-ref HEAD", repoRoot, signal),
    runShellCommand(pi, "git status --short", repoRoot, signal),
    runShellCommand(pi, "git diff --stat --no-color", repoRoot, signal),
    runShellCommand(pi, "git diff --cached --stat --no-color", repoRoot, signal),
    runShellCommand(pi, "git diff --no-color", repoRoot, signal),
    runShellCommand(pi, "git diff --cached --no-color", repoRoot, signal),
  ]);

  return {
    repoRoot,
    branch: branch.stdout.trim(),
    status: status.stdout.trim(),
    diffStat: diffStat.stdout.trim(),
    cachedDiffStat: cachedDiffStat.stdout.trim(),
    diff: diff.stdout.trim(),
    cachedDiff: cachedDiff.stdout.trim(),
  };
}

async function validateMedia(outputPath: string, cwd: string, media: MediaItem[]): Promise<Array<MediaItem & { absolutePath: string; relativeToDeck: string }>> {
  const outputDir = dirname(outputPath);
  const validated: Array<MediaItem & { absolutePath: string; relativeToDeck: string }> = [];

  for (const item of media) {
    const absolutePath = resolve(cwd, stripLeadingAt(item.path));
    await access(absolutePath);
    validated.push({
      ...item,
      absolutePath,
      relativeToDeck: relative(outputDir, absolutePath) || ".",
    });
  }

  return validated;
}

function renderCommandList(title: string, results: CommandResult[]): string {
  const items = results.length
    ? results
        .map((result) => {
          const combinedOutput = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n\n");
          return `
            <div class="command-card ${result.exitCode === 0 ? "ok" : "fail"}">
              <div class="command-header">
                <span class="badge ${result.exitCode === 0 ? "ok" : "fail"}">${result.exitCode === 0 ? "PASS" : "FAIL"}</span>
                <code>${escapeHtml(result.command)}</code>
              </div>
              <div class="command-meta">exit code: ${result.exitCode}</div>
              <pre>${escapeHtml(combinedOutput || "(no output)")}</pre>
            </div>
          `;
        })
        .join("\n")
    : `<p>No ${escapeHtml(title.toLowerCase())} were run.</p>`;

  return `
    <section class="slide">
      <h2>${escapeHtml(title)}</h2>
      <div class="stack">${items}</div>
    </section>
  `;
}

function renderMediaSlides(media: Array<MediaItem & { relativeToDeck: string }>): string {
  if (media.length === 0) {
    return `
      <section class="slide">
        <h2>Captured Media</h2>
        <p>No screenshots or videos were attached to this evaluation run.</p>
      </section>
    `;
  }

  return media
    .map((item, index) => {
      const asset = item.kind === "video"
        ? `<video controls preload="metadata" src="${escapeHtml(item.relativeToDeck)}"></video>`
        : `<img src="${escapeHtml(item.relativeToDeck)}" alt="${escapeHtml(item.caption || `Media ${index + 1}`)}" />`;

      return `
        <section class="slide media-slide">
          <h2>${escapeHtml(item.caption || `Media ${index + 1}`)}</h2>
          <div class="media-frame">${asset}</div>
          <p class="media-path">${escapeHtml(item.path)}</p>
        </section>
      `;
    })
    .join("\n");
}

function renderGitSlides(git: GitSnapshot | null): string {
  if (!git) {
    return `
      <section class="slide">
        <h2>Repository Snapshot</h2>
        <p>No git repository was detected from the working directory.</p>
      </section>
    `;
  }

  return `
    <section class="slide">
      <h2>Repository Snapshot</h2>
      <ul>
        <li><strong>Repository root:</strong> ${escapeHtml(git.repoRoot)}</li>
        <li><strong>Branch:</strong> ${escapeHtml(git.branch || "(unknown)")}</li>
      </ul>
      <h3>Status</h3>
      <pre>${escapeHtml(git.status || "(clean)")}</pre>
      <h3>Diff stat</h3>
      <pre>${escapeHtml([git.diffStat, git.cachedDiffStat].filter(Boolean).join("\n\n") || "(no diff stat)")}</pre>
    </section>
    <section class="slide wide">
      <h2>Full Diff</h2>
      <pre>${escapeHtml([git.diff, git.cachedDiff].filter(Boolean).join("\n\n") || "(no diff)")}</pre>
    </section>
  `;
}

function buildDeckHtml(input: {
  title: string;
  summary: string;
  focus?: string;
  generatedAt: string;
  cwd: string;
  outputPath: string;
  git: GitSnapshot | null;
  captureResults: CommandResult[];
  verificationResults: CommandResult[];
  media: Array<MediaItem & { relativeToDeck: string }>;
}): string {
  const failingChecks = input.verificationResults.filter((result) => result.exitCode !== 0).length;
  const failingCaptures = input.captureResults.filter((result) => result.exitCode !== 0).length;
  const overallStatus = failingChecks === 0 && failingCaptures === 0 ? "ready" : "needs-fix";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.title)}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b1020;
      --panel: #111827;
      --panel-alt: #172033;
      --text: #f8fafc;
      --muted: #94a3b8;
      --ok: #22c55e;
      --fail: #ef4444;
      --accent: #60a5fa;
      --border: rgba(148, 163, 184, 0.25);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      background: linear-gradient(180deg, #0b1020 0%, #0f172a 100%);
      color: var(--text);
    }
    .deck {
      width: 100%;
    }
    .slide {
      min-height: 100vh;
      padding: 3rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 1rem;
      justify-content: flex-start;
    }
    .slide:nth-child(odd) { background: rgba(15, 23, 42, 0.8); }
    .slide:nth-child(even) { background: rgba(17, 24, 39, 0.92); }
    .wide pre { max-height: 70vh; }
    h1, h2, h3 { margin: 0; }
    h1 { font-size: clamp(2.25rem, 5vw, 4rem); }
    h2 { font-size: clamp(1.5rem, 3vw, 2.5rem); }
    p, li { line-height: 1.5; }
    ul { margin: 0; padding-left: 1.2rem; }
    .hero {
      justify-content: center;
      background: radial-gradient(circle at top right, rgba(96, 165, 250, 0.25), transparent 40%), rgba(11, 16, 32, 0.95);
    }
    .meta, .media-path, .command-meta {
      color: var(--muted);
      font-size: 0.95rem;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 0.2rem 0.6rem;
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .badge.ok { background: rgba(34, 197, 94, 0.18); color: #86efac; }
    .badge.fail { background: rgba(239, 68, 68, 0.18); color: #fca5a5; }
    .badge.ready { background: rgba(96, 165, 250, 0.18); color: #bfdbfe; }
    .stack {
      display: grid;
      gap: 1rem;
    }
    .command-card {
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 1rem;
      background: var(--panel);
    }
    .command-card.fail { border-color: rgba(239, 68, 68, 0.45); }
    .command-card.ok { border-color: rgba(34, 197, 94, 0.35); }
    .command-header {
      display: flex;
      gap: 0.75rem;
      align-items: center;
      margin-bottom: 0.5rem;
      flex-wrap: wrap;
    }
    pre, code {
      font-family: "SFMono-Regular", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    pre {
      margin: 0;
      padding: 1rem;
      border-radius: 12px;
      background: rgba(15, 23, 42, 0.95);
      overflow: auto;
      border: 1px solid rgba(148, 163, 184, 0.15);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .media-frame {
      flex: 1;
      min-height: 0;
      display: grid;
      place-items: center;
      background: rgba(15, 23, 42, 0.55);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 1rem;
    }
    .media-frame img,
    .media-frame video {
      max-width: 100%;
      max-height: 72vh;
      border-radius: 12px;
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.4);
    }
    .footer {
      position: fixed;
      right: 1rem;
      bottom: 1rem;
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 0.5rem 0.8rem;
      color: var(--muted);
      font-size: 0.85rem;
      backdrop-filter: blur(12px);
    }
  </style>
</head>
<body>
  <main class="deck">
    <section class="slide hero">
      <span class="badge ${overallStatus === "ready" ? "ready" : "fail"}">${overallStatus === "ready" ? "evaluation ready" : "needs fixes"}</span>
      <h1>${escapeHtml(input.title)}</h1>
      <p>${escapeHtml(input.summary)}</p>
      <div class="meta">
        <div><strong>Generated:</strong> ${escapeHtml(input.generatedAt)}</div>
        <div><strong>Working directory:</strong> ${escapeHtml(input.cwd)}</div>
        <div><strong>Deck path:</strong> ${escapeHtml(input.outputPath)}</div>
        <div><strong>Focus:</strong> ${escapeHtml(input.focus || "general evaluation")}</div>
      </div>
    </section>
    <section class="slide">
      <h2>Evaluation Summary</h2>
      <ul>
        <li><strong>Verification failures:</strong> ${failingChecks}</li>
        <li><strong>Capture failures:</strong> ${failingCaptures}</li>
        <li><strong>Media items:</strong> ${input.media.length}</li>
        <li><strong>Loopback guidance:</strong> If any command failed, return to design or implementation, resolve the issue, and regenerate this deck.</li>
      </ul>
    </section>
    ${renderCommandList("Capture Commands", input.captureResults)}
    ${renderCommandList("Verification Commands", input.verificationResults)}
    ${renderMediaSlides(input.media)}
    ${renderGitSlides(input.git)}
  </main>
  <div class="footer">Scroll through the deck to review the work, evidence, and any loopback conditions.</div>
</body>
</html>`;
}

function parseLineList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseMediaList(text: string): MediaItem[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [kindRaw, pathRaw, ...captionParts] = line.split("|").map((part) => part.trim());
      if ((kindRaw !== "image" && kindRaw !== "video") || !pathRaw) {
        throw new Error(`Invalid media line: ${line}. Use image|path|caption or video|path|caption.`);
      }
      return {
        kind: kindRaw,
        path: pathRaw,
        caption: captionParts.join(" | ") || undefined,
      } satisfies MediaItem;
    });
}

async function generateEvaluationDeck(
  pi: ExtensionAPI,
  cwd: string,
  params: EvaluationDeckInput,
  signal?: AbortSignal,
): Promise<EvaluationDeckResult> {
  const generatedAt = new Date().toISOString();
  const timestamp = makeTimestamp();
  const outputPath = resolve(cwd, stripLeadingAt(params.outputPath || `.pi/evaluations/${timestamp}-evaluation-deck.html`));
  const verificationCommands = params.verificationCommands ?? [];
  const captureCommands = params.captureCommands ?? [];
  const includeGitDiff = params.includeGitDiff ?? true;
  const media = params.media ?? [];

  const captureResults: CommandResult[] = [];
  for (const command of captureCommands) {
    captureResults.push(await runShellCommand(pi, command, cwd, signal));
  }

  const verificationResults: CommandResult[] = [];
  for (const command of verificationCommands) {
    verificationResults.push(await runShellCommand(pi, command, cwd, signal));
  }

  const validatedMedia = await validateMedia(outputPath, cwd, media);
  const git = includeGitDiff ? await maybeCollectGitSnapshot(pi, cwd, signal) : null;
  const html = buildDeckHtml({
    title: params.title,
    summary: params.summary,
    focus: params.focus,
    generatedAt,
    cwd,
    outputPath,
    git,
    captureResults,
    verificationResults,
    media: validatedMedia,
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await withFileMutationQueue(outputPath, async () => {
    await writeFile(outputPath, html, "utf8");
  });

  const failedCaptures = captureResults.filter((result) => result.exitCode !== 0).map((result) => result.command);
  const failedVerifications = verificationResults.filter((result) => result.exitCode !== 0).map((result) => result.command);
  if (failedCaptures.length > 0 || failedVerifications.length > 0) {
    const failures = [
      failedCaptures.length > 0 ? `capture failures: ${failedCaptures.join("; ")}` : "",
      failedVerifications.length > 0 ? `verification failures: ${failedVerifications.join("; ")}` : "",
    ]
      .filter(Boolean)
      .join(" | ");
    throw new Error(`Evaluation deck written to ${outputPath}, but loopback is required because ${failures}.`);
  }

  return {
    outputPath,
    mediaCount: validatedMedia.length,
    verificationCommands,
    captureCommands,
    repoRoot: git?.repoRoot,
  };
}

export default function evaluationWorkflow(pi: ExtensionAPI) {
  pi.registerCommand("evaluate-work", {
    description: "Launch the evaluation workflow with a guided UI and generate an HTML deck",
    handler: async (_args, ctx) => {
      const title = await ctx.ui.input("Evaluate Work", "Deck title");
      if (!title?.trim()) {
        ctx.ui.notify("Evaluation cancelled", "info");
        return;
      }

      const summary = await ctx.ui.editor(
        "Evaluation summary",
        "Summarize what changed, what the user should learn from this deck, and what should be verified.",
      );
      if (!summary?.trim()) {
        ctx.ui.notify("Evaluation cancelled", "info");
        return;
      }

      const focus = await ctx.ui.input("Evaluation focus", "Optional focus, e.g. UX, bug fix, architecture");
      const verificationRaw = await ctx.ui.editor(
        "Verification commands",
        "One command per line. Leave blank if none.\n\npnpm test\npnpm lint",
      );
      const captureRaw = await ctx.ui.editor(
        "Capture commands",
        "One command per line. Leave blank if none.\n\npython scripts/capture-ui.py",
      );
      const mediaRaw = await ctx.ui.editor(
        "Media attachments",
        "One item per line using: image|path|caption or video|path|caption\n\nimage|artifacts/home.png|Home screen\nvideo|artifacts/demo.mp4|Feature demo",
      );
      const includeGitDiff = await ctx.ui.confirm("Include git diff?", "Include git status, diff stats, and full diff in the deck?");
      const outputPath = await ctx.ui.input(
        "Output path",
        "Optional custom HTML path. Leave blank for .pi/evaluations/<timestamp>-evaluation-deck.html",
      );

      try {
        const result = await generateEvaluationDeck(
          pi,
          ctx.cwd,
          {
            title: title.trim(),
            summary: summary.trim(),
            focus: focus?.trim() || undefined,
            outputPath: outputPath?.trim() || undefined,
            verificationCommands: parseLineList(verificationRaw ?? ""),
            captureCommands: parseLineList(captureRaw ?? ""),
            media: parseMediaList(mediaRaw ?? ""),
            includeGitDiff,
          },
          ctx.signal,
        );
        ctx.ui.notify(`Wrote evaluation deck to ${result.outputPath}`, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(message, "error");
        throw error;
      }
    },
  });

  pi.registerTool({
    name: "evaluation_deck",
    label: "Evaluation Deck",
    description:
      "Generate an HTML evaluation deck with change summary, verification results, and screenshots/videos. Use after completing substantive work. If capture or verification commands fail, this tool writes the deck and then errors so the agent can fix issues and rerun.",
    promptSnippet: "Generate an evaluation HTML deck with verification results, git change summary, and screenshots/videos.",
    promptGuidelines: [
      "Use this tool after you believe implementation is complete for a substantive task.",
      "If UI or behavior changed, include screenshots or video evidence when possible.",
      "If the tool reports failed verification or capture commands, fix the issue and rerun the evaluation instead of declaring success.",
    ],
    parameters: EvaluationDeckParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await generateEvaluationDeck(pi, ctx.cwd, params as EvaluationDeckInput, signal);
      return {
        content: [
          {
            type: "text",
            text: `Wrote evaluation deck to ${result.outputPath}. Included ${result.mediaCount} media item(s), ${result.verificationCommands.length} verification command(s), and ${result.captureCommands.length} capture command(s).`,
          },
        ],
        details: result,
      };
    },
  });
}
