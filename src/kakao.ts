import https from "https";
import http from "http";
import type { KakaoSkillResponse, KakaoSimpleText, KakaoOutput } from "./types";

const MAX_CHARS = 900;

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
  return {
    version: "2.0",
    template: {
      outputs: [{ simpleText: { text: truncate(text) } }],
    },
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
  const body: KakaoSkillResponse = {
    version: "2.0",
    template: {
      outputs: [{ simpleText: { text: truncate(text) } }],
    },
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

// ── 텍스트 자르기 (단일 버블, 900자 하드 리밋) ──────────────────

function truncate(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  return text.slice(0, MAX_CHARS - 15) + "\n\n...(생략됨)";
}
