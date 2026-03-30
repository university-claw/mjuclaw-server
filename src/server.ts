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

  console.log(`[skill] user=${userId.slice(0, 8)}... msg="${utterance.slice(0, 50)}" callback=${!!callbackUrl}`);
  console.log(`[skill] body: ${JSON.stringify(req.body)}`);

  // 미인증 유저 → 웰컴 카드 (온보딩 버튼)
  if (!isVerified(userId)) {
    const onboardUrl = `${config.serverUrl}/onboard?uid=${encodeURIComponent(userId)}`;

    if (callbackUrl) {
      res.json(createImmediateResponse("잠시만요..."));
      sendCallbackWelcome(callbackUrl, onboardUrl).catch((err) => {
        console.error(`[skill] welcome callback error: ${err.message}`);
      });
    } else {
      const welcomeRes = createWelcomeResponse(onboardUrl);
      console.log(`[skill] response: ${JSON.stringify(welcomeRes).slice(0, 500)}`);
      res.json(welcomeRes);
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
      .then((text) => {
        const resp = createTextResponse(text);
        console.log(`[skill] sync response: ${JSON.stringify(resp).slice(0, 300)}`);
        res.json(resp);
      })
      .catch(() => res.json(createTextResponse("처리 중 오류가 발생했습니다.")));
  }
});

// ── 비동기 처리 (콜백 사용) ──────────────────────────────────────

async function processAsync(userId: string, utterance: string, callbackUrl: string): Promise<void> {
  console.log(`[async] starting agent for user=${userId.slice(0, 8)}...`);
  try {
    const result = await processMessage(userId, utterance);
    console.log(`[async] agent response (${result.length} chars): ${result.slice(0, 100)}`);
    await sendCallback(callbackUrl, result);
    console.log(`[async] callback sent to ${callbackUrl.slice(0, 60)}...`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[async] error: ${msg}`);
    await sendCallback(callbackUrl, "오류가 발생했습니다. 다시 시도해주세요.").catch(() => {});
  }
}

// ── 동기 처리 (5초 제한) ─────────────────────────────────────────

async function handleSync(userId: string, utterance: string): Promise<string> {
  const cmd = parseCommand(utterance);
  if (cmd) return handleCommand(userId, cmd.command, cmd.args);

  // 4.5초 타임아웃으로 에이전트 호출 시도
  try {
    const result = await Promise.race([
      runAgent(utterance, userId),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 4500)
      ),
    ]);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "timeout") {
      return "응답 생성에 시간이 걸리고 있습니다. 잠시 후 다시 시도해주세요.";
    }
    console.error(`[skill] sync agent error: ${msg}`);
    return "처리 중 오류가 발생했습니다.";
  }
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
