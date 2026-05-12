"""
main.py — FastAPI entry point.

Run with:
    uvicorn app.api.main:app --reload

Endpoints
---------
POST /ingest              Ingest all PDFs in data/raw-docs-cache/
GET  /ingest/status       Vector store statistics
POST /query               Ask a question against ingested documents
POST /upload              Upload, ingest, then store metadata in Cloudinary
GET  /download/{filename} Download a file from the cache directory
GET  /files               List Cloudinary-backed file records
GET  /health              Health check
"""

from __future__ import annotations

import importlib.util
import hashlib
import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

# Load the repo-root .env file so local and hosted runs share one source.
ROOT_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"
load_dotenv(ROOT_ENV_FILE)









# ── ensure 'backend/' is on the path when running from repo root ──────────────
# (uvicorn app.api.main:app already handles this via PYTHONPATH / -m; this
#  guard is a safety net for direct `python -m app.api.main` invocations)
_backend_dir = Path(__file__).resolve().parents[2]   # .../backend
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

# ── internal imports (all via full app.* path) ────────────────────────────────
from app.services.ingestion import IngestionResult, run_ingestion          # noqa: E402
from app.services.ingestion.loader import CACHE_DIR                        # noqa: E402
from app.services.ingestion.vector_store import VectorStore                # noqa: E402
from app.services.e_r_s import file_service as file_svc                    # noqa: E402
from app.services.e_r_s.db import get_db                                   # noqa: E402
from app.services.e_r_s.repositories.file_repo import FileRepository       # noqa: E402
from app.services.rag import RAGQueryEngine                                # noqa: E402
from app.api.auth_context import get_workplace_id                          # noqa: E402

from app.api.routes import employees, projects, teams, activity, analytics, files, leave, auth, calendar, supabase_auth, google_calendar, workspace_ai  # noqa: E402

# upload-downloader has a hyphen in its directory name, which is not a valid
# Python identifier, so we load it dynamically via importlib.
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

# ── shared singletons (loaded once at startup, reused every request) ──────────
_store:   VectorStore    | None = None
_engine:  RAGQueryEngine | None = None
_running: bool = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _store, _engine
    _store  = VectorStore()                        # loads existing FAISS index
    app.state.vector_store = _store
    _engine = RAGQueryEngine(store=_store)         # caches embedding model
    logger.info("VectorStore loaded — %d vectors", _store.total_vectors)
    yield
    # (shutdown hook — nothing to clean up for FAISS/sentence-transformers)


# ── app ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="HR RAG API",
    description="Document ingestion + LLM-powered Q&A over company PDFs",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register Supabase authentication routes and email/password auth routes
app.include_router(supabase_auth.router)
app.include_router(auth.router)

# Register calendar routes
app.include_router(calendar.router)
app.include_router(google_calendar.router)

# Register ERS routes
app.include_router(employees.router)
app.include_router(projects.router)
app.include_router(teams.router)
app.include_router(activity.router)
app.include_router(analytics.router)
app.include_router(files.router)
app.include_router(leave.router)
app.include_router(workspace_ai.router)


# ── request / response models ─────────────────────────────────────────────────
class IngestResponse(BaseModel):
    status:     str
    processed:  list[str]
    skipped:    list[str]
    failed:     list[str]
    duration_s: float


class StoreStatus(BaseModel):
    total_vectors:  int
    docs_processed: int


class ChatHistoryItem(BaseModel):
    role: str
    content: str = ""
    attachment_name: str | None = None
    file_names: list[str] = Field(default_factory=list)


class QueryRequest(BaseModel):
    question: str
    file_ids: list[str] = Field(default_factory=list)
    history: list[ChatHistoryItem] = Field(default_factory=list)


class SourceItem(BaseModel):
    file:     str = "unknown"
    page:     int = 0
    chunk_id: str = ""

    @field_validator("page", mode="before")
    @classmethod
    def default_missing_page(cls, value):
        if value in (None, ""):
            return 0
        try:
            return int(value)
        except (TypeError, ValueError):
            return 0


class PreviewItem(BaseModel):
    text: str = ""
    file: str = "unknown"
    page: int = 0

    @field_validator("page", mode="before")
    @classmethod
    def default_missing_page(cls, value):
        if value in (None, ""):
            return 0
        try:
            return int(value)
        except (TypeError, ValueError):
            return 0


class QueryResponse(BaseModel):
    answer:          str
    sources:         list[SourceItem]
    context_preview: list[PreviewItem]


def _safe_source_items(items: object) -> list[SourceItem]:
    safe_items = []
    for item in items if isinstance(items, list) else []:
        if isinstance(item, dict):
            safe_items.append(SourceItem(**item))
    return safe_items


def _safe_preview_items(items: object) -> list[PreviewItem]:
    safe_items = []
    for item in items if isinstance(items, list) else []:
        if isinstance(item, dict):
            safe_items.append(PreviewItem(**item))
    return safe_items


def _resolve_file_sources(file_ids: list[str], workplace_id: str | None) -> list[str]:
    """Map selected UI file IDs to vector-store source filenames."""
    if not file_ids:
        return []

    repo = FileRepository(get_db())
    filenames: list[str] = []
    for file_id in dict.fromkeys(file_ids):
        record = repo.get_by_id(str(file_id), workplace_id)
        filename = (record or {}).get("filename")
        if filename and filename not in filenames:
            filenames.append(filename)
    return filenames


def _run_ingestion_job(
    cache_dir: Path = CACHE_DIR,
    workplace_id: str | None = None,
) -> IngestionResult:
    """
    Run ingestion against the live VectorStore used by the query engine.
    This keeps newly uploaded documents queryable without restarting the API.
    """
    global _running

    if _store is None:
        raise HTTPException(status_code=503, detail="Store not initialised")
    if _running:
        raise HTTPException(status_code=409, detail="Ingestion already in progress")

    _running = True
    try:
        return run_ingestion(cache_dir=cache_dir, store=_store, workplace_id=workplace_id)
    finally:
        _running = False


def _ingestion_response(result: IngestionResult, started_at: float) -> IngestResponse:
    return IngestResponse(
        status="ok" if not result.failed else "partial",
        processed=result.processed,
        skipped=result.skipped,
        failed=result.failed,
        duration_s=round(time.perf_counter() - started_at, 2),
    )


def _ensure_upload_was_ingested(filename: str, ingestion: IngestionResult) -> None:
    if filename in ingestion.failed:
        raise HTTPException(
            status_code=500,
            detail=f"Upload saved to cache, but ingestion failed for {filename}. Cloudinary upload was skipped.",
        )

    if filename not in ingestion.processed and filename not in ingestion.skipped:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Upload saved to cache, but {filename} was not digested. "
                "Only readable PDF files are uploaded to Cloudinary after ingestion succeeds."
            ),
        )


def _file_hash(contents: bytes) -> str:
    return hashlib.sha256(contents).hexdigest()


# ── upload → ingest → Cloudinary ──────────────────────────────────────────────
@app.post("/upload", status_code=201)
async def upload_file(
    file: UploadFile = File(...),
    project_id: str | None = Form(None),
    department: str | None = Form(None),
    uploaded_by: str | None = Form(None),
    description: str | None = Form(None),
    authorization: str | None = Header(None),
):
    """
    Save the uploaded file to the local RAG cache, ingest the cache, then upload
    the original bytes to Cloudinary and record the metadata.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    workplace_id = get_workplace_id(authorization)
    filename = os.path.basename(file.filename)
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    upload_cache_dir = CACHE_DIR / (workplace_id or "anonymous")
    upload_cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = upload_cache_dir / filename
    cache_path.write_bytes(contents)

    if _store is not None:
        _store.delete_by_doc_hash(_file_hash(contents), workplace_id=workplace_id)

    t0 = time.perf_counter()
    ingestion = _run_ingestion_job(cache_dir=upload_cache_dir, workplace_id=workplace_id)
    _ensure_upload_was_ingested(filename, ingestion)

    try:
        cloudinary_file = file_svc.upload_file_bytes(
            contents=contents,
            filename=filename,
            content_type=file.content_type,
            project_id=project_id,
            department=department,
            uploaded_by=uploaded_by,
            description=description,
            workplace_id=workplace_id,
        )
    except Exception as exc:
        logger.exception("Cloudinary upload failed for %s: %s", filename, exc)
        raise HTTPException(status_code=500, detail=f"Cloudinary upload failed: {exc}")

    cache_deleted = False
    try:
        cache_path.unlink(missing_ok=True)
        cache_deleted = True
    except OSError as exc:
        logger.warning("Uploaded file reached Cloudinary but cache cleanup failed for %s: %s", cache_path, exc)

    ingestion_payload = _ingestion_response(ingestion, t0).model_dump()
    return {
        **cloudinary_file,
        "message": "Uploaded, ingested, stored in Cloudinary, and removed from raw-docs-cache",
        "filename": filename,
        "cache_deleted": cache_deleted,
        "ingestion": ingestion_payload,
    }


# ── ingestion endpoints ───────────────────────────────────────────────────────
@app.post("/ingest", response_model=IngestResponse)
async def trigger_ingestion(authorization: str | None = Header(None)):
    """
    Ingest all PDFs currently sitting in data/raw-docs-cache/.
    Runs synchronously in the request (suitable for small batches).
    """
    t0 = time.perf_counter()
    workplace_id = get_workplace_id(authorization)
    cache_dir = CACHE_DIR / workplace_id if workplace_id else CACHE_DIR
    result = _run_ingestion_job(cache_dir=cache_dir, workplace_id=workplace_id)
    return _ingestion_response(result, t0)


@app.get("/ingest/status", response_model=StoreStatus)
async def store_status():
    """Return current vector store statistics."""
    if _store is None:
        raise HTTPException(status_code=503, detail="Store not initialised")
    return StoreStatus(
        total_vectors  = _store.total_vectors,
        docs_processed = len(_store._processed),  # noqa: SLF001
    )


# ── RAG query endpoint ────────────────────────────────────────────────────────
@app.post("/query", response_model=QueryResponse)
async def query_endpoint(body: QueryRequest, authorization: str | None = Header(None)):
    """Ask a natural-language question; returns an LLM answer with citations."""
    if _engine is None:
        raise HTTPException(status_code=503, detail="Query engine not initialised")

    workplace_id = get_workplace_id(authorization)
    source_names = _resolve_file_sources(body.file_ids, workplace_id)
    if body.file_ids and not source_names:
        raise HTTPException(status_code=400, detail="Selected PDF context is no longer available.")

    try:
        result = _engine.query(
            body.question,
            workplace_id=workplace_id,
            source_names=source_names,
            history=[item.model_dump() for item in body.history],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("Query failed: %s", exc)
        raise HTTPException(status_code=500, detail="LLM query failed")

    return QueryResponse(
        answer          = result.answer,
        sources         = _safe_source_items(result.sources),
        context_preview = _safe_preview_items(result.context_preview),
    )


# ── health ────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/")
def greetings():
    return "hello welcome to PRJ006"


# Register legacy download/delete helpers after first-class routes so `/upload`
# and `/files` resolve to the ingestion and Cloudinary-backed handlers above.
app.include_router(file_router)
