import express from "express";
import path from "path";
import { config } from "./config";
import {
  createImmediateResponse,
  createResultResponse,
  createTextResponse,
  createWelcomeResponse,
  sendCallback,
  sendCallbackResult,
  sendCallbackWelcome,
} from "./kakao";
import { fetchMjuData, mjuLogin } from "./mju-tools";
import { runAgent } from "./nemoclaw";
import { isVerified, onboardUser, resetSession, getStats } from "./session";
import { storeView, getView } from "./view-store";
import { renderViewHtml, renderExpiredHtml } from "./view-renderer";
import type { KakaoSkillRequest, ProcessResult } from "./types";

export const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "..", "public")));

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

// ── GET /view/:id — 학사 데이터 웹 뷰 ───────────────────────────

app.get("/view/:id", (req, res) => {
  const id = req.params.id;
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    res.status(400).send("잘못된 접근입니다.");
    return;
  }
  const entry = getView(id);
  if (!entry) {
    res.status(404).send(renderExpiredHtml());
    return;
  }
  res.send(renderViewHtml(entry));
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

app.post("/onboard/submit", async (req, res) => {
  const { uid, studentId, password } = req.body;

  if (!uid || !studentId || !password) {
    res.status(400).json({ success: false, message: "모든 필드를 입력해주세요." });
    return;
  }

  console.log(`[onboard] user=${String(uid).slice(0, 8)}... studentId=${studentId} — CLI 로그인 시도`);
  const loginResult = await mjuLogin(uid, studentId, password);
  if (!loginResult.success) {
    console.log(`[onboard] CLI 로그인 실패: ${loginResult.message}`);
    res.json(loginResult);
    return;
  }

  const result = onboardUser(uid, studentId, password);
  console.log(`[onboard] user=${String(uid).slice(0, 8)}... → ${result.success}`);
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
    processSync(userId, utterance)
      .then((result) => res.json(createResultResponse(result)))
      .catch(() => res.json(createTextResponse("처리 중 오류가 발생했습니다.")));
  }
});

// ── 비동기 처리 (콜백 사용) ──────────────────────────────────────

async function processAsync(userId: string, utterance: string, callbackUrl: string): Promise<void> {
  try {
    const result = await processMessage(userId, utterance);
    console.log(`[async] result type=${result.type}, title=${result.title || "-"}`);
    await sendCallbackResult(callbackUrl, result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[async] error: ${msg}`);
    await sendCallback(callbackUrl, "오류가 발생했습니다. 다시 시도해주세요.").catch(() => {});
  }
}

// ── 동기 처리 (5초 제한) ─────────────────────────────────────────

async function processSync(userId: string, utterance: string): Promise<ProcessResult> {
  const cmd = parseCommand(utterance);
  if (cmd) return { type: "text", text: handleCommand(userId, cmd.command, cmd.args) };

  try {
    const result = await Promise.race([
      processMessage(userId, utterance),
      new Promise<ProcessResult>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 4500)
      ),
    ]);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "timeout") {
      return { type: "text", text: "응답 생성에 시간이 걸리고 있습니다. 잠시 후 다시 시도해주세요." };
    }
    return { type: "text", text: "처리 중 오류가 발생했습니다." };
  }
}

// ── 메시지 처리 ──────────────────────────────────────────────────

async function processMessage(userId: string, utterance: string): Promise<ProcessResult> {
  const cmd = parseCommand(utterance);
  if (cmd) return { type: "text", text: handleCommand(userId, cmd.command, cmd.args) };

  // 1) 키워드 매칭 → mju-cli로 학사 데이터 조회
  let mjuResult: Awaited<ReturnType<typeof fetchMjuData>> = null;
  try {
    mjuResult = await fetchMjuData(userId, utterance);
    if (mjuResult && !mjuResult.data) {
      return { type: "text", text: mjuResult.fallbackText };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[mju] error: ${msg}`);
  }

  // 2) NemoClaw에 질문 + 학사 데이터 전달
  let aiResponse = "";
  try {
    let agentMessage = utterance;
    if (mjuResult?.data) {
      const dataStr = typeof mjuResult.data === "string"
        ? mjuResult.data
        : JSON.stringify(mjuResult.data, null, 2);
      agentMessage = `${utterance}\n\n[학사 데이터: ${mjuResult.description}]\n${dataStr}`;
    }
    aiResponse = await runAgent(agentMessage, userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[skill] agent error: ${msg}`);
    // NemoClaw 실패 시 폴백
    if (mjuResult?.fallbackText) {
      aiResponse = mjuResult.fallbackText;
    } else {
      return { type: "text", text: "에이전트 처리 중 오류가 발생했습니다." };
    }
  }

  // 3) 학사 데이터가 있으면 → 카드 응답 (웹 뷰 링크)
  if (mjuResult?.data) {
    const viewId = storeView({
      dataType: mjuResult.dataType,
      title: `${mjuResult.description}`,
      summary: aiResponse.split("\n")[0].slice(0, 80),
      rawData: mjuResult.data,
      aiResponse,
    });
    return {
      type: "card",
      viewId,
      title: mjuResult.description,
      summary: aiResponse.split("\n")[0].slice(0, 80),
    };
  }

  // 4) 일반 대화 → 텍스트 응답
  return { type: "text", text: aiResponse };
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
