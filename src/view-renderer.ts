import type { ViewEntry } from "./types";

export function renderViewHtml(entry: ViewEntry): string {
  const dataHtml = renderData(entry.dataType, entry.rawData);
  const time = new Date(entry.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(entry.title)}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; min-height: 100vh; padding: 16px; }
.wrap { max-width: 500px; margin: 0 auto; }
.header { text-align: center; padding: 16px 0; }
.header img { width: 56px; height: 56px; object-fit: contain; }
.header h1 { font-size: 18px; color: #1a1a1a; margin-top: 8px; }
.card { background: #fff; border-radius: 14px; box-shadow: 0 1px 8px rgba(0,0,0,0.06); padding: 20px; margin-bottom: 12px; }
.card-title { font-size: 14px; font-weight: 600; color: #3B82F6; margin-bottom: 10px; }
.ai-text { font-size: 14px; line-height: 1.7; color: #333; word-break: break-word; }
.ai-text p { margin-bottom: 8px; }
.ai-text ul, .ai-text ol { padding-left: 18px; margin-bottom: 8px; }
.ai-text li { margin-bottom: 4px; }
.ai-text strong { font-weight: 600; }
.ai-text h1, .ai-text h2, .ai-text h3 { font-size: 15px; font-weight: 600; margin-bottom: 6px; margin-top: 12px; }
.ai-text hr { border: none; border-top: 1px solid #eee; margin: 10px 0; }
.section { margin-bottom: 16px; }
.section-title { font-size: 13px; font-weight: 600; color: #666; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #eee; }
.item { padding: 10px 0; border-bottom: 1px solid #f0f0f0; }
.item:last-child { border-bottom: none; }
.item-title { font-size: 14px; font-weight: 500; color: #1a1a1a; }
.item-sub { font-size: 12px; color: #888; margin-top: 2px; }
.badge { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 500; }
.badge-red { background: #FEE2E2; color: #DC2626; }
.badge-yellow { background: #FEF9C3; color: #A16207; }
.badge-green { background: #DCFCE7; color: #16A34A; }
.badge-blue { background: #DBEAFE; color: #2563EB; }
.badge-gray { background: #F3F4F6; color: #6B7280; }
.day-group { margin-bottom: 14px; }
.day-label { font-size: 13px; font-weight: 600; color: #3B82F6; margin-bottom: 6px; }
.progress-wrap { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.progress-bar { flex: 1; height: 8px; background: #E5E7EB; border-radius: 4px; overflow: hidden; }
.progress-fill { height: 100%; border-radius: 4px; }
.progress-text { font-size: 12px; color: #666; min-width: 60px; text-align: right; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; font-weight: 500; color: #888; padding: 6px 8px; border-bottom: 2px solid #eee; }
td { padding: 8px; border-bottom: 1px solid #f0f0f0; color: #333; }
.footer { text-align: center; font-size: 11px; color: #aaa; padding: 16px 0; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <img src="/myongmyong.png" alt="명명이">
    <h1>${esc(entry.title)}</h1>
  </div>
  <div class="card">
    <div class="card-title">AI 요약</div>
    <div class="ai-text" id="ai-summary"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script>
    document.getElementById('ai-summary').innerHTML = marked.parse(${JSON.stringify(entry.aiResponse)});
  </script>
  ${dataHtml}
  <div class="footer">${esc(time)} 조회</div>
</div>
</body>
</html>`;
}

export function renderExpiredHtml(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>만료됨</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f5f5f5; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
.card { background: #fff; border-radius: 14px; box-shadow: 0 1px 8px rgba(0,0,0,0.06); padding: 32px 24px; text-align: center; max-width: 400px; }
.icon { font-size: 48px; margin-bottom: 12px; }
.title { font-size: 18px; font-weight: 600; color: #1a1a1a; margin-bottom: 8px; }
.desc { font-size: 14px; color: #888; line-height: 1.6; }
</style>
</head>
<body>
<div class="card">
  <div class="icon">⏳</div>
  <div class="title">데이터가 만료되었습니다</div>
  <div class="desc">카카오톡에서 다시 조회해주세요</div>
</div>
</body>
</html>`;
}

// ── dataType별 렌더러 ───────────────────────────────────────────

function renderData(dataType: string, data: unknown): string {
  if (!data) return "";
  const renderers: Record<string, (d: unknown) => string> = {
    timetable: renderTimetable,
    grades: renderGrades,
    graduation: renderGraduation,
    courses: renderCourses,
    "action-items": renderActionItems,
    unsubmitted: renderAssignmentList,
    "due-assignments": renderAssignmentList,
    "unread-notices": renderNoticeList,
    attendance: renderAttendanceText,
  };
  const renderer = renderers[dataType];
  if (renderer) return renderer(data);
  return renderGeneric(data);
}

// ── 시간표 ──────────────────────────────────────────────────────

function renderTimetable(data: unknown): string {
  const d = data as { entries?: Array<{ dayOfWeek: number; dayLabel?: string; courseTitle: string; location?: string; timeRange?: string; professor?: string }> };
  if (!d.entries?.length) return "";

  const days = ["월", "화", "수", "목", "금"];
  const byDay = new Map<string, typeof d.entries>();
  for (const e of d.entries) {
    const day = e.dayLabel || days[e.dayOfWeek - 1] || "?";
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(e);
  }

  let html = `<div class="card"><div class="card-title">상세 시간표</div>`;
  for (const day of days) {
    const entries = byDay.get(day);
    if (!entries) continue;
    entries.sort((a, b) => (a.timeRange || "").localeCompare(b.timeRange || ""));
    html += `<div class="day-group"><div class="day-label">${day}요일</div>`;
    for (const e of entries) {
      html += `<div class="item"><div class="item-title">${esc(e.courseTitle)}</div><div class="item-sub">${esc(e.timeRange || "")} · ${esc(e.location || "")}${e.professor ? ` · ${esc(e.professor)}` : ""}</div></div>`;
    }
    html += `</div>`;
  }
  return html + `</div>`;
}

// ── 성적 ────────────────────────────────────────────────────────

function renderGrades(data: unknown): string {
  const d = data as { items?: Array<{ courseTitle: string; credits?: number; grade?: string; statusMessage?: string }> };
  if (!d.items?.length) return "";

  let html = `<div class="card"><div class="card-title">성적 상세</div><table><tr><th>과목</th><th>학점</th><th>성적</th></tr>`;
  for (const item of d.items) {
    const grade = item.grade || item.statusMessage || "-";
    html += `<tr><td>${esc(item.courseTitle)}</td><td>${item.credits ?? "-"}</td><td>${esc(grade)}</td></tr>`;
  }
  return html + `</table></div>`;
}

// ── 졸업요건 ────────────────────────────────────────────────────

function renderGraduation(data: unknown): string {
  const d = data as { creditGaps?: Array<{ label: string; earned?: number; required?: number; gap?: number }> };
  if (!d.creditGaps?.length) return "";

  let html = `<div class="card"><div class="card-title">졸업요건 상세</div>`;
  for (const g of d.creditGaps) {
    const earned = g.earned ?? 0;
    const required = g.required ?? 1;
    const pct = Math.min(100, Math.round((earned / required) * 100));
    const color = (g.gap ?? 0) > 0 ? "#EF4444" : "#22C55E";
    const badgeCls = (g.gap ?? 0) > 0 ? "badge-red" : "badge-green";
    html += `<div class="item">
      <div class="item-title">${esc(g.label)} <span class="badge ${badgeCls}">${(g.gap ?? 0) > 0 ? `부족 ${g.gap}` : "충족"}</span></div>
      <div class="progress-wrap">
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${color}"></div></div>
        <div class="progress-text">${earned} / ${required}</div>
      </div>
    </div>`;
  }
  return html + `</div>`;
}

// ── 수강과목 ────────────────────────────────────────────────────

function renderCourses(data: unknown): string {
  const d = data as { courses?: Array<{ title: string; professor?: string; code?: string }> };
  if (!d.courses?.length) return "";

  let html = `<div class="card"><div class="card-title">수강과목 (${d.courses.length}개)</div>`;
  for (const c of d.courses) {
    html += `<div class="item"><div class="item-title">${esc(c.title)}</div><div class="item-sub">${esc(c.professor || "")}${c.code ? ` · ${esc(c.code)}` : ""}</div></div>`;
  }
  return html + `</div>`;
}

// ── 할 일 목록 ──────────────────────────────────────────────────

function renderActionItems(data: unknown): string {
  const d = data as Record<string, unknown>;
  let html = "";

  const unsub = d.unsubmittedAssignments as Array<{ title: string; courseTitle: string; dueLabel?: string; isExpired?: boolean }> | undefined;
  if (unsub?.length) {
    html += `<div class="card"><div class="card-title">미제출 과제 (${unsub.length}건)</div>`;
    for (const a of unsub) {
      const badgeCls = a.isExpired ? "badge-red" : "badge-yellow";
      const badgeText = a.isExpired ? "만료" : "진행중";
      html += `<div class="item"><div class="item-title">${esc(a.title)} <span class="badge ${badgeCls}">${badgeText}</span></div><div class="item-sub">${esc(a.courseTitle)}${a.dueLabel ? ` · ${esc(a.dueLabel)}` : ""}</div></div>`;
    }
    html += `</div>`;
  }

  const due = d.dueAssignments as Array<{ title: string; courseTitle: string; dueLabel?: string }> | undefined;
  if (due?.length) {
    html += `<div class="card"><div class="card-title">마감 임박 (${due.length}건)</div>`;
    for (const a of due) {
      html += `<div class="item"><div class="item-title">${esc(a.title)}</div><div class="item-sub">${esc(a.courseTitle)} · ${esc(a.dueLabel || "")}</div></div>`;
    }
    html += `</div>`;
  }

  const notices = d.unreadNotices as Array<{ title: string; courseTitle: string }> | undefined;
  if (notices?.length) {
    html += `<div class="card"><div class="card-title">안읽은 공지 (${notices.length}건)</div>`;
    for (const n of notices) {
      html += `<div class="item"><div class="item-title">${esc(n.title)}</div><div class="item-sub">${esc(n.courseTitle)}</div></div>`;
    }
    html += `</div>`;
  }

  return html;
}

// ── 과제 리스트 (미제출 / 마감 임박 공용) ────────────────────────

function renderAssignmentList(data: unknown): string {
  const items = Array.isArray(data) ? data : (data as { items?: unknown[] }).items || [];
  if (!items.length) return "";

  let html = `<div class="card"><div class="card-title">과제 상세</div>`;
  for (const a of items as Array<{ title: string; courseTitle: string; dueLabel?: string; isExpired?: boolean }>) {
    const badgeCls = a.isExpired ? "badge-red" : "badge-yellow";
    const badgeText = a.isExpired ? "만료" : "진행중";
    html += `<div class="item"><div class="item-title">${esc(a.title)} <span class="badge ${badgeCls}">${badgeText}</span></div><div class="item-sub">${esc(a.courseTitle)}${a.dueLabel ? ` · ${esc(a.dueLabel)}` : ""}</div></div>`;
  }
  return html + `</div>`;
}

// ── 공지 리스트 ─────────────────────────────────────────────────

function renderNoticeList(data: unknown): string {
  const items = Array.isArray(data) ? data : (data as { items?: unknown[] }).items || [];
  if (!items.length) return "";

  let html = `<div class="card"><div class="card-title">공지 상세</div>`;
  for (const n of items as Array<{ title: string; courseTitle?: string; postedAt?: string }>) {
    html += `<div class="item"><div class="item-title">${esc(n.title)}</div><div class="item-sub">${esc(n.courseTitle || "")}${n.postedAt ? ` · ${esc(n.postedAt)}` : ""}</div></div>`;
  }
  return html + `</div>`;
}

// ── 출석 (텍스트 데이터) ────────────────────────────────────────

function renderAttendanceText(data: unknown): string {
  if (typeof data !== "string") return renderGeneric(data);
  return `<div class="card"><div class="card-title">출석 상세</div><div class="ai-text">${esc(data)}</div></div>`;
}

// ── 기본 (JSON) ─────────────────────────────────────────────────

function renderGeneric(data: unknown): string {
  const json = JSON.stringify(data, null, 2);
  return `<div class="card"><div class="card-title">원본 데이터</div><pre style="font-size:12px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;color:#333;">${esc(json)}</pre></div>`;
}

// ── HTML 이스케이프 ─────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
