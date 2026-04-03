// ── 카카오 스킬 API 타입 ─────────────────────────────────────────

export interface KakaoSkillRequest {
  intent: { id: string; name: string };
  userRequest: {
    timezone: string;
    params: { ignoreMe?: string; surface?: string };
    block: { id: string; name: string };
    utterance: string;
    lang: string | null;
    user: {
      id: string;
      type: string;
      properties: Record<string, string>;
    };
    callbackUrl?: string;
  };
  bot: { id: string; name: string };
  action: {
    name: string;
    clientExtra: Record<string, unknown> | null;
    params: Record<string, string>;
    id: string;
    detailParams: Record<string, unknown>;
  };
}

export interface KakaoSimpleText {
  simpleText: { text: string };
}

export interface KakaoBasicCard {
  basicCard: {
    title: string;
    description: string;
    thumbnail?: { imageUrl: string };
    buttons: Array<{
      action: "webLink" | "message" | "block";
      label: string;
      webLinkUrl?: string;
      messageText?: string;
    }>;
  };
}

// ── 처리 결과 (카드 or 텍스트) ──────────────────────────────────

export interface ProcessResult {
  type: "card" | "text";
  text?: string;         // simpleText 응답
  viewId?: string;       // view-store ID (카드일 때)
  title?: string;        // basicCard 제목
  summary?: string;      // basicCard description
}

// ── 웹 뷰 저장소 ────────────────────────────────────────────────

export interface ViewEntry {
  id: string;
  dataType: string;
  title: string;
  summary: string;       // AI 생성 요약 (짧은 버전)
  rawData: unknown;       // mju-cli JSON 원본
  aiResponse: string;     // NemoClaw 전체 응답
  createdAt: number;
  expiresAt: number;
}

export type KakaoOutput = KakaoSimpleText | KakaoBasicCard;

export interface KakaoSkillResponse {
  version: "2.0";
  useCallback?: boolean;
  data?: { text: string };
  template?: {
    outputs: KakaoOutput[];
    quickReplies?: Array<{
      messageText: string;
      action: "message" | "block";
      label: string;
    }>;
  };
}

// ── 내부 타입 ────────────────────────────────────────────────────

export interface UserSession {
  kakaoId: string;
  isVerified: boolean;
  name: string;
  lastActive: number;
}

export interface StoredCredential {
  kakaoId: string;
  studentId: string;
  // AES-256-GCM 암호화된 비밀번호
  encryptedPassword: string; // base64(iv:authTag:ciphertext)
  createdAt: string;
}
