# FEI · HEL 가상 연구실 — Virtual Lab Office

경상국립대학교 환경산림과학부 산림환경자원학과 인간환경연구실(FEI · HEL)의 1차 프로토타입.
**452동 237호 2D 평면도** 위에서 4명의 AI 연구원이 교수님 지시를 나눠 받고, 조사·작성·협업·보고를 거쳐
결과물을 올리면 교수님이 **[승인]** 또는 **[수정 요청]**을 누르는 구조입니다.

- 라이브: <https://sunbear5020.github.io/office/>
- 정적 앱(빌드 없음) + 선택적 로컬 백엔드(FastAPI + SSE)

---

## 1. 무엇이 동작하나

| 영역 | 내용 |
| --- | --- |
| 평면도 | HTML5 Canvas, 60fps, 반응형(데스크톱 1440 / 모바일 390). PI 라운지·중앙 협업 테이블·화이트보드·커피존·워크스테이션 4개 |
| 연구원 | 과제비·정산 매니저 / 데이터 분석가 / 보고서·논문 라이터 / 문헌·행정 코디네이터 |
| 이동 | 책상 → 협업 테이블 → 교수님 데스크 → 복귀. 상태(대기·조사·작성·협업·승인 대기)에 따라 말풍선·진행 링·색이 바뀜 |
| 지시 | 입력창 + 원클릭 시나리오 칩(회의비·분석비·인건비·코호트 분석·연차보고서·ISEE·블로그) |
| 실행 | 오케스트레이터가 태스크 분해 → 병렬 배정 → 실시간 로그 → 교차 검토 → 결과물 카드 |
| 승인 | 카드별 **[승인]** / **[수정 요청]**(피드백 → v2 초안) · **복사** · **다운로드(.md)** |
| 어댑터 | 내장 시뮬레이터(기본) / OpenAI / Anthropic / Gemini / 로컬 FastAPI + SSE |

## 2. 파일 구조

```
office/
  index.html              화면
  assets/office.css       스타일 (크림·샌드·차콜·테라코타·세이지)
  assets/data.js          연구원 정의 · 시나리오 · 플레이북(결과물 템플릿)
  assets/scene.js         Canvas 평면도 · 캐릭터 이동/말풍선
  assets/adapter.js       AI 어댑터 (시뮬레이터 · LLM 스트리밍 · 로컬 SSE)
  assets/app.js           오케스트레이터 · UI · 승인 흐름
  backend/server.py       로컬 FastAPI + SSE 서버
  backend/requirements.txt
```

## 3. 시나리오와 산출물

기본 플레이북은 교수님이 가장 시간을 쓰는 **과제비 처리**를 1순위로 두었습니다.

| 시나리오 | 담당 | 결과물 |
| --- | --- | --- |
| 회의비 정산 | 정산 매니저 · 행정 · 라이터 · 분석가 | 회의록 + 지출결의서 초안, 증빙·한도 체크리스트, 집행률 표 |
| 분석비 의뢰 | 정산 매니저 · 분석가 · 행정 · 라이터 | 분석 의뢰서 + 견적 비교 + 지출결의, 분석 범위 정의서, 계약 체크리스트 |
| 인건비 점검 | 정산 매니저 · 행정 · 분석가 · 라이터 | 인건비 점검·변경신청 체크리스트, 정합성 검증표, 사유서 초안 |
| 숲결 코호트 분석 | 분석가 · 라이터 · 행정 · 정산 | 분석 요약, 리포트 초안, 가명정보·IRB 체크리스트 |
| 연차보고서 | 라이터 · 분석가 · 정산 · 행정 | 보고서 목차·본문, 실적표, 집행실적표 |
| ISEE 학회 | 행정 · 라이터 · 분석가 · 정산 | 일정·출장 체크리스트, 영문 초록, 수치 요약, 출장비 계획 |

플레이북에 없는 지시는 키워드에 맞춰 범용 4태스크로 분해됩니다.
**모든 카드의 금액·규정 조항·날짜는 예시 자리표시자(○○)** 이며, 카드 안에 `확인 필요`로 표시됩니다.

## 4. AI 어댑터

상단 **[⚙ AI 어댑터]** → 모드 선택.

- **시뮬레이터**(기본): API 키 없이 동작. 결정론적 예시 초안.
- **OpenAI**: `chat/completions` + `stream:true` 로 실시간 수신.
- **Anthropic**: `messages` + `stream:true`, `anthropic-dangerous-direct-browser-access: true` 헤더 사용.
- **Gemini**: `streamGenerateContent?alt=sse`.
- **로컬 FastAPI**: 서버가 `/api/stream`(SSE)을 제공하면 오케스트레이션까지 서버가 수행하고,
  없으면 `/api/plan`으로 계획만 받아 브라우저가 타임라인을 재생합니다.

키는 `localStorage`(`feihel.adapter.v1`)에만 저장되고 화면·로그에 출력되지 않습니다.
연결 실패 시 **자동으로 시뮬레이터로 폴백**하고 타임라인에 경고를 남깁니다.

## 5. 로컬 백엔드 (사무실 데스크탑 + Tailscale)

```bash
cd office/backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 선택: 실제 LLM 사용
export OPENAI_API_KEY=sk-...
export LAB_TOKEN=우리연구실토큰

uvicorn server:app --host 0.0.0.0 --port 8000
```

- 상태 확인: `GET /api/health` → `{"ok": true, "engine": "simulator"}`
- 계획: `POST /api/plan` `{"command": "..."}`
- 실행 스트림: `POST /api/stream` `{"command": "..."}` → `event: plan|task|log|result|done`

Tailscale로만 접근:

```bash
tailscale serve --bg 8000        # 또는 tailscale ip -4 로 100.x 주소 확인
```

페이지의 어댑터에서 `http://100.x.y.z:8000` + 토큰을 넣고 **[연결 테스트]** → **[저장]**.

> 보안: 이 서버는 인증이 `LAB_TOKEN` 하나뿐입니다. **공인 인터넷에 노출하지 말고** Tailscale 사설망 안에서만 쓰세요.
> 브라우저에 API 키를 두는 방식은 데모·개인용 전제이며, 공용 PC에서는 쓰지 않는 것이 좋습니다.

## 6. 확장 지점

- `data.js`의 `PLAYBOOKS`에 연구실 실제 서식(지출결의서 양식, 회의록 양식)을 넣으면 카드가 그대로 결재 문서가 됩니다.
- `addResult()` 뒤에 hwp/Google Docs 업로드 어댑터를 붙이면 초안이 문서로 저장됩니다.
- 승인 결과를 캘린더·메일과 연결하면 "승인 → 발송 → 마감 추적"까지 이어집니다.
- 로컬 서버의 `SIM_PLAYBOOKS`를 실제 연구비 관리 시스템 조회로 바꾸면 잔액·한도가 실시간 값이 됩니다.

---

© FEI · HEL, 경상국립대학교 환경산림과학부 산림환경자원학과 인간환경연구실
경남 진주시 진주대로 501 농대2호관 452동 237호 · bkim5020@gnu.ac.kr
