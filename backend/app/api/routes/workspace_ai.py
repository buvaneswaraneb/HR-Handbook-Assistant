from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.api.auth_context import get_workplace_id

router = APIRouter(prefix="/workspace-ai", tags=["Workspace AI"])

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_MODEL = "llama-3.1-8b-instant"
MAX_CONTEXT_CHARS = 28000


class MiniAIMessage(BaseModel):
    role: str
    content: str = ""


class MiniAIContext(BaseModel):
    page: str = ""
    cached_at: str | None = None
    summary: dict[str, Any] = Field(default_factory=dict)
    analytics: dict[str, Any] = Field(default_factory=dict)
    employees: list[dict[str, Any]] = Field(default_factory=list)
    projects: list[dict[str, Any]] = Field(default_factory=list)
    leave: list[dict[str, Any]] = Field(default_factory=list)
    activity: list[dict[str, Any]] = Field(default_factory=list)


class MiniAIRequest(BaseModel):
    question: str
    context: MiniAIContext
    history: list[MiniAIMessage] = Field(default_factory=list)


class MiniAIResponse(BaseModel):
    answer: str


def _env_value(name: str) -> str:
    value = os.getenv(name)
    if value:
        return value

    env_file = Path(__file__).resolve().parents[2] / "services" / ".env"
    try:
        for line in env_file.read_text(encoding="utf-8").splitlines():
            raw = line.strip()
            if not raw or raw.startswith("#") or "=" not in raw:
                continue
            key, val = raw.split("=", 1)
            if key.strip() == name:
                return val.strip().strip('"').strip("'")
    except OSError:
        pass
    return ""


def _context_json(context: MiniAIContext) -> str:
    raw = json.dumps(context.model_dump(), ensure_ascii=False, default=str)
    if len(raw) <= MAX_CONTEXT_CHARS:
        return raw
    return raw[:MAX_CONTEXT_CHARS] + "\n...[context truncated]"


@router.post("/ask", response_model=MiniAIResponse)
def ask_workspace_ai(body: MiniAIRequest, authorization: Optional[str] = Header(None)):
    get_workplace_id(authorization)

    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question is required")

    api_key = _env_value("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY is not configured")

    history = [
        {
            "role": "assistant" if item.role in {"assistant", "bot"} else "user",
            "content": item.content[:1200],
        }
        for item in body.history[-8:]
        if item.content
    ]

    messages = [
        {
            "role": "system",
            "content": (
                "You are Osmium Mini AI, a compact HR workspace assistant. "
                "Answer only from the provided workspace context. Focus on employees, projects, "
                "dashboard metrics, deadlines, leave, assignments, roles, skills, availability, "
                "absences, and recent activity. Prefer context.summary for dashboard totals, "
                "available employees, busy employees, absent-today lists, upcoming absences, "
                "critical projects, and overdue projects. Treat 'absentees' as employees whose "
                "leave record includes the summary as_of date. If the question is outside that scope, briefly say you can "
                "help with employees, projects, and dashboard context. Keep answers concise and actionable."
            ),
        },
        *history,
        {
            "role": "user",
            "content": (
                f"Current page: {body.context.page or 'unknown'}\n"
                f"Workspace context JSON:\n{_context_json(body.context)}\n\n"
                f"Question: {question}"
            ),
        },
    ]

    try:
        with httpx.Client(timeout=25) as client:
            response = client.post(
                GROQ_API_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": _env_value("GROQ_MODEL") or DEFAULT_MODEL,
                    "temperature": 0.2,
                    "max_tokens": 500,
                    "messages": messages,
                },
            )
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:300] if exc.response is not None else str(exc)
        raise HTTPException(status_code=502, detail=f"Workspace AI request failed: {detail}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Workspace AI request failed: {exc}") from exc

    answer = (
        data.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
        .strip()
    )
    if not answer:
        raise HTTPException(status_code=502, detail="Workspace AI returned an empty answer")
    return MiniAIResponse(answer=answer)
