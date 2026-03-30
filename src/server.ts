import express from "express";
import path from "path";
import { config } from "./config";
import {
  createImmediateResponse,
  createTextResponse,
  createWelcomeResponse,
  sendCallback,
  sendCallbackWelcome,
} from "./kakao";
import { runAgent } from "./nemoclaw";
import { isVerified, onboardUser, resetSession, getStats } from "./session";
import type { KakaoSkillRequest } from "./types";

export const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// ── GET /onboard — 학교 인증 웹페이지 ────────────────────────────

app.get("/onboard", (req, res) => {
  const uid = req.query.uid as string;
  if (!uid) {
    res.status(400).send("잘못된 접근입니다.");
    return;
  }
  res.sendFile(path.join(__dirname, "..", "public", "onboard.html"));
});

// ── POST /onboard/submit — 크리덴셜 등록 ─────────────────────────

app.post("/onboard/submit", (req, res) => {
  const { uid, studentId, password } = req.body;

  if (!uid || !studentId || !password) {
    res.status(400).json({ success: false, message: "모든 필드를 입력해주세요." });
    return;
  }

  const result = onboardUser(uid, studentId, password);
  console.log(`[onboard] user=${String(uid).slice(0, 8)}... studentId=${studentId} → ${result.success}`);
  res.json(result);
});

// ── POST /skill — 카카오 스킬 웹훅 ──────────────────────────────

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

  // 미인증 유저 → 웰컴 카드 (온보딩 버튼)
  if (!isVerified(userId)) {
    const onboardUrl = `${config.serverUrl}/onboard?uid=${encodeURIComponent(userId)}`;

    if (callbackUrl) {
      res.json(createImmediateResponse("잠시만요..."));
      sendCallbackWelcome(callbackUrl, onboardUrl).catch((err) => {
        console.error(`[skill] welcome callback error: ${err.message}`);
      });
    } else {
      res.json(createWelcomeResponse(onboardUrl));
    }
    return;
  }

  if (callbackUrl) {
    res.json(createImmediateResponse("생각 중..."));
    processAsync(userId, utterance, callbackUrl).catch((err) => {
      console.error(`[skill] async error: ${err.message}`);
    });
  } else {
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
  const cmd = parseCommand(utterance);
  if (cmd) return handleCommand(userId, cmd.command, cmd.args);

  return "콜백 API가 활성화되지 않아 에이전트를 사용할 수 없습니다.\n카카오 i 오픈빌더에서 콜백 기능을 활성화해주세요.";
}

// ── 메시지 처리 ──────────────────────────────────────────────────

async function processMessage(userId: string, utterance: string): Promise<string> {
  const cmd = parseCommand(utterance);
  if (cmd) return handleCommand(userId, cmd.command, cmd.args);

  try {
    return await runAgent(utterance, userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[skill] agent error: ${msg}`);
    return "에이전트 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
  }
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
