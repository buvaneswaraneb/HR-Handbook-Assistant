"""
main.py — FastAPI app: ingestion + RAG query endpoints.

Endpoints
---------
POST /ingest              Ingest all PDFs in raw-docs-cache/
GET  /ingest/status       Vector store statistics
POST /query               Ask a question against ingested documents
GET  /health              Health check
"""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from services.ingestion import run_ingestion, IngestionResult
from services.ingestion.vector_store import VectorStore
from services.rag import RAGQueryEngine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

# ── shared singletons ─────────────────────────────────────────────────────────
_store:  VectorStore     | None = None
_engine: RAGQueryEngine  | None = None
_running: bool = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _store, _engine
    _store  = VectorStore()
    _engine = RAGQueryEngine(store=_store)
    logger.info("VectorStore loaded — %d vectors", _store.total_vectors)
    yield


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


class QueryRequest(BaseModel):
    question: str


class SourceItem(BaseModel):
    file:     str
    page:     int
    chunk_id: str


class PreviewItem(BaseModel):
    text: str
    file: str
    page: int


class QueryResponse(BaseModel):
    answer:          str
    sources:         list[SourceItem]
    context_preview: list[PreviewItem]


# ── ingestion endpoints ───────────────────────────────────────────────────────
@app.post("/ingest", response_model=IngestResponse)
async def trigger_ingestion():
    global _running
    if _running:
        raise HTTPException(status_code=409, detail="Ingestion already in progress")

    _running = True
    t0 = time.perf_counter()
    try:
        result = run_ingestion()
    finally:
        _running = False

    return IngestResponse(
        status     = "ok" if not result.failed else "partial",
        processed  = result.processed,
        skipped    = result.skipped,
        failed     = result.failed,
        duration_s = round(time.perf_counter() - t0, 2),
    )


@app.get("/ingest/status", response_model=StoreStatus)
async def store_status():
    if _store is None:
        raise HTTPException(status_code=503, detail="Store not initialised")
    return StoreStatus(
        total_vectors  = _store.total_vectors,
        docs_processed = len(_store._processed),
    )


# ── query endpoint ────────────────────────────────────────────────────────────
@app.post("/query", response_model=QueryResponse)
async def query(body: QueryRequest):
    if _engine is None:
        raise HTTPException(status_code=503, detail="Query engine not initialised")
    if _store and _store.total_vectors == 0:
        raise HTTPException(
            status_code=400,
            detail="No documents ingested yet. POST to /ingest first."
        )

    try:
        result = _engine.query(body.question)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("Query failed: %s", exc)
        raise HTTPException(status_code=500, detail="LLM query failed")

    return QueryResponse(
        answer          = result.answer,
        sources         = [SourceItem(**source) for source in result.sources],  #updated
        context_preview = [PreviewItem(**preview) for preview in result.context_preview],
    )


# ── health ────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok"}