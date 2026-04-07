import { execFileSync, spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { config } from "./config";

// ── OpenShell 바이너리 탐색 ──────────────────────────────────────

function resolveOpenshell(): string | null {
  // 1. PATH에서 찾기
  try {
    const found = execFileSync("which", ["openshell"], { encoding: "utf-8" }).trim();
    if (found.startsWith("/")) return found;
  } catch {
    /* ignored */
  }

  // 2. 알려진 경로 폴백
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
    } catch {
      /* ignored */
    }
  }
  return null;
}

const OPENSHELL = resolveOpenshell();
if (!OPENSHELL) {
  console.error("[nemoclaw] openshell not found on PATH or common locations");
  process.exit(1);
}

// ── 셸 인젝션 방지용 quote ───────────────────────────────────────

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// ── 유저별 동시성 제어 (Promise 큐) ──────────────────────────────

const userQueues = new Map<string, Promise<string>>();

function enqueue(userId: string, fn: () => Promise<string>): Promise<string> {
  const prev = userQueues.get(userId) || Promise.resolve("");
  const next = prev.then(fn, fn); // 이전 작업 실패해도 다음 실행
  userQueues.set(userId, next);
  return next;
}

// ── 에이전트 실행 ────────────────────────────────────────────────

function execAgent(message: string, sessionId: string): Promise<string> {
  return new Promise((resolve) => {
    // SSH config 생성
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
      "--local",
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
      // 임시 SSH config 정리
      try {
        fs.unlinkSync(confPath);
        fs.rmdirSync(confDir);
      } catch {
        /* ignored */
      }

      // NemoClaw 셋업 라인 필터링 (telegram-bridge.js 패턴)
      const lines = stdout.split("\n");
      const responseLines = lines.filter(
        (l) =>
          !l.startsWith("Setting up NemoClaw") &&
          !l.startsWith("[plugins]") &&
          !l.startsWith("[gateway]") &&
          !l.startsWith("(node:") &&
          !l.includes("NemoClaw ready") &&
          !l.includes("NemoClaw registered") &&
          !l.includes("openclaw agent") &&
          !l.includes("privilege separation") &&
          !l.includes("┌─") &&
          !l.includes("│ ") &&
          !l.includes("└─") &&
          l.trim() !== ""
      );

      const response = responseLines.join("\n").trim();

      if (response) {
        resolve(response);
      } else if (code !== 0) {
        resolve(`에이전트 오류 (exit ${code}). ${stderr.trim().slice(0, 300)}`);
      } else {
        resolve("(응답 없음)");
      }
    });

    proc.on("error", (err) => {
      resolve(`에러: ${err.message}`);
    });
  });
}

/**
 * 유저 메시지를 NemoClaw 샌드박스의 OpenClaw 에이전트에 전달하고 응답을 반환한다.
 * 같은 유저의 요청은 직렬화된다 (동시성 제어).
 */
export function runAgent(message: string, userId: string): Promise<string> {
  return enqueue(userId, () => execAgent(message, userId));
}
