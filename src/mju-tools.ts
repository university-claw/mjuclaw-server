import { execFile } from "child_process";
import path from "path";
import { getDecryptedCredentials } from "./session";

const MJU_CLI = path.join(__dirname, "..", "mju-cli", "dist", "main.js");
const SOFT_LIMIT = 500; // 카카오 말풍선 소프트 리밋
const USER_DATA_DIR = path.join(__dirname, "..", "data", "users");

// ── CLI 실행 ────────────────────────────────────────────────────────

function runMju(args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("node", [MJU_CLI, ...args], { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        // CLI가 에러를 JSON으로 출력할 수 있으므로 stdout 우선 확인
        if (stdout.trim()) {
          resolve(stdout.trim());
          return;
        }
        reject(new Error(stderr.trim() || err.message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function userAppDir(kakaoId: string): string {
  // 유저별 격리된 데이터 디렉토리
  const safeId = kakaoId.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(USER_DATA_DIR, safeId);
}

/** mju CLI를 JSON 모드로 실행하고 파싱된 결과 반환 */
async function mjuJson<T = unknown>(kakaoId: string, args: string[]): Promise<T> {
  const appDir = userAppDir(kakaoId);
  const stdout = await runMju(["--app-dir", appDir, "--format", "json", ...args]);
  return JSON.parse(stdout) as T;
}

// ── 인증 (온보딩 시 호출) ───────────────────────────────────────────

export async function mjuLogin(kakaoId: string, studentId: string, password: string): Promise<{ success: boolean; message: string }> {
  try {
    await mjuJson(kakaoId, ["auth", "login", "--id", studentId, "--password", password]);
    return { success: true, message: "학교 인증이 완료되었습니다!" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // CLI가 JSON 에러를 반환한 경우 파싱 시도
    try {
      const parsed = JSON.parse(msg);
      return { success: false, message: parsed.error?.message || msg };
    } catch {
      return { success: false, message: `인증 실패: ${msg}` };
    }
  }
}

// ── 키워드 → CLI 커맨드 매핑 ────────────────────────────────────────

interface IntentEntry {
  keywords: string[];
  command: string[];        // mju CLI 서브커맨드 + 옵션
  description: string;
  emoji: string;
  formatter: (data: unknown) => string;
}

// 구체적 키워드가 앞에 와야 함 (예: "졸업학점" > "학점", "미제출" > "과제")
const KEYWORD_MAP: IntentEntry[] = [
  // 출석
  { keywords: ["출석", "출결", "결석", "지각"], command: [], description: "출석 현황", emoji: "📋", formatter: () => "" },
  // 복합 키워드 (구체적인 것 먼저)
  { keywords: ["안읽은 공지", "새 공지"], command: ["lms", "+unread-notices", "--all-courses"], description: "안읽은 공지", emoji: "🔔", formatter: formatUnreadNotices },
  { keywords: ["미제출"], command: ["lms", "+unsubmitted", "--all-courses"], description: "미제출 과제", emoji: "⚠️", formatter: formatUnsubmitted },
  { keywords: ["마감", "데드라인", "임박", "언제까지"], command: ["lms", "+due-assignments", "--all-courses"], description: "마감 임박 과제", emoji: "⏰", formatter: formatDueAssignments },
  { keywords: ["미수강", "온라인 강의", "온라인강의"], command: ["lms", "+incomplete-online", "--all-courses"], description: "미수강 온라인 학습", emoji: "🎬", formatter: formatGeneric },
  // MSI — 졸업이 성적/학점보다 먼저 (졸업학점 → 졸업, not 학점)
  { keywords: ["졸업", "졸업요건", "졸업학점"], command: ["msi", "graduation"], description: "졸업 요건", emoji: "🎓", formatter: formatGraduation },
  { keywords: ["성적이력", "전체성적", "전체 성적"], command: ["msi", "grade-history"], description: "성적 이력", emoji: "📈", formatter: formatGeneric },
  { keywords: ["성적", "학점", "점수"], command: ["msi", "current-grades"], description: "이번 학기 성적", emoji: "📊", formatter: formatGrades },
  { keywords: ["시간표", "수업시간", "강의시간"], command: ["msi", "timetable"], description: "시간표", emoji: "🕐", formatter: formatTimetable },
  // LMS 기본 — "과제"는 구체적 키워드 뒤에
  { keywords: ["과제", "숙제", "레포트", "할 일", "할일", "투두"], command: ["lms", "+action-items", "--all-courses"], description: "할 일 목록", emoji: "📝", formatter: formatActionItems },
  { keywords: ["과목", "수강", "강의목록"], command: ["lms", "courses", "list"], description: "수강 과목", emoji: "📚", formatter: formatCourses },
  { keywords: ["공지", "알림"], command: ["lms", "+unread-notices", "--all-courses"], description: "공지사항", emoji: "📢", formatter: formatUnreadNotices },
  // 도서관
  { keywords: ["스터디룸", "스터디 룸"], command: ["library", "study-rooms", "list"], description: "스터디룸 현황", emoji: "🏫", formatter: formatGeneric },
  { keywords: ["열람실", "좌석"], command: ["library", "reading-rooms", "list"], description: "열람실 현황", emoji: "📖", formatter: formatGeneric },
];

export function detectMjuIntent(utterance: string): IntentEntry | null {
  const lower = utterance.toLowerCase();
  for (const entry of KEYWORD_MAP) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry;
    }
  }
  return null;
}

// ── 스마트 핸들러 ────────────────────────────────────────────────────

/** 학사 데이터 조회 결과. data가 있으면 NemoClaw에 컨텍스트로 전달할 수 있다. */
export interface MjuDataResult {
  description: string;
  data: unknown;
  /** 포맷터로 만든 폴백 텍스트 (NemoClaw 실패 시 사용) */
  fallbackText: string;
}

/** 키워드 매칭 → mju-cli 데이터 조회. 매칭 안 되면 null. */
export async function fetchMjuData(kakaoId: string, utterance: string): Promise<MjuDataResult | null> {
  const intent = detectMjuIntent(utterance);
  if (!intent) return null;

  console.log(`[mju] detected: ${intent.description}`);

  // 출석 — 특수 체이닝
  if (intent.keywords[0] === "출석") {
    const text = await handleAttendance(kakaoId);
    return { description: intent.description, data: text, fallbackText: text };
  }

  try {
    const data = await mjuJson(kakaoId, intent.command);

    // CLI가 에러 JSON을 반환한 경우
    if (data && typeof data === "object" && "error" in (data as Record<string, unknown>)) {
      const errObj = (data as { error: { message?: string } }).error;
      const errText = `${intent.emoji} ${intent.description}\n\n오류: ${errObj.message || "알 수 없는 오류"}`;
      return { description: intent.description, data: null, fallbackText: errText };
    }

    return {
      description: intent.description,
      data,
      fallbackText: intent.formatter(data),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errText = `${intent.emoji} ${intent.description}\n\n조회 실패: ${msg}`;
    return { description: intent.description, data: null, fallbackText: errText };
  }
}

// ── 출석 핸들러 (과목 목록 → 각 과목 출석 조회) ─────────────────────

async function handleAttendance(kakaoId: string): Promise<string> {
  try {
    // 1) UCheck 과목 목록
    const lectures = await mjuJson<{ lectures: UcheckLecture[] }>(kakaoId, ["ucheck", "lectures", "list"]);

    if (!lectures.lectures || lectures.lectures.length === 0) {
      return "📋 출석 현황\n\n등록된 과목이 없습니다.";
    }

    // 2) 각 과목 출석 조회
    const results: string[] = [];
    for (const lec of lectures.lectures) {
      try {
        const att = await mjuJson<UcheckAttendance>(kakaoId, [
          "ucheck", "attendance", "--lecture-no", String(lec.lectureNo),
        ]);
        results.push(formatAttendanceSummary(lec.courseTitle, att));
      } catch {
        results.push(`📚 ${lec.courseTitle} — 조회 실패`);
      }
    }

    return `📋 출석 현황\n\n${results.join("\n\n")}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `📋 출석 현황\n\n조회 실패: ${msg}`;
  }
}

// ── 타입 (mju-cli JSON 출력 구조) ───────────────────────────────────

interface UcheckLecture {
  lectureNo: number;
  courseTitle: string;
  courseCode: string;
  professor?: string;
}

interface UcheckAttendance {
  studentName: string;
  course: { courseTitle: string };
  summary: {
    attendedCount: number;
    tardyCount: number;
    earlyLeaveCount: number;
    absentCount: number;
  };
  totalSessions: number;
  completedSessions: number;
  sessions: Array<{
    week: number;
    date?: string;
    statusLabel?: string;
    isPast: boolean;
  }>;
}

interface TimetableEntry {
  dayOfWeek: number;
  dayLabel: string;
  courseTitle: string;
  location?: string;
  professor?: string;
  timeRange?: string;
}

interface GradeItem {
  courseTitle: string;
  credits?: number;
  grade?: string;
  statusMessage?: string;
}

interface GraduationGap {
  label: string;
  earned?: number;
  required?: number;
  gap?: number;
}

interface CourseSummary {
  title: string;
  code?: string;
  professor?: string;
}

// ── 포맷터 유틸 ─────────────────────────────────────────────────────

/** 헤더 + 항목 리스트를 SOFT_LIMIT 이내로 조립. 넘치면 항목을 자른다. */
function buildList(header: string, lines: string[], sep = "\n"): string {
  let result = header;
  for (let i = 0; i < lines.length; i++) {
    const next = result + sep + lines[i];
    if (next.length > SOFT_LIMIT) {
      const remaining = lines.length - i;
      result += `${sep}  ...외 ${remaining}건`;
      break;
    }
    result = next;
  }
  return result;
}

// ── 포맷터 ──────────────────────────────────────────────────────────

function formatAttendanceSummary(courseName: string, att: UcheckAttendance): string {
  const s = att.summary;
  let summary = `출석${s.attendedCount} 지각${s.tardyCount} 결석${s.absentCount}`;
  if (s.earlyLeaveCount > 0) summary += ` 조퇴${s.earlyLeaveCount}`;
  summary += ` (${att.completedSessions}/${att.totalSessions}회)`;

  // 문제 있는 세션만 표시
  const problems = att.sessions.filter(
    (s) => s.isPast && s.statusLabel && !["출석", "정상"].includes(s.statusLabel)
  );
  let result = `📚 ${courseName} — ${summary}`;
  if (problems.length > 0) {
    const lines = problems.map((p) => `  ${p.date || `${p.week}주차`} → ${p.statusLabel}`);
    result += `\n⚠️ 주의:\n${lines.join("\n")}`;
  }
  return result;
}

function formatTimetable(data: unknown): string {
  const d = data as { entries: TimetableEntry[] };
  if (!d.entries || d.entries.length === 0) return "🕐 시간표\n\n등록된 시간표가 없습니다.";

  const dayOrder = ["월", "화", "수", "목", "금"];
  const byDay = new Map<string, string[]>();

  for (const e of d.entries) {
    const day = e.dayLabel || dayOrder[e.dayOfWeek - 1] || "?";
    const line = `  ${e.timeRange || ""} ${e.courseTitle}${e.location ? ` (${e.location})` : ""}`;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(line);
  }

  const lines: string[] = [];
  for (const day of dayOrder) {
    const entries = byDay.get(day);
    if (entries) {
      lines.push(`${day}요일`);
      entries.sort();
      lines.push(...entries);
    }
  }

  return buildList("🕐 시간표\n", lines);
}

function formatGrades(data: unknown): string {
  const d = data as { items: GradeItem[]; year?: number; termLabel?: string };
  if (!d.items || d.items.length === 0) return "📊 이번 학기 성적\n\n성적 정보가 없습니다.";

  const lines = d.items.map((item) => {
    const credits = item.credits ? `${item.credits}학점` : "";
    const grade = item.grade || item.statusMessage || "미공개";
    return `  ${item.courseTitle} (${credits}) — ${grade}`;
  });

  const header = d.termLabel ? `${d.year}년 ${d.termLabel}` : "";
  return buildList(`📊 이번 학기 성적 ${header} (${d.items.length}과목)\n`, lines);
}

function formatGraduation(data: unknown): string {
  const d = data as { creditGaps: GraduationGap[]; notes?: string[] };
  if (!d.creditGaps || d.creditGaps.length === 0) return "🎓 졸업요건\n\n정보를 찾을 수 없습니다.";

  const shortCount = d.creditGaps.filter((g) => (g.gap || 0) > 0).length;
  const status = shortCount > 0 ? `부족 ${shortCount}건` : "충족";

  const lines = d.creditGaps.map((g) => {
    const bar = (g.gap || 0) > 0 ? "🔴" : "✅";
    return `  ${bar} ${g.label}: ${g.earned ?? "?"}/${g.required ?? "?"} (부족 ${g.gap ?? 0})`;
  });

  return buildList(`🎓 졸업요건 — ${status}\n`, lines);
}

function formatCourses(data: unknown): string {
  const d = data as { courses: CourseSummary[] };
  if (!d.courses || d.courses.length === 0) return "📚 수강과목\n\n등록된 과목이 없습니다.";

  const lines = d.courses.map((c) => `  📚 ${c.title}${c.professor ? ` (${c.professor})` : ""}`);
  return buildList(`📚 수강과목 ${d.courses.length}개\n`, lines);
}

function formatActionItems(data: unknown): string {
  const d = data as Record<string, unknown>;
  const sections: string[] = [];

  // 미제출 과제
  const unsub = d.unsubmittedAssignments as Array<{ title: string; courseTitle: string; dueLabel?: string; isExpired?: boolean }> | undefined;
  if (unsub && unsub.length > 0) {
    const lines = unsub.map((a) => `  ${a.isExpired ? "🔴" : "🟡"} ${a.title} (${a.courseTitle})${a.dueLabel ? ` — ${a.dueLabel}` : ""}`);
    sections.push(`📌 미제출 과제 ${unsub.length}건\n${lines.join("\n")}`);
  }

  // 마감 임박
  const due = d.dueAssignments as Array<{ title: string; courseTitle: string; dueLabel?: string }> | undefined;
  if (due && due.length > 0) {
    const lines = due.map((a) => `  ⏰ ${a.title} (${a.courseTitle})${a.dueLabel ? ` — ${a.dueLabel}` : ""}`);
    sections.push(`⏰ 마감 임박 ${due.length}건\n${lines.join("\n")}`);
  }

  // 안읽은 공지
  const notices = d.unreadNotices as Array<{ title: string; courseTitle: string }> | undefined;
  if (notices && notices.length > 0) {
    const lines = notices.map((n) => `  🔔 ${n.title} (${n.courseTitle})`);
    sections.push(`🔔 안읽은 공지 ${notices.length}건\n${lines.join("\n")}`);
  }

  // 미수강 온라인
  const online = d.incompleteOnline as Array<unknown> | undefined;
  if (online && online.length > 0) {
    sections.push(`🎬 미수강 온라인 학습 ${online.length}건`);
  }

  if (sections.length === 0) return "✅ 할 일 없음\n\n모든 과제와 학습이 완료되었습니다!";
  return buildList("📝 할 일 요약\n", sections, "\n\n");
}

function formatUnsubmitted(data: unknown): string {
  const items = Array.isArray(data) ? data : (data as { items?: unknown[] }).items || [];
  if (items.length === 0) return "⚠️ 미제출 과제 없음";

  const lines = (items as Array<{ title: string; courseTitle: string; dueLabel?: string; isExpired?: boolean }>).map(
    (a) => `  ${a.isExpired ? "🔴" : "🟡"} ${a.title} (${a.courseTitle})${a.dueLabel ? ` — ${a.dueLabel}` : ""}`
  );
  return buildList(`⚠️ 미제출 과제 ${items.length}건\n`, lines);
}

function formatDueAssignments(data: unknown): string {
  const items = Array.isArray(data) ? data : (data as { items?: unknown[] }).items || [];
  if (items.length === 0) return "⏰ 마감 임박 과제 없음";

  const lines = (items as Array<{ title: string; courseTitle: string; dueLabel?: string }>).map(
    (a) => `  ⏰ ${a.title} (${a.courseTitle})${a.dueLabel ? ` — ${a.dueLabel}` : ""}`
  );
  return buildList(`⏰ 마감 임박 ${items.length}건\n`, lines);
}

function formatUnreadNotices(data: unknown): string {
  const items = Array.isArray(data) ? data : (data as { items?: unknown[] }).items || [];
  if (items.length === 0) return "🔔 새로운 공지 없음";

  const lines = (items as Array<{ title: string; courseTitle?: string; postedAt?: string }>).map(
    (n) => `  🔔 ${n.title}${n.courseTitle ? ` (${n.courseTitle})` : ""}`
  );
  return buildList(`🔔 안읽은 공지 ${items.length}건\n`, lines);
}

function formatGeneric(data: unknown): string {
  const json = JSON.stringify(data, null, 2);
  if (json.length <= SOFT_LIMIT) return json;
  return json.slice(0, SOFT_LIMIT - 15) + "\n\n...(생략됨)";
}
