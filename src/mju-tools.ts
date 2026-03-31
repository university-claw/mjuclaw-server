import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";
import { getDecryptedPassword } from "./session";

const MJU_MCP_PATH = path.join(__dirname, "..", "mju-mcp", "dist", "index.js");

let client: Client | null = null;
let transport: StdioClientTransport | null = null;

// ── MCP 클라이언트 초기화 ────────────────────────────────────────

async function getClient(kakaoId: string): Promise<Client> {
  if (client) return client;

  // 유저 크리덴셜 복호화
  const password = getDecryptedPassword(kakaoId);

  transport = new StdioClientTransport({
    command: "node",
    args: [MJU_MCP_PATH],
    env: {
      ...process.env,
      MJU_USERNAME: "60212158", // TODO: 유저별 학번 매핑
      MJU_PASSWORD: password || "",
      MJU_LMS_APP_DIR: path.join(__dirname, "..", "data", "mju-mcp"),
      MJU_MSI_APP_DIR: path.join(__dirname, "..", "data", "mju-mcp"),
      MJU_UCHECK_APP_DIR: path.join(__dirname, "..", "data", "mju-mcp"),
      MJU_LIBRARY_APP_DIR: path.join(__dirname, "..", "data", "mju-mcp"),
    },
  });

  client = new Client({ name: "kakao-bridge", version: "0.1.0" });
  await client.connect(transport);
  console.log("[mju] MCP client connected");
  return client;
}

// ── 도구 호출 ────────────────────────────────────────────────────

export async function callMjuTool(
  kakaoId: string,
  toolName: string,
  args: Record<string, unknown> = {}
): Promise<string> {
  try {
    const c = await getClient(kakaoId);
    const result = await c.callTool({ name: toolName, arguments: args });

    // MCP 도구 결과를 텍스트로 변환
    if (result.content && Array.isArray(result.content)) {
      return result.content
        .map((item) => {
          if (typeof item === "object" && item !== null && "text" in item) {
            return String(item.text);
          }
          return JSON.stringify(item);
        })
        .join("\n");
    }
    return JSON.stringify(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[mju] tool ${toolName} error: ${msg}`);
    return `도구 호출 오류: ${msg}`;
  }
}

// ── 사용 가능한 도구 목록 ────────────────────────────────────────

export async function listMjuTools(kakaoId: string): Promise<string[]> {
  try {
    const c = await getClient(kakaoId);
    const tools = await c.listTools();
    return tools.tools.map((t) => t.name);
  } catch {
    return [];
  }
}

// ── 키워드 → 도구 매핑 ──────────────────────────────────────────

interface IntentEntry {
  keywords: string[];
  tool: string;
  description: string;
  emoji: string;
  args?: Record<string, unknown>; // 기본 파라미터
  handler?: "attendance" | "simple"; // 특수 핸들러
}

const KEYWORD_MAP: IntentEntry[] = [
  // 출석 — 과목별 체이닝 필요
  { keywords: ["출석", "출결", "결석", "지각"], tool: "mju_ucheck_get_course_attendance", description: "출석 현황", emoji: "📋", handler: "attendance" },
  // allCourses 지원 — 바로 전체 조회
  { keywords: ["과제", "숙제", "레포트", "할 일", "할일", "투두"], tool: "mju_lms_get_action_items", description: "할 일 목록", emoji: "📝", args: { allCourses: true } },
  { keywords: ["미제출"], tool: "mju_lms_get_unsubmitted_assignments", description: "미제출 과제", emoji: "⚠️", args: { allCourses: true } },
  { keywords: ["마감", "데드라인", "임박"], tool: "mju_lms_get_due_assignments", description: "마감 임박 과제", emoji: "⏰", args: { allCourses: true } },
  { keywords: ["안읽은 공지", "새 공지"], tool: "mju_lms_get_unread_notices", description: "안읽은 공지", emoji: "🔔", args: { allCourses: true } },
  { keywords: ["미수강", "온라인 강의", "온라인강의"], tool: "mju_lms_get_incomplete_online_weeks", description: "미수강 온라인 학습", emoji: "🎬", args: { allCourses: true } },
  // 단순 호출 (파라미터 불필요)
  { keywords: ["시간표", "수업시간", "강의시간"], tool: "mju_msi_get_timetable", description: "시간표", emoji: "🕐" },
  { keywords: ["성적", "학점", "점수"], tool: "mju_msi_get_current_term_grades", description: "이번 학기 성적", emoji: "📊" },
  { keywords: ["성적이력", "전체성적", "전체 성적"], tool: "mju_msi_get_grade_history", description: "성적 이력", emoji: "📈" },
  { keywords: ["졸업", "졸업요건", "졸업학점"], tool: "mju_msi_get_graduation_requirements", description: "졸업 요건", emoji: "🎓" },
  { keywords: ["과목", "수강", "강의목록"], tool: "mju_lms_list_courses", description: "수강 과목", emoji: "📚" },
  { keywords: ["공지", "알림"], tool: "mju_lms_list_notices", description: "공지사항", emoji: "📢", args: { allCourses: true } },
  // 도서관
  { keywords: ["스터디룸", "스터디 룸"], tool: "mju_library_list_study_rooms", description: "스터디룸 현황", emoji: "🏫" },
  { keywords: ["열람실", "좌석"], tool: "mju_library_list_reading_rooms", description: "열람실 현황", emoji: "📖" },
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

// ── 스마트 핸들러 ────────────────────────────────────────────────

export async function handleMjuRequest(kakaoId: string, utterance: string): Promise<string | null> {
  const intent = detectMjuIntent(utterance);
  if (!intent) return null;

  console.log(`[mju] detected: ${intent.tool} (${intent.description})`);

  // 출석 — 특수 체이닝
  if (intent.handler === "attendance") {
    return await handleAttendance(kakaoId);
  }

  // 일반 도구 호출 (args가 있으면 함께 전달)
  const result = await callMjuTool(kakaoId, intent.tool, intent.args || {});
  return formatResult(intent, result);
}

async function handleAttendance(kakaoId: string): Promise<string> {
  // 1) 과목 목록 가져오기
  const coursesRaw = await callMjuTool(kakaoId, "mju_lms_list_courses");

  // 텍스트에서 과목명과 과목코드 추출 (패턴: | 과목명 | 과목코드-분반 | 교수 | ...)
  const courseRegex = /\|\s*(.+?)\s*\|\s*([\w]+-\d+)\s*\|/g;
  const courses: Array<{ name: string; code: string }> = [];
  let match;
  while ((match = courseRegex.exec(coursesRaw)) !== null) {
    courses.push({ name: match[1].trim(), code: match[2].trim() });
  }

  if (courses.length === 0) {
    return `📋 출석 현황\n\n과목을 찾을 수 없습니다.\n\n${coursesRaw.slice(0, 500)}`;
  }

  // 2) 각 과목 출석 조회 (과목명으로 검색) + 요약 포맷
  const results: string[] = [];
  for (const course of courses) {
    try {
      const att = await callMjuTool(kakaoId, "mju_ucheck_get_course_attendance", { course: course.name });
      results.push(formatAttendanceSummary(course.name, att));
    } catch {
      results.push(`📚 ${course.name} — 조회 실패`);
    }
  }

  return `📋 출석 현황\n\n${results.join("\n\n")}`;
}

function formatAttendanceSummary(courseName: string, raw: string): string {
  // 요약 행 추출: "출석 7 | 지각 0 | 조퇴 0 | 결석 1"
  const summaryMatch = raw.match(/출석\s*(\d+)\s*\|\s*지각\s*(\d+)\s*\|\s*조퇴\s*(\d+)\s*\|\s*결석\s*(\d+)/);
  const sessionsMatch = raw.match(/진행된 회차\s*(\d+)개/);

  let summary = "";
  if (summaryMatch) {
    const [, att, late, early, absent] = summaryMatch;
    const done = sessionsMatch ? sessionsMatch[1] : "?";
    summary = `출석${att} 지각${late} 결석${absent}`;
    if (Number(early) > 0) summary += ` 조퇴${early}`;
    summary += ` (${done}회 진행)`;
  }

  // 문제 있는 회차만 추출 (결석, 지각, 조퇴, 기록 없음)
  const problemLines: string[] = [];
  const lineRegex = /- .+?\|.+?\|.+?\|.+?\|\s*(결석|지각|조퇴|기록 없음)/g;
  let m;
  while ((m = lineRegex.exec(raw)) !== null) {
    // 날짜와 상태만 추출
    const parts = m[0].split("|").map((s) => s.trim());
    const date = parts[1]?.trim() || "";
    const status = m[1];
    problemLines.push(`  ${date} → ${status}`);
  }

  let result = `📚 ${courseName} — ${summary || "요약 없음"}`;
  if (problemLines.length > 0) {
    result += `\n⚠️ 주의:\n${problemLines.join("\n")}`;
  }
  return result;
}

function formatResult(intent: IntentEntry, raw: string): string {
  const formatters: Record<string, (r: string) => string> = {
    mju_lms_get_action_items: formatActionItems,
    mju_msi_get_timetable: formatTimetable,
    mju_msi_get_current_term_grades: formatGrades,
    mju_msi_get_graduation_requirements: formatGraduation,
    mju_lms_list_courses: formatCourses,
    mju_lms_get_unsubmitted_assignments: formatUnsubmitted,
    mju_lms_get_due_assignments: formatDueAssignments,
    mju_lms_get_unread_notices: formatUnreadNotices,
  };

  const formatter = formatters[intent.tool];
  if (formatter) return formatter(raw);
  return `${intent.emoji} ${intent.description}\n\n${raw}`;
}

// ── 시간표 ───────────────────────────────────────────────────────

function formatTimetable(raw: string): string {
  // 요일별 그룹핑
  const dayOrder = ["월", "화", "수", "목", "금"];
  const schedule = new Map<string, string[]>();
  const regex = /- (.+?)\s*\|\s*(\S)\s*\|\s*(\S+)\s*\|\s*(.+?)\s*\|\s*(.+)/g;
  let m;
  while ((m = regex.exec(raw)) !== null) {
    const [, name, day, time, , room] = m;
    const entry = `  ${time} ${name} (${room.trim()})`;
    if (!schedule.has(day)) schedule.set(day, []);
    schedule.get(day)!.push(entry);
  }

  const lines: string[] = [];
  for (const day of dayOrder) {
    const entries = schedule.get(day);
    if (entries) {
      lines.push(`${day}요일`);
      // 시간순 정렬
      entries.sort();
      lines.push(...entries);
    }
  }

  return lines.length > 0
    ? `🕐 시간표\n\n${lines.join("\n")}`
    : `🕐 시간표\n\n${raw}`;
}

// ── 성적 ─────────────────────────────────────────────────────────

function formatGrades(raw: string): string {
  const lines: string[] = [];
  const regex = /- (.+?)\s*\|\s*\d+\s*\|\s*(\d+학점)\s*\|\s*(.+)/g;
  let m;
  while ((m = regex.exec(raw)) !== null) {
    const [, name, credits, note] = m;
    lines.push(`  ${name} (${credits}) — ${note.trim()}`);
  }

  const countMatch = raw.match(/(\d+)건/);
  const header = countMatch ? `총 ${countMatch[1]}과목` : "";

  return lines.length > 0
    ? `📊 이번 학기 성적 ${header}\n\n${lines.join("\n")}`
    : `📊 이번 학기 성적\n\n${raw}`;
}

// ── 졸업요건 ─────────────────────────────────────────────────────

function formatGraduation(raw: string): string {
  const lines: string[] = [];
  const regex = /- (.+?)\s*\|\s*취득\s*(\d+)\s*\|\s*필요\s*(\d+)\s*\|\s*부족\s*(\d+)/g;
  let m;
  while ((m = regex.exec(raw)) !== null) {
    const [, category, earned, required, short] = m;
    const bar = Number(short) > 0 ? "🔴" : "✅";
    lines.push(`  ${bar} ${category}: ${earned}/${required} (부족 ${short})`);
  }

  const shortMatch = raw.match(/부족 항목 (\d+)건/);
  const status = shortMatch
    ? Number(shortMatch[1]) > 0 ? `부족 ${shortMatch[1]}건` : "충족"
    : "";

  return lines.length > 0
    ? `🎓 졸업요건 — ${status}\n\n${lines.join("\n")}`
    : `🎓 졸업요건\n\n${raw}`;
}

// ── 수강과목 ─────────────────────────────────────────────────────

function formatCourses(raw: string): string {
  const lines: string[] = [];
  const regex = /\|\s*(.+?)\s*\|\s*([\w]+-\d+)\s*\|\s*(.+?)\s*\|/g;
  let m;
  while ((m = regex.exec(raw)) !== null) {
    const [, name, code, prof] = m;
    lines.push(`  📚 ${name} (${prof.trim()})`);
  }

  const countMatch = raw.match(/총\s*(\d+)개/);
  return lines.length > 0
    ? `📚 수강과목 ${countMatch ? countMatch[1] + "개" : ""}\n\n${lines.join("\n")}`
    : `📚 수강과목\n\n${raw}`;
}

// ── 미제출 과제 ──────────────────────────────────────────────────

function formatUnsubmitted(raw: string): string {
  const lines: string[] = [];
  const regex = /- \[\d+\]\s*(.+?)\s*\|\s*(.+?)\s*\|\s*.+?\s*\|\s*(.+)/g;
  let m;
  while ((m = regex.exec(raw)) !== null) {
    const isExpired = m[3].includes("만료");
    lines.push(`  ${isExpired ? "🔴" : "🟡"} ${m[1].trim()} (${m[2].trim()}) — ${m[3].trim()}`);
  }
  const countMatch = raw.match(/(\d+)건/);
  return lines.length > 0
    ? `⚠️ 미제출 과제 ${countMatch ? countMatch[1] + "건" : ""}\n\n${lines.join("\n")}`
    : `⚠️ 미제출 과제\n\n${raw}`;
}

// ── 마감 임박 ────────────────────────────────────────────────────

function formatDueAssignments(raw: string): string {
  const lines: string[] = [];
  const regex = /- \[\d+\]\s*(.+?)\s*\|\s*(.+?)\s*\|\s*.+?\s*\|\s*(.+)/g;
  let m;
  while ((m = regex.exec(raw)) !== null) {
    lines.push(`  ⏰ ${m[1].trim()} (${m[2].trim()}) — ${m[3].trim()}`);
  }
  const countMatch = raw.match(/(\d+)건/);
  if (lines.length === 0) return "⏰ 마감 임박 과제 없음";
  return `⏰ 마감 임박 ${countMatch ? countMatch[1] + "건" : ""}\n\n${lines.join("\n")}`;
}

// ── 안읽은 공지 ──────────────────────────────────────────────────

function formatUnreadNotices(raw: string): string {
  const lines: string[] = [];
  const regex = /- \[\d+\]\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|/g;
  let m;
  while ((m = regex.exec(raw)) !== null) {
    lines.push(`  🔔 ${m[1].trim()} (${m[2].trim()})`);
  }
  const countMatch = raw.match(/(\d+)건/);
  if (lines.length === 0) return "🔔 새로운 공지 없음";
  return `🔔 안읽은 공지 ${countMatch ? countMatch[1] + "건" : ""}\n\n${lines.join("\n")}`;
}

// ── 할 일 목록 ───────────────────────────────────────────────────

function formatActionItems(raw: string): string {
  const sections: string[] = [];

  // 미제출 과제
  const unsubMatch = raw.match(/미제출 과제 (\d+)건/);
  if (unsubMatch && Number(unsubMatch[1]) > 0) {
    const lines: string[] = [];
    const regex = /- \[\d+\]\s*(.+?)\s*\|\s*(.+?)\s*\|\s*.+?\s*\|\s*(.+)/g;
    let m;
    // 미제출 과제 섹션만 파싱
    const unsubSection = raw.split("미제출 과제")[1]?.split(/\n\n|\n\d+일 이내|\n안읽은|\n미수강/)[0] || "";
    while ((m = regex.exec(unsubSection)) !== null) {
      const name = m[1].trim();
      const course = m[2].trim();
      const deadline = m[3].trim();
      const isExpired = deadline.includes("만료");
      lines.push(`  ${isExpired ? "🔴" : "🟡"} ${name} (${course}) — ${deadline}`);
    }
    if (lines.length > 0) {
      sections.push(`📌 미제출 과제 ${unsubMatch[1]}건\n${lines.join("\n")}`);
    }
  }

  // 마감 임박
  const dueMatch = raw.match(/(\d+)일 이내 마감 과제 (\d+)건/);
  if (dueMatch && Number(dueMatch[2]) > 0) {
    const dueSection = raw.split("이내 마감 과제")[1]?.split(/\n\n|\n안읽은|\n미수강/)[0] || "";
    const lines: string[] = [];
    const regex = /- \[\d+\]\s*(.+?)\s*\|\s*(.+?)\s*\|\s*.+?\s*\|\s*(.+)/g;
    let m;
    while ((m = regex.exec(dueSection)) !== null) {
      lines.push(`  ⏰ ${m[1].trim()} (${m[2].trim()}) — ${m[3].trim()}`);
    }
    if (lines.length > 0) {
      sections.push(`⏰ 마감 임박 ${dueMatch[2]}건\n${lines.join("\n")}`);
    }
  }

  // 안읽은 공지
  const noticeMatch = raw.match(/안읽은 공지 (\d+)건/);
  if (noticeMatch && Number(noticeMatch[1]) > 0) {
    const noticeSection = raw.split("안읽은 공지")[1]?.split(/\n\n|\n미수강/)[0] || "";
    const lines: string[] = [];
    const regex = /- \[\d+\]\s*(.+?)\s*\|\s*(.+?)\s*\|/g;
    let m;
    while ((m = regex.exec(noticeSection)) !== null) {
      lines.push(`  🔔 ${m[1].trim()} (${m[2].trim()})`);
    }
    if (lines.length > 0) {
      sections.push(`🔔 안읽은 공지 ${noticeMatch[1]}건\n${lines.join("\n")}`);
    }
  }

  // 미수강 온라인
  const onlineMatch = raw.match(/미수강 온라인 학습 (\d+)건/);
  if (onlineMatch && Number(onlineMatch[1]) > 0) {
    sections.push(`🎬 미수강 온라인 학습 ${onlineMatch[1]}건`);
  }

  if (sections.length === 0) {
    return "✅ 할 일 없음\n\n모든 과제와 학습이 완료되었습니다!";
  }

  return `📝 할 일 요약\n\n${sections.join("\n\n")}`;
}

// ── 정리 ─────────────────────────────────────────────────────────

export async function closeMjuClient(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    transport = null;
  }
}
