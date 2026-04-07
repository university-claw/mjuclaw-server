import { execFileSync, spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { config } from "./config";

// ── OpenShell 바이너리 탐색 ──────────────────────────────────────

function resolveOpenshell(): string | null {
  try {
    const found = execFileSync("which", ["openshell"], { encoding: "utf-8" }).trim();
    if (found.startsWith("/")) return found;
  } catch { /* ignored */ }

  const home = os.homedir();
  const candidates = [
    path.join(home, ".local", "bin", "openshell"),
    "/usr/local/bin/openshell",
    "/usr/bin/openshell",
  ];
  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch { /* ignored */ }
  }
  return null;
}

const OPENSHELL = resolveOpenshell();
if (!OPENSHELL) {
  console.error("[nemoclaw] openshell not found");
  process.exit(1);
}

// ── 셸 인젝션 방지 ────────────────────────────────────────────────

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// ── 유저별 동시성 제어 ────────────────────────────────────────────

const userQueues = new Map<string, Promise<string>>();

function enqueue(userId: string, fn: () => Promise<string>): Promise<string> {
  const prev = userQueues.get(userId) || Promise.resolve("");
  const next = prev.then(fn, fn);
  userQueues.set(userId, next);
  return next;
}

// ── 에이전트 실행 ─────────────────────────────────────────────────

function execAgent(message: string, sessionId: string): Promise<string> {
  return new Promise((resolve) => {
    const sshConfig = execFileSync(OPENSHELL!, ["sandbox", "ssh-config", config.sandbox.name], {
      encoding: "utf-8",
    });

    const confDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-kakao-ssh-"));
    const confPath = path.join(confDir, "config");
    fs.writeFileSync(confPath, sshConfig, { mode: 0o600 });

    const safeSessionId = sessionId.replace(/[^a-zA-Z0-9-]/g, "");
    const cmd = [
      ". /sandbox/.bashrc",
      "&&",
      `export GEMINI_API_KEY=${shellQuote(config.sandbox.geminiApiKey)}`,
      "&&",
      "nemoclaw-start",
      "openclaw",
      "agent",
      "--agent",
      "main",
      "--json",
      "-m",
      shellQuote(message),
      "--session-id",
      shellQuote(`kakao-${safeSessionId}`),
    ].join(" ");

    const proc = spawn("ssh", ["-T", "-F", confPath, `openshell-${config.sandbox.name}`, cmd], {
      timeout: config.sandbox.agentTimeout,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

    proc.on("close", (code) => {
      try { fs.unlinkSync(confPath); fs.rmdirSync(confDir); } catch { /* ignored */ }

      // JSON 파싱 시도
      try {
        const raw = stdout.trim();
        const jsonStart = raw.indexOf("{");
        if (jsonStart !== -1) {
          const json = JSON.parse(raw.slice(jsonStart));
          const text = json?.result?.payloads?.[0]?.text || "";
          if (text && text !== "LLM request timed out.") {
            resolve(text);
            return;
          }
          if (text === "LLM request timed out.") {
            resolve("응답 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
            return;
          }
        }
      } catch { /* JSON 파싱 실패 시 아래로 */ }

      if (code !== 0) {
        resolve(`에이전트 오류 (exit ${code}). ${stderr.trim().slice(0, 300)}`);
      } else {
        resolve("(응답 없음)");
      }
    });

    proc.on("error", (err) => resolve(`에러: ${err.message}`));
  });
}

export function runAgent(message: string, userId: string): Promise<string> {
  return enqueue(userId, () => execAgent(message, userId));
}
