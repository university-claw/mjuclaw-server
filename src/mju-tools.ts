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

const KEYWORD_MAP: Array<{ keywords: string[]; tool: string; description: string }> = [
  { keywords: ["출석", "출결", "결석", "지각"], tool: "mju_ucheck_get_course_attendance", description: "출석 현황" },
  { keywords: ["시간표", "수업시간", "강의시간"], tool: "mju_msi_get_timetable", description: "시간표" },
  { keywords: ["성적", "학점", "점수"], tool: "mju_msi_get_current_term_grades", description: "이번 학기 성적" },
  { keywords: ["졸업", "졸업요건"], tool: "mju_msi_get_graduation_requirements", description: "졸업 요건" },
  { keywords: ["과목", "수강", "강의목록"], tool: "mju_lms_list_courses", description: "수강 과목" },
  { keywords: ["공지", "알림"], tool: "mju_lms_list_notices", description: "공지사항" },
  { keywords: ["과제", "숙제", "레포트"], tool: "mju_lms_get_action_items", description: "할 일 목록" },
];

export function detectMjuIntent(utterance: string): { tool: string; description: string } | null {
  const lower = utterance.toLowerCase();
  for (const entry of KEYWORD_MAP) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return { tool: entry.tool, description: entry.description };
    }
  }
  return null;
}

// ── 스마트 핸들러 (체이닝이 필요한 도구) ─────────────────────────

export async function handleMjuRequest(kakaoId: string, utterance: string): Promise<string | null> {
  const intent = detectMjuIntent(utterance);
  if (!intent) return null;

  console.log(`[mju] detected intent: ${intent.tool} (${intent.description})`);

  // 출석: 과목 목록 → 각 과목 출석 조회
  if (intent.tool === "mju_ucheck_get_course_attendance") {
    return await handleAttendance(kakaoId);
  }

  // 과제/할 일: 과목 목록 → 각 과목 할 일
  if (intent.tool === "mju_lms_get_action_items") {
    return await handleActionItems(kakaoId);
  }

  // 단순 도구 호출
  const result = await callMjuTool(kakaoId, intent.tool);
  return `📋 ${intent.description}\n\n${result}`;
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

async function handleActionItems(kakaoId: string): Promise<string> {
  const result = await callMjuTool(kakaoId, "mju_lms_get_action_items");
  return `📋 할 일 목록\n\n${result}`;
}

// ── 정리 ─────────────────────────────────────────────────────────

export async function closeMjuClient(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    transport = null;
  }
}
