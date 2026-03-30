import express from "express";
import { config } from "./config";
import { createImmediateResponse, createTextResponse, sendCallback } from "./kakao";
import { runAgent } from "./nemoclaw";
import { getSession, isVerified, verifyPairing, resetSession, getStats } from "./session";
import type { KakaoSkillRequest } from "./types";

export const app = express();
app.use(express.json());

const startedAt = Date.now();

// ── GET /health ──────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  const stats = getStats();
  res.json({
    status: "ok",
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    sessions: stats,
  });
});

// ── POST /skill ──────────────────────────────────────────────────

app.post("/skill", (req, res) => {
  const body = req.body as KakaoSkillRequest;
  const utterance = body.userRequest?.utterance?.trim() || "";
  const userId = body.userRequest?.user?.id || "";
  const callbackUrl = body.userRequest?.callbackUrl;

  if (!userId) {
    res.json(createTextResponse("유저 정보를 확인할 수 없습니다."));
    return;
  }

  console.log(`[skill] user=${userId.slice(0, 8)}... msg="${utterance.slice(0, 50)}"`);

  if (callbackUrl) {
    // 비동기: 즉시 응답 후 백그라운드 처리
    res.json(createImmediateResponse("생각 중..."));
    processAsync(userId, utterance, callbackUrl).catch((err) => {
      console.error(`[skill] async error: ${err.message}`);
    });
  } else {
    // 동기: 5초 내 응답 (callbackUrl 없는 경우)
    handleSync(userId, utterance)
      .then((text) => res.json(createTextResponse(text)))
      .catch(() => res.json(createTextResponse("처리 중 오류가 발생했습니다.")));
  }
});

// ── 비동기 처리 (콜백 사용) ──────────────────────────────────────

async function processAsync(userId: string, utterance: string, callbackUrl: string): Promise<void> {
  const result = await processMessage(userId, utterance);
  await sendCallback(callbackUrl, result);
}

// ── 동기 처리 (5초 제한) ─────────────────────────────────────────

async function handleSync(userId: string, utterance: string): Promise<string> {
  // 동기 모드에서는 NemoClaw 호출이 5초 내에 안 끝날 수 있으므로
  // 인증/명령어만 처리하고, 에이전트 호출은 안내 메시지 반환
  if (!isVerified(userId)) {
    return handleUnverified(userId, utterance);
  }

  const cmd = parseCommand(utterance);
  if (cmd) return handleCommand(userId, cmd.command, cmd.args);

  return "콜백 API가 활성화되지 않아 에이전트를 사용할 수 없습니다.\n카카오 i 오픈빌더에서 콜백 기능을 활성화해주세요.";
}

// ── 메시지 처리 ──────────────────────────────────────────────────

async function processMessage(userId: string, utterance: string): Promise<string> {
  // 1. 인증 확인
  if (!isVerified(userId)) {
    return handleUnverified(userId, utterance);
  }

  // 2. 명령어 확인
  const cmd = parseCommand(utterance);
  if (cmd) return handleCommand(userId, cmd.command, cmd.args);

  // 3. 에이전트 호출
  try {
    return await runAgent(utterance, userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[skill] agent error: ${msg}`);
    return "에이전트 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
  }
}

// ── 미인증 유저 처리 ─────────────────────────────────────────────

function handleUnverified(userId: string, utterance: string): string {
  const cmd = parseCommand(utterance);
  if (cmd?.command === "pair") {
    const parts = cmd.args.split(/\s+/);
    const code = parts[0] || "";
    const name = parts.slice(1).join(" ") || undefined;
    const result = verifyPairing(userId, code, name);
    return result.message;
  }

  return "인증이 필요합니다.\n\n/pair [인증코드] [이름(선택)]\n\n예시: /pair mycode 홍길동";
}

// ── 명령어 파싱 ──────────────────────────────────────────────────

function parseCommand(utterance: string): { command: string; args: string } | null {
  if (!utterance.startsWith("/")) return null;
  const spaceIdx = utterance.indexOf(" ");
  if (spaceIdx === -1) {
    return { command: utterance.slice(1).toLowerCase(), args: "" };
  }
  return {
    command: utterance.slice(1, spaceIdx).toLowerCase(),
    args: utterance.slice(spaceIdx + 1).trim(),
  };
}

// ── 명령어 핸들러 ────────────────────────────────────────────────

function handleCommand(userId: string, command: string, _args: string): string {
  switch (command) {
    case "reset":
      resetSession(userId);
      return "세션이 초기화되었습니다.";

    case "help":
      return [
        "사용 가능한 명령어:",
        "",
        "/reset — 세션 초기화",
        "/help — 도움말",
        "",
        "그 외 메시지는 AI 에이전트에게 전달됩니다.",
      ].join("\n");

    default:
      return `알 수 없는 명령어: /${command}\n/help 로 명령어 목록을 확인하세요.`;
  }
}
