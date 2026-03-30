import crypto from "crypto";
import fs from "fs";
import path from "path";
import { config } from "./config";
import type { UserSession, StoredCredential } from "./types";

const sessions = new Map<string, UserSession>();

// ── 크리덴셜 암호화/복호화 (AES-256-GCM) ────────────────────────

function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", config.security.encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // iv:authTag:ciphertext 를 하나의 base64 문자열로 결합
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

function decrypt(encoded: string): string {
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", config.security.encryptionKey, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final("utf-8");
}

// ── 크리덴셜 영속화 ─────────────────────────────────────────────

function loadCredentials(): StoredCredential[] {
  try {
    const raw = fs.readFileSync(config.security.credentialsPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveCredentials(creds: StoredCredential[]): void {
  const dir = path.dirname(config.security.credentialsPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(config.security.credentialsPath, JSON.stringify(creds, null, 2));
}

function findCredential(kakaoId: string): StoredCredential | undefined {
  return loadCredentials().find((c) => c.kakaoId === kakaoId);
}

// ── 온보딩 (학번/비밀번호 등록) ──────────────────────────────────

export interface OnboardResult {
  success: boolean;
  message: string;
}

export function onboardUser(kakaoId: string, studentId: string, password: string): OnboardResult {
  if (findCredential(kakaoId)) {
    // 이미 등록됨 — 덮어쓰기
    const creds = loadCredentials().filter((c) => c.kakaoId !== kakaoId);
    creds.push({
      kakaoId,
      studentId,
      encryptedPassword: encrypt(password),
      createdAt: new Date().toISOString(),
    });
    saveCredentials(creds);

    const session = getSession(kakaoId);
    session.isVerified = true;
    session.name = studentId;
    return { success: true, message: "학교 인증이 갱신되었습니다." };
  }

  const creds = loadCredentials();
  creds.push({
    kakaoId,
    studentId,
    encryptedPassword: encrypt(password),
    createdAt: new Date().toISOString(),
  });
  saveCredentials(creds);

  const session = getSession(kakaoId);
  session.isVerified = true;
  session.name = studentId;
  return { success: true, message: "학교 인증이 완료되었습니다!" };
}

/** 저장된 크리덴셜의 비밀번호 복호화 */
export function getDecryptedPassword(kakaoId: string): string | null {
  const cred = findCredential(kakaoId);
  if (!cred) return null;
  return decrypt(cred.encryptedPassword);
}

// ── 세션 관리 ────────────────────────────────────────────────────

export function getSession(kakaoId: string): UserSession {
  let session = sessions.get(kakaoId);
  if (!session) {
    const hasCredential =
      kakaoId === config.security.adminKakaoId || !!findCredential(kakaoId);

    session = {
      kakaoId,
      isVerified: hasCredential,
      name: findCredential(kakaoId)?.studentId || "",
      lastActive: Date.now(),
    };
    sessions.set(kakaoId, session);
  }
  session.lastActive = Date.now();
  return session;
}

export function isVerified(kakaoId: string): boolean {
  return getSession(kakaoId).isVerified;
}

// ── 세션 리셋 ────────────────────────────────────────────────────

export function resetSession(kakaoId: string): void {
  const session = sessions.get(kakaoId);
  if (session) {
    session.lastActive = Date.now();
  }
}

// ── 만료 세션 정리 (1시간마다) ────────────────────────────────────

export function startCleanup(): void {
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastActive > config.session.ttlMs) {
        sessions.delete(id);
      }
    }
  }, config.session.cleanupIntervalMs);
}

// ── 통계 ─────────────────────────────────────────────────────────

export function getStats(): { total: number; verified: number; activeLastHour: number } {
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  let verified = 0;
  let activeLastHour = 0;

  for (const session of sessions.values()) {
    if (session.isVerified) verified++;
    if (session.lastActive > hourAgo) activeLastHour++;
  }

  return { total: sessions.size, verified, activeLastHour };
}
