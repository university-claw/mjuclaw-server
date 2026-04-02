# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MJUClaw Server — 명지대학교 카카오톡 채널을 통해 AI 에이전트(NemoClaw/OpenClaw) + 학사 서비스(LMS, MSI, UCheck, 도서관)를 사용할 수 있게 하는 Express 서버.

- **레포**: github.com/university-claw/mjuclaw-server
- **관련 레포**: github.com/university-claw/mju-mcp (MCP 서버), github.com/nullhyeon/mju-cli (CLI 도구)

## Build & Run

```bash
npm install          # 의존성 설치
npm run build        # tsc → dist/
npm start            # node dist/index.js (프로덕션)
npm run dev          # ts-node src/index.ts (개발)
```

mju-mcp 빌드 (별도 클론 후):
```bash
cd mju-mcp && npm install --include=dev && npx tsc
```

테스트 프레임워크 없음. curl로 수동 테스트:
```bash
curl http://localhost:3000/health
curl -X POST http://localhost:3000/skill -H "Content-Type: application/json" \
  -d '{"intent":{"id":"t","name":"t"},"userRequest":{"timezone":"Asia/Seoul","params":{},"block":{"id":"t","name":"t"},"utterance":"시간표","lang":null,"user":{"id":"test-user","type":"botUserKey","properties":{}}},"bot":{"id":"t","name":"t"},"action":{"name":"t","clientExtra":null,"params":{},"id":"t","detailParams":{}}}'
```

## Architecture

```
카카오톡 유저
    ↓ POST /skill
┌──────────────────────────────────────────┐
│  MJUClaw Server (Express, port 3000)     │
│                                          │
│  1. 즉시 응답 (useCallback: true)        │
│  2. 유저 인증 확인 (웹 온보딩)           │
│  3. 키워드 감지 → mju-mcp 직접 호출     │
│  4. 일반 질문 → NemoClaw 에이전트 호출   │
│  5. 응답 포맷팅 → 카카오 콜백 전송       │
└──────────┬───────────────┬───────────────┘
           │               │
     ┌─────▼─────┐   ┌────▼──────────────┐
     │  mju-mcp  │   │  NemoClaw 샌드박스 │
     │(subprocess)│   │  (OpenShell SSH)   │
     └───────────┘   └────────────────────┘
```

### Request Flow (server.ts)

`POST /skill` → 카카오 스킬 웹훅 엔트리포인트. 두 가지 모드:

1. **콜백 모드** (`callbackUrl` 존재): 즉시 `useCallback: true` 응답 → 백그라운드에서 `processAsync()` 실행 → 결과를 callbackUrl로 POST
2. **동기 모드** (콜백 없음): 4.5초 타임아웃 내에 응답 시도

`processMessage()` 내부 라우팅:
- `/reset`, `/help` → 슬래시 명령어 핸들러
- 키워드 매치 (출석, 시간표, 성적 등) → `handleMjuRequest()` → mju-mcp 도구 호출
- 나머지 → `runAgent()` → NemoClaw SSH 에이전트

### Key Design Decisions

1. **mju-mcp는 호스트에서 subprocess(stdio)로 실행** — 샌드박스 프록시(10.200.0.1:3128)가 mju.ac.kr CONNECT 터널을 차단하여 샌드박스 내 실행 불가. MCP SDK Client가 `node mju-mcp/dist/index.js`를 직접 spawn.
2. **NemoClaw는 블랙박스** — fork 없이 `openshell sandbox ssh-config` → SSH로 `openclaw agent` 명령 실행. stdout에서 셋업 라인 필터링 후 응답 추출.
3. **카카오 5초 타임아웃 우회** — 오픈빌더 "콜백 URL 발행" 활성화 필수. 없으면 callbackUrl이 req.body에 포함되지 않음.
4. **유저별 동시성 제어** — nemoclaw.ts의 `enqueue()` 함수가 같은 userId의 SSH 요청을 Promise 체인으로 직렬화.

### Module Responsibilities

- **server.ts** — Express 라우트, 메시지 라우팅 (키워드 → mju-tools / 일반 → nemoclaw), 동기/비동기 분기
- **mju-tools.ts** — MCP 클라이언트 싱글턴, 키워드→도구 매핑 (`KEYWORD_MAP` 배열), 출석 체이닝 (과목목록 → 각 과목 출석 조회), 각 도구별 카카오톡 포맷터
- **nemoclaw.ts** — OpenShell SSH 실행, stdout 필터링, 유저별 Promise 큐
- **kakao.ts** — 카카오 응답 빌더 (simpleText, basicCard, 콜백 POST), 900자/3버블 분할
- **session.ts** — 인메모리 세션 + 파일 기반 크리덴셜 (AES-256-GCM), 24시간 TTL 자동 정리
- **config.ts** — 환경변수 로드. ENCRYPTION_KEY 미설정 시 임시 키 생성 (재시작 시 복호화 불가 경고)
- **types.ts** — 카카오 스킬 API 요청/응답 타입, 내부 세션/크리덴셜 타입

### Data Flow Constraints

- 카카오 말풍선: 최대 900자 × 3개 (`kakao.ts:splitText`)
- MCP 클라이언트: 싱글턴 (`mju-tools.ts:client`). 첫 호출 시 subprocess spawn, 이후 재사용. `closeMjuClient()`로 정리 가능하나 현재 shutdown에서 미호출.
- 출석 조회: LMS 과목 ID ≠ UCheck 과목 ID이므로, 과목명(문자열)으로 UCheck 검색. `handleAttendance()`에서 과목 목록 → 순차 출석 조회 체이닝.
- mju-mcp에 전달되는 학번이 현재 하드코딩됨 (`mju-tools.ts:24` — `MJU_USERNAME: "60212158"`). TODO: 유저별 학번 매핑 필요.

## Environment Variables

```
NVIDIA_API_KEY      # NVIDIA 추론 엔드포인트 키
SANDBOX_NAME        # NemoClaw 샌드박스 이름 (default: mjuclaw)
PORT                # 서버 포트 (default: 3000)
SERVER_URL          # 외부 URL (온보딩 버튼 링크용)
ENCRYPTION_KEY      # AES-256 키, hex 64자
ADMIN_KAKAO_ID      # 자동 인증 관리자 카카오 ID
```

## Known Issues

- **학번 하드코딩**: mju-tools.ts에서 MJU_USERNAME이 고정값. 다중 유저 크리덴셜 동적 전달 미구현.
- **Cloudflare Quick Tunnel**: 재시작마다 URL 변경 → SERVER_URL + 오픈빌더 스킬 URL 수동 업데이트 필요.
- **MCP 클라이언트 미정리**: graceful shutdown 시 `closeMjuClient()` 호출 없음.
