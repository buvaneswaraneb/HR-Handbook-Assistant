"""
main.py — FastAPI entry point.

Run with:
    uvicorn app.api.main:app --reload

Endpoints
---------
GET  /ingest/status       Vector store statistics (Supabase)
POST /upload              Upload PDF, insert to Supabase, and queue ingestion
GET  /files/{file_id}/download Download PDF from Supabase
DELETE /files/{file_id}   Delete PDF and chunks from Supabase
GET  /health              Health check
"""

from __future__ import annotations

import importlib.util
import hashlib
import logging
import os
import sys
import uuid
import re
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, Header, HTTPException, UploadFile, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client, Client

# Load the repo-root .env file so local and hosted runs share one source.
ROOT_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"
load_dotenv(ROOT_ENV_FILE)

# ── ensure 'backend/' is on the path when running from repo root ──────────────
_backend_dir = Path(__file__).resolve().parents[2]   # .../backend
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

# ── internal imports ──────────────────────────────────────────────────────────
from app.api.auth_context import get_workplace_id
from app.api.routes import employees, projects, teams, activity, analytics, files, leave, auth, calendar, supabase_auth, google_calendar, workspace_ai

_file_fetch_path = (
    Path(__file__).resolve().parents[1]            # .../app
    / "services" / "upload-downloader" / "file_fetch.py"
)
_spec   = importlib.util.spec_from_file_location("file_fetch", _file_fetch_path)
_module = importlib.util.module_from_spec(_spec)   # type: ignore[arg-type]
_spec.loader.exec_module(_module)                  # type: ignore[union-attr]
file_router = _module.file_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

# ── Supabase Setup ────────────────────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
BUCKET_NAME = os.getenv("SUPABASE_STORAGE_BUCKET", "pdf-uploads")

def get_supabase() -> Client:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail="Supabase credentials missing in environment")
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


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


class StoreStatus(BaseModel):
    files_count:  int
    chunks_count: int


def _safe_filename(filename: str) -> str:
    stem = re.sub(r"[^a-zA-Z0-9_.-]+", "-", Path(filename).name).strip(".-")
    return stem or "upload.pdf"


# ── upload → Supabase Storage & Job Queue ─────────────────────────────────────
@app.post("/upload", status_code=201)
async def upload_file(
    file: UploadFile = File(...),
    authorization: str | None = Header(None),
):
    """
    Save the uploaded PDF to Supabase Storage, create a file registry row,
    and insert an ingestion job for the chunker-service to process.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    workplace_id = get_workplace_id(authorization) or "default"
    original_filename = os.path.basename(file.filename)
    
    mime = (file.content_type or "").lower()
    if mime != "application/pdf" and not original_filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF uploads are supported for RAG ingestion")

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    file_id = str(uuid.uuid4())
    safe_name = _safe_filename(original_filename)
    source_name = f"{file_id}-{safe_name}"
    doc_hash = hashlib.sha256(contents).hexdigest()
    storage_path = f"{workplace_id}/{file_id}/{source_name}"

    supabase = get_supabase()

    try:
        supabase.storage.from_(BUCKET_NAME).upload(
            path=storage_path,
            file=contents,
            file_options={"content-type": "application/pdf"}
        )
    except Exception as e:
        logger.exception("Supabase storage upload failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to upload to storage: {e}")

    try:
        supabase.table("files").insert({
            "file_id": file_id,
            "workspace_id": workplace_id,
            "source_name": source_name,
            "original_filename": original_filename,
            "doc_hash": doc_hash,
            "status": "processing",
            "storage_path": storage_path,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }).execute()

        job_id = str(uuid.uuid4())
        supabase.table("ingestion_jobs").insert({
            "job_id": job_id,
            "file_id": file_id,
            "workspace_id": workplace_id,
            "source_name": source_name,
            "doc_hash": doc_hash,
            "storage_path": storage_path,
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }).execute()
    except Exception as e:
        logger.exception("Supabase DB insert failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to register job in database: {e}")

    return {
        "file_id": file_id,
        "status": "processing",
        "message": "File uploaded to Supabase and ingestion job queued.",
        "filename": original_filename
    }


@app.get("/ingest/status", response_model=StoreStatus)
async def store_status(authorization: str | None = Header(None)):
    """Return current vector store statistics from Supabase."""
    workplace_id = get_workplace_id(authorization) or "default"
    supabase = get_supabase()
    
    files_res = supabase.table("files").select("*", count="exact").eq("workspace_id", workplace_id).execute()
    chunks_res = supabase.table("chunks").select("*", count="exact").eq("workspace_id", workplace_id).execute()
    
    return StoreStatus(
        files_count=files_res.count if files_res.count else 0,
        chunks_count=chunks_res.count if chunks_res.count else 0,
    )


@app.get("/files/{file_id}/download")
def download_rag_file(file_id: str, authorization: str | None = Header(None)):
    workplace_id = get_workplace_id(authorization) or "default"
    supabase = get_supabase()
    
    res = supabase.table("files").select("*").eq("file_id", file_id).eq("workspace_id", workplace_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="File not found")
    
    file_record = res.data[0]
    storage_path = file_record["storage_path"]
    
    try:
        file_bytes = supabase.storage.from_(BUCKET_NAME).download(storage_path)
    except Exception:
        raise HTTPException(status_code=404, detail="Stored file is missing in storage")

    return Response(content=file_bytes, media_type="application/pdf", headers={
        "Content-Disposition": f"attachment; filename=\"{file_record['original_filename']}\""
    })


@app.delete("/files/{file_id}", status_code=204)
def delete_rag_file(file_id: str, authorization: str | None = Header(None)):
    workplace_id = get_workplace_id(authorization) or "default"
    supabase = get_supabase()
    
    res = supabase.table("files").select("*").eq("file_id", file_id).eq("workspace_id", workplace_id).execute()
    if not res.data:
        return None
    
    file_record = res.data[0]
    source_name = file_record["source_name"]
    storage_path = file_record["storage_path"]

    # Delete chunks
    supabase.table("chunks").delete().eq("source_name", source_name).eq("workspace_id", workplace_id).execute()

    # Delete from storage
    try:
        supabase.storage.from_(BUCKET_NAME).remove([storage_path])
    except Exception:
        pass
        
    # Delete file row
    supabase.table("files").delete().eq("file_id", file_id).eq("workspace_id", workplace_id).execute()
    
    return None


# ── health ────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/")
def greetings():
    return "hello welcome to PRJ006"


app.include_router(file_router)
