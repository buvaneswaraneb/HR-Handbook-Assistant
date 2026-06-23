"""
main.py — FastAPI entry point.

Run with:
    uvicorn app.api.main:app --reload

Endpoints
---------
GET  /health              Health check

[RAG service offline]
The upload, ingest, and file-download endpoints have been temporarily
removed. The RAG service (PDF ingestion, vector search) is currently
out of service. Source files are preserved in /backend_osmium.
"""

from __future__ import annotations

import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load the repo-root .env file so local and hosted runs share one source.
ROOT_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"
load_dotenv(ROOT_ENV_FILE)

# ── ensure 'backend/' is on the path when running from repo root ──────────────
_backend_dir = Path(__file__).resolve().parents[2]   # .../backend
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

# ── internal imports ──────────────────────────────────────────────────────────
from app.api.routes import employees, projects, teams, activity, analytics, files, leave, auth, calendar, supabase_auth, google_calendar, workspace_ai

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


# ── app ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="HR API",
    description="Main HR backend with RAG Supabase upload functionality",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routes
app.include_router(supabase_auth.router)
app.include_router(auth.router)
app.include_router(calendar.router)
app.include_router(google_calendar.router)
app.include_router(employees.router)
app.include_router(projects.router)
app.include_router(teams.router)
app.include_router(activity.router)
app.include_router(analytics.router)
app.include_router(files.router)
app.include_router(leave.router)
app.include_router(workspace_ai.router)







# ── health ────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/")
def greetings():
    return "hello welcome to PRJ006"

