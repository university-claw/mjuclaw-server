import https from "https";
import http from "http";
import type { KakaoSkillResponse, KakaoSimpleText, KakaoOutput } from "./types";

const MAX_BUBBLE_CHARS = 900;
const MAX_BUBBLES = 3;

// ── 즉시 응답 (useCallback: true) ────────────────────────────────

export function createImmediateResponse(text: string): KakaoSkillResponse {
  return {
    version: "2.0",
    useCallback: true,
    data: { text },
  };
}

// ── 동기 텍스트 응답 (callbackUrl 없을 때) ──────────────────────

export function createTextResponse(text: string): KakaoSkillResponse {
  const chunks = splitText(text);
  const outputs: KakaoSimpleText[] = chunks.map((chunk) => ({
    simpleText: { text: chunk },
  }));

  return {
    version: "2.0",
    template: { outputs },
  };
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
          {
            action: "webLink",
            label: "학교 인증하기",
            webLinkUrl: onboardUrl,
          },
        ],
      },
    },
  ];

  return {
    version: "2.0",
    template: { outputs },
  };
}

// ── 콜백 전송 ────────────────────────────────────────────────────

export async function sendCallback(callbackUrl: string, text: string): Promise<void> {
  const chunks = splitText(text);
  const outputs: KakaoSimpleText[] = chunks.map((chunk) => ({
    simpleText: { text: chunk },
  }));

  const body: KakaoSkillResponse = {
    version: "2.0",
    template: { outputs },
  };

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

// ── 콜백으로 웰컴 카드 전송 ──────────────────────────────────────

export async function sendCallbackWelcome(callbackUrl: string, onboardUrl: string): Promise<void> {
  const body = createWelcomeResponse(onboardUrl);

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
            console.error(`[kakao] callback welcome failed (${res.statusCode}): ${buf.slice(0, 200)}`);
          }
          resolve();
        });
      }
    );

    req.on("error", (err) => {
      console.error(`[kakao] callback welcome error: ${err.message}`);
      reject(err);
    });

    req.write(data);
    req.end();
  });
}

// ── 텍스트 분할 (900자 단위, 최대 3버블) ─────────────────────────

function splitText(text: string): string[] {
  if (text.length <= MAX_BUBBLE_CHARS) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0 && chunks.length < MAX_BUBBLES) {
    if (chunks.length === MAX_BUBBLES - 1 && remaining.length > MAX_BUBBLE_CHARS) {
      chunks.push(remaining.slice(0, MAX_BUBBLE_CHARS - 20) + "\n\n...내용이 생략되었습니다.");
      break;
    }
    chunks.push(remaining.slice(0, MAX_BUBBLE_CHARS));
    remaining = remaining.slice(MAX_BUBBLE_CHARS);
  }

  return chunks;
}
