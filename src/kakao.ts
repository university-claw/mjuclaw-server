import https from "https";
import http from "http";
import { config } from "./config";
import type { KakaoSkillResponse, KakaoOutput, ProcessResult } from "./types";

const MAX_CHARS = 900;
const MAX_DESC = 200; // basicCard description 제한

// ── 즉시 응답 (useCallback: true) ────────────────────────────────

export function createImmediateResponse(text: string): KakaoSkillResponse {
  return {
    version: "2.0",
    useCallback: true,
    data: { text },
  };
}

// ── 동기 텍스트 응답 ────────────────────────────────────────────

export function createTextResponse(text: string): KakaoSkillResponse {
  return {
    version: "2.0",
    template: {
      outputs: [{ simpleText: { text: truncate(text) } }],
    },
  };
}

// ── 카드 응답 (썸네일 + 요약 + 자세히 보기 버튼) ────────────────

export function createCardResponse(title: string, description: string, viewUrl: string): KakaoSkillResponse {
  const outputs: KakaoOutput[] = [
    {
      basicCard: {
        title,
        description: truncateDesc(description),
        thumbnail: { imageUrl: `${config.serverUrl}/myongmyong.png` },
        buttons: [
          { action: "webLink", label: "자세히 보기", webLinkUrl: viewUrl },
        ],
      },
    },
  ];
  return { version: "2.0", template: { outputs } };
}

// ── ProcessResult → 적절한 응답 빌드 ────────────────────────────

export function createResultResponse(result: ProcessResult): KakaoSkillResponse {
  if (result.type === "card" && result.viewId) {
    const viewUrl = `${config.serverUrl}/view/${result.viewId}`;
    return createCardResponse(result.title || "조회 결과", result.summary || "", viewUrl);
  }
  return createTextResponse(result.text || "");
}

// ── 웰컴 카드 (온보딩 버튼 포함) ─────────────────────────────────

export function createWelcomeResponse(onboardUrl: string): KakaoSkillResponse {
  const outputs: KakaoOutput[] = [
    {
      basicCard: {
        title: "환영합니다! 👋",
        description:
          "AI 에이전트를 사용하려면 학교 인증이 필요합니다.\n아래 버튼을 눌러 학번과 비밀번호를 등록해주세요.",
        buttons: [
          { action: "webLink", label: "학교 인증하기", webLinkUrl: onboardUrl },
        ],
      },
    },
  ];
  return { version: "2.0", template: { outputs } };
}

// ── 콜백 전송 (공통) ────────────────────────────────────────────

function postCallback(callbackUrl: string, body: KakaoSkillResponse): Promise<void> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(callbackUrl);
    const transport = url.protocol === "https:" ? https : http;

    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            console.error(`[kakao] callback failed (${res.statusCode}): ${buf.slice(0, 200)}`);
          }
          resolve();
        });
      }
    );
    req.on("error", (err) => {
      console.error(`[kakao] callback error: ${err.message}`);
      reject(err);
    });
    req.write(data);
    req.end();
  });
}

export function sendCallback(callbackUrl: string, text: string): Promise<void> {
  return postCallback(callbackUrl, createTextResponse(text));
}

export function sendCallbackResult(callbackUrl: string, result: ProcessResult): Promise<void> {
  return postCallback(callbackUrl, createResultResponse(result));
}

export function sendCallbackWelcome(callbackUrl: string, onboardUrl: string): Promise<void> {
  return postCallback(callbackUrl, createWelcomeResponse(onboardUrl));
}

// ── 유틸 ────────────────────────────────────────────────────────

function truncate(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  return text.slice(0, MAX_CHARS - 15) + "\n\n...(생략됨)";
}

function truncateDesc(text: string): string {
  if (text.length <= MAX_DESC) return text;
  return text.slice(0, MAX_DESC - 3) + "...";
}
