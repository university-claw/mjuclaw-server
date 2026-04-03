import dotenv from "dotenv";
import crypto from "crypto";
dotenv.config();

// ENCRYPTION_KEY: 32바이트(hex 64자). 없으면 자동 생성하되 경고 출력.
function resolveEncryptionKey(): Buffer {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) return Buffer.from(envKey, "hex");

  console.warn("[config] ENCRYPTION_KEY 미설정 — 임시 키 생성 (재시작 시 기존 크리덴셜 복호화 불가!)");
  return crypto.randomBytes(32);
}

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  serverUrl: process.env.SERVER_URL || `http://localhost:${process.env.PORT || "3000"}`,
  sandbox: {
    name: process.env.SANDBOX_NAME || "mjuclaw",
    nvidiaApiKey: process.env.NVIDIA_API_KEY || "",
    agentTimeout: 120_000, // 2분
  },
  security: {
    encryptionKey: resolveEncryptionKey(),
    adminKakaoId: process.env.ADMIN_KAKAO_ID || "",
    credentialsPath: process.env.CREDENTIALS_PATH || "./data/credentials.json",
  },
  session: {
    ttlMs: 24 * 60 * 60 * 1000, // 24시간
    cleanupIntervalMs: 60 * 60 * 1000, // 1시간
    maxHistory: 20,
  },
  viewStore: {
    ttlMs: 30 * 60 * 1000,         // 30분
    cleanupIntervalMs: 5 * 60 * 1000, // 5분
  },
};
