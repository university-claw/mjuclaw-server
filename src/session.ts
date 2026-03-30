import fs from "fs";
import path from "path";
import { config } from "./config";
import type { UserSession, AllowedUser } from "./types";

const sessions = new Map<string, UserSession>();

// ── 허용 유저 목록 영속화 ────────────────────────────────────────

function loadAllowedUsers(): AllowedUser[] {
  try {
    const raw = fs.readFileSync(config.security.allowedUsersPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveAllowedUsers(users: AllowedUser[]): void {
  const dir = path.dirname(config.security.allowedUsersPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(config.security.allowedUsersPath, JSON.stringify(users, null, 2));
}

function isInAllowedList(kakaoId: string): boolean {
  return loadAllowedUsers().some((u) => u.kakaoId === kakaoId);
}

// ── 세션 관리 ────────────────────────────────────────────────────

export function getSession(kakaoId: string): UserSession {
  let session = sessions.get(kakaoId);
  if (!session) {
    const autoVerify =
      kakaoId === config.security.adminKakaoId || isInAllowedList(kakaoId);

    session = {
      kakaoId,
      isVerified: autoVerify,
      name: "",
      pairingAttempts: 0,
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

// ── 페어링 ───────────────────────────────────────────────────────

export interface PairingResult {
  success: boolean;
  message: string;
}

export function verifyPairing(kakaoId: string, code: string, name?: string): PairingResult {
  const session = getSession(kakaoId);

  if (session.isVerified) {
    return { success: true, message: "이미 인증되었습니다." };
  }

  if (session.pairingAttempts >= config.security.maxPairingAttempts) {
    return { success: false, message: "인증 시도 횟수를 초과했습니다. 나중에 다시 시도해주세요." };
  }

  session.pairingAttempts++;

  if (code !== config.security.pairingCode) {
    const remaining = config.security.maxPairingAttempts - session.pairingAttempts;
    return { success: false, message: `인증 코드가 틀렸습니다. (${remaining}회 남음)` };
  }

  // 인증 성공
  session.isVerified = true;
  session.name = name || `User_${kakaoId.slice(0, 6)}`;

  // 영속 목록에 추가
  const users = loadAllowedUsers();
  if (!users.some((u) => u.kakaoId === kakaoId)) {
    users.push({
      kakaoId,
      name: session.name,
      addedAt: new Date().toISOString(),
    });
    saveAllowedUsers(users);
  }

  return { success: true, message: `인증 완료! 안녕하세요, ${session.name}님.` };
}

// ── 세션 리셋 ────────────────────────────────────────────────────

export function resetSession(kakaoId: string): void {
  const session = sessions.get(kakaoId);
  if (session) {
    // 인증 상태는 유지, 대화 맥락만 리셋
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
