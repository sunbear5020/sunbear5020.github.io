"""
FEI · HEL 가상 연구실 — 로컬 백엔드 (FastAPI + SSE)

사무실 데스크탑에서 띄우고, 정적 페이지(office/index.html)의
AI 어댑터에서 "로컬 FastAPI" 모드로 주소를 넣으면 연결됩니다.
Tailscale 사설 주소(100.x.y.z)로 접근하는 것을 전제로 만들었습니다.

실행:
    pip install -r requirements.txt
    uvicorn server:app --host 0.0.0.0 --port 8000

환경변수:
    OPENAI_API_KEY   있으면 실제 LLM으로 계획을 생성 (없으면 내장 시뮬레이터)
    OPENAI_MODEL     기본 gpt-4o-mini
    LAB_TOKEN        있으면 모든 /api 요청에 X-Lab-Token 헤더가 필요
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any, AsyncGenerator

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

APP_VERSION = "0.1.0"
LAB_TOKEN = os.environ.get("LAB_TOKEN", "").strip()
OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini").strip()

app = FastAPI(title="FEI · HEL Virtual Lab", version=APP_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # Tailscale 사설망 전제 — 공개 노출 금지
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


class Command(BaseModel):
    command: str
    speed: float = 1.0


def guard(x_lab_token: str | None = Header(default=None)) -> None:
    if LAB_TOKEN and (x_lab_token or "") != LAB_TOKEN:
        raise HTTPException(status_code=401, detail="invalid lab token")


# ──────────────────────────────────────────────────────────────
# 내장 시뮬레이터 (API 키가 없을 때)
# ──────────────────────────────────────────────────────────────
AGENTS = {
    "cohort": "코호트 분석가 (건보공단 가명결합)",
    "geo": "공간·GIS 분석가 (GIS·GPS·DWG)",
    "env": "미기상·열환경 분석가 (Rhino·Grasshopper·Ladybug)",
    "engine": "숲결 엔진 연구원",
    "dtx": "DTx·생체지표 연구원",
    "budget": "과제비·정산 매니저",
    "writer": "보고서·강의 라이터",
    "kirby": "커비 (블로그·행정 코디네이터)",
}

SIM_PLAYBOOKS = [
    {
        "match": ["회의비", "회의록", "회의"],
        "title": "회의비 정산 — 회의록·지출결의서",
        "tasks": [
            {
                "agent": "budget",
                "title": "회의비 지출결의서 초안",
                "mode": "작성",
                "bubble": "지출결의 작성 중",
                "logs": [
                    "일시·장소·참석자·안건·소요경비 5항목을 맞췄습니다.",
                    "회의비 한도(참석 인원 기준)와 주류 제외 조건을 확인했습니다.",
                    "영수증 3건 대조 — 1건은 승인번호 누락입니다.",
                ],
                "deliverable": {
                    "title": "회의비 지출결의서 (초안)",
                    "type": "초안",
                    "body": "## 지출결의\n- 과목: 연구활동비 — 회의비 (비목 코드 확인)\n- 일자: 2026. 11. 16. / 사용처: ○○식당\n- 내역: 회의 식사 8인 + 다과\n- 금액: ○○,○○○원 (부가세 포함)\n- 증빙: 카드전표 2매 · 현금영수증 1매\n\n## 확인 필요\n- 승인번호 누락 영수증 재발급\n- 참석자 서명 2명 보완",
                },
            },
            {
                "agent": "kirby",
                "title": "참석자·증빙 취합",
                "mode": "조사",
                "bubble": "증빙 확인 중",
                "logs": [
                    "참석자 8명을 연구실 명부와 대조했습니다.",
                    "같은 날 다른 과제 중복 청구 여부 확인 — 없음.",
                ],
                "deliverable": {
                    "title": "회의비 증빙 체크리스트",
                    "type": "체크리스트",
                    "body": "## 증빙\n- [x] 카드전표 2매\n- [ ] 현금영수증 1매 (재발급)\n- [ ] 참석자 서명 2명\n\n## 한도\n- 1인 기준액 × 8인 이내인지 확인",
                },
            },
            {
                "agent": "writer",
                "title": "회의록·보고 문장 정리",
                "mode": "작성",
                "bubble": "회의록 정리 중",
                "logs": ["논의와 결정 사항을 분리했습니다.", "3줄 요약을 만들었습니다."],
                "deliverable": {
                    "title": "회의록 (초안)",
                    "type": "초안",
                    "body": "## 회의록\n- 일시: 2026. 11. 16. 16:00–17:30\n- 장소: 농대2호관 452동 237호\n- 참석: 8명\n- 안건: 코호트 분석 점검 · ISEE 초록 · 4분기 집행\n\n## 결정\n- 초록 초안 11월 4주 / 분석표 11월 3주",
                },
            },
            {
                "agent": "cohort",
                "title": "집행률·잔액 확인",
                "mode": "조사",
                "bubble": "집행률 계산 중",
                "logs": ["과제별 회의비 잔액을 표로 정리했습니다.", "잔액 부족 과제 1건을 표시했습니다."],
                "deliverable": {
                    "title": "회의비 집행 현황",
                    "type": "표",
                    "body": "## 과제별\n- 과제 A: 예산 ○○ / 집행 ○○ / 잔액 ○○\n- 과제 B: 잔액 부족 가능\n\n> 숫자는 예시입니다.",
                },
            },
        ],
    },
    {
        "match": ["인건비", "참여율", "지급명세", "학생인건비"],
        "title": "인건비 참여율·지급명세 점검",
        "tasks": [
            {
                "agent": "budget",
                "title": "참여율·지급명세 점검",
                "mode": "작성",
                "bubble": "참여율 대조 중",
                "logs": [
                    "참여연구원 7명 참여율 합계를 확인했습니다.",
                    "변경신청 필요 2명을 표시했습니다.",
                ],
                "deliverable": {
                    "title": "인건비 점검 체크리스트",
                    "type": "체크리스트",
                    "body": "## 점검\n- 참여율 100% 초과 1명\n- 변경 미신청 2명\n- 지급명세 서명 누락 1건\n\n## 변경신청\n- [ ] 사유서 / [ ] 동의서 / [ ] 적용 월",
                },
            },
            {
                "agent": "cohort",
                "title": "지급액 정합성 검증",
                "mode": "작성",
                "bubble": "지급액 검산 중",
                "logs": ["참여율×단가×개월로 재계산했습니다.", "불일치 2명을 찾았습니다."],
                "deliverable": {
                    "title": "인건비 검증표",
                    "type": "표",
                    "body": "## 결과\n- 일치 5명 / 불일치 2명\n- ① 단가 변경 미반영 ② 참여율 오기\n\n> 실제 명세와 대조 필요",
                },
            },
            {
                "agent": "kirby",
                "title": "참여연구원 명단 대조",
                "mode": "조사",
                "bubble": "명단 대조 중",
                "logs": ["연구실 명부 7명과 과제 명단을 대조했습니다."],
                "deliverable": {
                    "title": "명단 대조표",
                    "type": "표",
                    "body": "## 명단\n- 박사 3명 / 석사 4명\n- 졸업 예정 1명 참여 종료 월 확인",
                },
            },
            {
                "agent": "writer",
                "title": "변경 사유서 작성",
                "mode": "작성",
                "bubble": "사유서 쓰는 중",
                "logs": ["변경 사유서 2건 문장을 작성했습니다."],
                "deliverable": {
                    "title": "참여율 변경 사유서",
                    "type": "초안",
                    "body": "## 사유서\n- 대상: ○○○\n- 변경: 20% → 30%\n- 사유: 본 분석 착수로 업무 증가\n- 적용: 2026. 12. 1.부터",
                },
            },
        ],
    },
    {
        "match": ["숲결", "dtx", "디지털치료제", "엔진", "프로토콜"],
        "title": "숲결 엔진 업그레이드 · DTx 기술연구",
        "tasks": [
            {
                "agent": "engine", "title": "숲결 v2 설계", "mode": "작성", "bubble": "가중치 조정 중",
                "logs": ["4축 고정 가중치의 한계를 정리했습니다.", "목적별 프리셋 3안을 설계했습니다."],
                "deliverable": {
                    "title": "숲결 엔진 업그레이드 설계", "type": "초안",
                    "body": "## v2 설계\n- 기본 가중치 유지 + 목적별 프리셋\n- 접근성 가중 자동 보정\n- 순위 안정성 지표로 상시 점검\n\n## 확인 필요\n- 배포 전 데이터 검증",
                },
            },
            {
                "agent": "dtx", "title": "DTx 프로토콜 설계", "mode": "작성", "bubble": "프로토콜 설계 중",
                "logs": ["8주 세션 구조를 설계했습니다.", "HRV·수면 생체지표 측정 시점을 정했습니다."],
                "deliverable": {
                    "title": "DTx 프로토콜 (초안)", "type": "초안",
                    "body": "## 구조\n- 8주 · 주 3회 · 20분\n\n## 지표\n- HRV · 수면효율 · PSS\n\n## 절차\n- IRB 심의, 동의",
                },
            },
            {
                "agent": "env", "title": "열환경·미기상 지표 검증", "mode": "조사", "bubble": "Ladybug 검증 중",
                "logs": ["Ladybug UTCI 계산값을 실측과 비교했습니다.", "EPW 갱신 주기를 확인했습니다."],
                "deliverable": {
                    "title": "열환경 지표 검증", "type": "요약",
                    "body": "## 결과\n- UTCI 오차 ±1.5℃ 이내\n- 바람길은 EPW 갱신 필요",
                },
            },
            {
                "agent": "geo", "title": "GIS·도면 데이터 요건", "mode": "조사", "bubble": "도면 확인 중",
                "logs": ["DWG 기준점·축척을 대조했습니다.", "좌표계를 EPSG:5179로 정리했습니다."],
                "deliverable": {
                    "title": "도면·공간 데이터 요건", "type": "체크리스트",
                    "body": "## 도면\n- [ ] DWG 단위·좌표계\n- [ ] 기준점 일치\n\n## 공간\n- [ ] 격자 500m 집계",
                },
            },
            {
                "agent": "writer", "title": "기술연구 보고서", "mode": "작성", "bubble": "보고서 쓰는 중",
                "logs": ["연구 질문–설계–검증 순으로 정리했습니다.", "논문·특허 분리 지점을 표시했습니다."],
                "deliverable": {
                    "title": "기술연구 보고서 (초안)", "type": "초안",
                    "body": "## 목표\n- 개인 조건 반영 추천 + DTx 결합\n\n## 검증\n- 순위 안정성 → 사용성 → 파일럿",
                },
            },
        ],
    },
    {
        "match": ["코호트", "가명결합", "데이터 분석", "분석 리포트"],
        "title": "코호트 데이터 분석 · 보고서",
        "tasks": [
            {
                "agent": "cohort", "title": "전처리·주 분석", "mode": "작성", "bubble": "코호트 결합 중",
                "logs": ["결합키 정합성 확인 — 불일치 0.4% 제외.", "민감도 12조합 실행, 요약표 6개 생성."],
                "deliverable": {
                    "title": "코호트 분석 요약", "type": "요약",
                    "body": "## 자료\n- 청구+기상+임상도 결합\n\n## 결과\n- 노출 상위군에서 위험 낮음(CI 확인 필요)\n\n> 예시 수치",
                },
            },
            {
                "agent": "geo", "title": "GIS 지표 산출", "mode": "작성", "bubble": "GIS 결합 중",
                "logs": ["QGIS에서 500m 격자로 결합했습니다.", "접근성 3단계를 산출했습니다."],
                "deliverable": {
                    "title": "공간 지표표", "type": "표",
                    "body": "## 지표\n- 녹지율 · 임상도 등급\n- 접근성 15/30/45분\n\n> 예시",
                },
            },
            {
                "agent": "env", "title": "열환경·기상 결합", "mode": "작성", "bubble": "열환경 계산 중",
                "logs": ["Ladybug으로 후보지 UTCI를 계산했습니다."],
                "deliverable": {
                    "title": "환경 지표 요약", "type": "요약",
                    "body": "## 기상\n- 기온·습도·풍속\n## 열환경\n- UTCI 격자",
                },
            },
            {
                "agent": "writer", "title": "분석 보고서", "mode": "작성", "bubble": "리포트 쓰는 중",
                "logs": ["요약–방법–결과–해석–한계 구조로 정리했습니다."],
                "deliverable": {
                    "title": "분석 보고서 (초안)", "type": "초안",
                    "body": "## 요약\n- 노출 상위군 위험 감소\n\n## 한계\n- 청구 기반 결과 정의",
                },
            },
        ],
    },
]

GENERIC = {
    "title": "지시 분해 · 실행 계획",
    "tasks": [
        {
            "agent": "kirby", "title": "요구사항·자료 확인", "mode": "조사", "bubble": "자료 확인 중",
            "logs": ["관련 자료·규정 위치를 확인했습니다.", "확인 필요 항목 3개를 뽑았습니다."],
            "deliverable": {
                "title": "요구사항 정리", "type": "요약",
                "body": "## 확인한 것\n- 관련 문서·규정\n\n## 확인 필요\n- 담당 부서·마감·예산",
            },
        },
        {
            "agent": "budget", "title": "비용·일정 산출", "mode": "작성", "bubble": "비용 계산 중",
            "logs": ["비용 항목과 비목 후보를 정리했습니다."],
            "deliverable": {
                "title": "비용·일정 메모", "type": "표",
                "body": "## 비용\n- 항목 1: ○○만원\n\n> 금액은 예시입니다.",
            },
        },
        {
            "agent": "writer", "title": "보고용 초안", "mode": "작성", "bubble": "초안 쓰는 중",
            "logs": ["결론–근거–다음 단계로 초안을 잡았습니다."],
            "deliverable": {
                "title": "보고용 초안", "type": "초안",
                "body": "## 결론\n- 요청 건 처리 방향 정리\n\n## 다음 단계\n- 확인 항목 보완",
            },
        },
        {
            "agent": "cohort", "title": "수치 검토", "mode": "작성", "bubble": "데이터 확인 중",
            "logs": ["지표의 기준연도와 단위를 맞췄습니다."],
            "deliverable": {
                "title": "수치 검토 메모", "type": "요약",
                "body": "## 지표\n- 기준연도 확인 필요\n- 시군구 단위 집계",
            },
        },
    ],
}


def sim_plan(command: str) -> dict[str, Any]:
    low = (command or "").lower()
    picked = next((p for p in SIM_PLAYBOOKS if any(k in low for k in p["match"])), GENERIC)
    tasks = []
    for i, t in enumerate(picked["tasks"]):
        item = dict(t)
        item["id"] = f"t{i + 1}"
        item["eta"] = 12
        tasks.append(item)
    return {"title": picked["title"], "tasks": tasks}


# ──────────────────────────────────────────────────────────────
# LLM 계획 (OPENAI_API_KEY 가 있을 때)
# ──────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """너는 경상국립대 FEI · HEL 인간환경연구실(교수 김건우)의 가상 연구실 오케스트레이터다.
교수 지시를 8명의 직원에게 나눠 배정한다: cohort(코호트 분석), geo(공간·GIS·DWG), env(미기상·열환경 Rhino/Grasshopper/Ladybug), engine(숲결 엔진), dtx(DTx·생체지표), budget(과제비·정산), writer(보고서·강의자료), kirby(블로그·행정).
결과물은 실제 결재·제출에 쓸 수 있는 수준으로 쓰고, 모르는 금액·규정·날짜는 "확인 필요"/"○○"로 둔다.
출력은 JSON 하나만: {"title":"...","tasks":[{"agent":"budget","title":"...","mode":"작성","bubble":"12자 이내","logs":["..."],"deliverable":{"title":"...","type":"초안","body":"## 소제목\\n- 항목"}}]}
mode는 "조사"|"작성", type은 "초안"|"체크리스트"|"요약"|"표", 태스크 3~5개, 직원당 1개."""


async def llm_plan(command: str) -> dict[str, Any]:
    if not OPENAI_KEY:
        return sim_plan(command)
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_KEY}"},
            json={
                "model": OPENAI_MODEL,
                "temperature": 0.4,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f'교수 지시: "{command}"'},
                ],
            },
        )
        if r.status_code >= 400:
            return sim_plan(command)
        text = r.json()["choices"][0]["message"]["content"]
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return sim_plan(command)


# ──────────────────────────────────────────────────────────────
# 엔드포인트
# ──────────────────────────────────────────────────────────────
@app.get("/api/health")
async def health(_: None = Depends(guard)) -> dict[str, Any]:
    return {
        "ok": True,
        "app": "FEI · HEL Virtual Lab",
        "version": APP_VERSION,
        "engine": "openai:" + OPENAI_MODEL if OPENAI_KEY else "simulator",
        "time": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }


@app.post("/api/plan")
async def plan(body: Command, _: None = Depends(guard)) -> dict[str, Any]:
    if not body.command.strip():
        raise HTTPException(status_code=400, detail="empty command")
    return {"plan": await llm_plan(body.command)}


def sse(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


@app.post("/api/stream")
async def stream(body: Command, _: None = Depends(guard)) -> StreamingResponse:
    command = body.command.strip()
    if not command:
        raise HTTPException(status_code=400, detail="empty command")
    speed = max(0.25, min(8.0, float(body.speed or 1.0)))

    async def gen() -> AsyncGenerator[str, None]:
        yield sse("status", {"message": f"지시 접수 — {command}"})
        plan_obj = await llm_plan(command)
        tasks = plan_obj.get("tasks", [])
        yield sse("plan", {"title": plan_obj.get("title", "실행 계획"), "tasks": tasks})
        await asyncio.sleep(0.4 / speed)

        for t in tasks:
            aid = t.get("agent", "kirby")
            yield sse("task", {
                "agent": aid,
                "state": "write" if t.get("mode") == "작성" else "research",
                "bubble": t.get("bubble", "작업 중"),
                "task": t.get("title", ""),
                "progress": 0.15,
                "spot": "desk",
            })
            for i, line in enumerate(t.get("logs", [])[:5]):
                await asyncio.sleep(1.1 / speed)
                yield sse("log", {"agent": aid, "text": line})
                yield sse("task", {"agent": aid, "progress": 0.2 + 0.5 * (i + 1) / max(1, len(t.get("logs", [])))})
            await asyncio.sleep(0.4 / speed)
            yield sse("task", {"agent": aid, "progress": 0.9})

        # 협업
        yield sse("status", {"message": "중앙 협업 테이블 — 교차 검토"})
        for t in tasks:
            yield sse("task", {"agent": t.get("agent"), "state": "meet", "bubble": "교차 검토", "spot": "table", "progress": 0.9})
        await asyncio.sleep(1.6 / speed)

        for t in tasks:
            aid = t.get("agent", "kirby")
            yield sse("task", {"agent": aid, "state": "waiting", "bubble": "보고 · 승인 대기", "spot": "pi", "progress": 1})
            await asyncio.sleep(0.9 / speed)
            d = t.get("deliverable", {})
            yield sse("result", {
                "id": t.get("id", ""),
                "agent": aid,
                "title": d.get("title", t.get("title", "결과물")),
                "type": d.get("type", "초안"),
                "body": d.get("body", ""),
            })
            yield sse("log", {"agent": aid, "text": f"결과물 전달 — {d.get('title', '')}"})

        yield sse("done", {"taskCount": len(tasks)})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/")
async def root() -> JSONResponse:
    return JSONResponse({
        "app": "FEI · HEL Virtual Lab backend",
        "endpoints": ["/api/health", "/api/plan", "/api/stream"],
        "engine": "openai" if OPENAI_KEY else "simulator",
    })


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), reload=False)
