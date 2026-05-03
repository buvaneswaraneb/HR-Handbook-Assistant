"""
main.py — FastAPI app with ingestion endpoints.

Endpoints
---------
POST /ingest          Trigger ingestion of all PDFs in raw-docs-cache/
GET  /ingest/status   Return store statistics (vector count, docs processed)
"""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from services.ingestion import IngestionResult, run_ingestion
from services.ingestion.vector_store import VectorStore

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

# ── shared state ──────────────────────────────────────────────────────────────
_store: VectorStore | None = None
_last_result: IngestionResult | None = None
_running: bool = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _store
    _store = VectorStore()
    logger.info("VectorStore loaded — %d vectors", _store.total_vectors)
    yield


app = FastAPI(
    title="RAG Ingestion Service",
    description="Document ingestion pipeline: PDF → chunks → embeddings → FAISS",
    version="1.0.0",
    lifespan=lifespan,
)


# ── response models ───────────────────────────────────────────────────────────
class IngestResponse(BaseModel):
    status:    str
    processed: list[str]
    skipped:   list[str]
    failed:    list[str]
    duration_s: float


class StoreStatus(BaseModel):
    total_vectors: int
    docs_processed: int


# ── endpoints ─────────────────────────────────────────────────────────────────
@app.post("/ingest", response_model=IngestResponse)
async def trigger_ingestion(background_tasks: BackgroundTasks):
    """
    Ingest all PDFs currently sitting in raw-docs-cache/.

    Runs synchronously in the request (suitable for small batches).
    For large-scale use, move to a background task or Celery worker.
    """
    global _running, _last_result

    if _running:
        raise HTTPException(status_code=409, detail="Ingestion already in progress")

    _running = True
    t0 = time.perf_counter()
    try:
        result = run_ingestion()
        _last_result = result
    finally:
        _running = False

    duration = round(time.perf_counter() - t0, 2)
    return IngestResponse(
        status="ok" if not result.failed else "partial",
        processed=result.processed,
        skipped=result.skipped,
        failed=result.failed,
        duration_s=duration,
    )


@app.get("/ingest/status", response_model=StoreStatus)
async def store_status():
    """Return current vector store statistics."""
    if _store is None:
        raise HTTPException(status_code=503, detail="Store not initialised")
    return StoreStatus(
        total_vectors=_store.total_vectors,
        docs_processed=len(_store._processed),  # noqa: SLF001
    )


@app.get("/health")
async def health():
    return {"status": "ok"}
