import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";

export interface PiSubprocessOptions {
  cwd: string;
  args: string[];
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface PiSubprocessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export function getPiInvocation(args: string[]): { command: string; args: string[] } {
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

export async function runPiSubprocess(options: PiSubprocessOptions): Promise<PiSubprocessResult> {
  const startedAt = Date.now();

  return await new Promise<PiSubprocessResult>((resolve) => {
    const invocation = getPiInvocation(options.args);
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: Omit<PiSubprocessResult, "durationMs">) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({ ...result, durationMs: Date.now() - startedAt });
    };

    const terminate = () => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 3000);
    };

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      finish({ exitCode: code ?? 1, stdout, stderr });
    });

    child.on("error", (error) => {
      finish({ exitCode: 1, stdout, stderr: stderr || error.message });
    });

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeout = setTimeout(() => {
        stderr += `${stderr ? "\n" : ""}Subagent timed out after ${options.timeoutMs}ms`;
        terminate();
      }, options.timeoutMs);
    }

    if (options.signal) {
      if (options.signal.aborted) terminate();
      else options.signal.addEventListener("abort", terminate, { once: true });
    }
  });
}
