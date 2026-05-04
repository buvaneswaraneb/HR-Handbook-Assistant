"""
pipeline.py — Orchestrates the full ingestion pipeline.

Flow per document:
  1. Check if already processed (doc_hash dedup).
  2. Extract pages via loader.
  3. Chunk with semantic-aware splitter.
  4. Embed in batches.
  5. Add to FAISS store (in-memory).
  6. Persist store to disk.
  7. Delete source PDF from cache ONLY after successful persistence.

Safe-deletion guarantee: the file is never removed before the store is
flushed to disk, so a crash mid-pipeline never loses data.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

from .chunker import chunk_pages
from .embedder import Embedder, get_default_embedder
from .loader import CACHE_DIR, load_pdfs
from .vector_store import VectorStore

logger = logging.getLogger(__name__)


@dataclass
class IngestionResult:
    processed: list[str] = field(default_factory=list)   # successfully ingested
    skipped:   list[str] = field(default_factory=list)   # already in store
    failed:    list[str] = field(default_factory=list)   # errors

    @property
    def total(self) -> int:
        return len(self.processed) + len(self.skipped) + len(self.failed)


class IngestionPipeline:
    """
    End-to-end document ingestion pipeline.

    Usage::

        pipeline = IngestionPipeline()
        result = pipeline.run()
        print(result)
    """

    def __init__(
        self,
        cache_dir: Path = CACHE_DIR,
        embedder: Embedder | None = None,
        store: VectorStore | None = None,
    ) -> None:
        self._cache_dir = cache_dir
        self._embedder = embedder or get_default_embedder()
        self._store = store or VectorStore(dim=self._embedder.dimension)

    # ── public ────────────────────────────────────────────────────────────────
    def run(self) -> IngestionResult:
        """
        Process all PDFs in cache_dir and return a summary result.
        This is the single entry-point for the ingestion job.
        """
        result = IngestionResult()
        store = self._store

        for pdf_path, pages in load_pdfs(self._cache_dir):
            name = pdf_path.name
            try:
                if not pages:
                    logger.warning("%s yielded no extractable text — skipping", name)
                    result.skipped.append(name)
                    continue

                doc_hash = pages[0].doc_hash

                if store.is_processed(doc_hash):
                    logger.info("%s already ingested (hash %s) — skipping", name, doc_hash[:8])
                    result.skipped.append(name)
                    _safe_delete(pdf_path)   # clean up duplicate cache entry
                    continue

                self._ingest_document(pdf_path, pages)
                result.processed.append(name)

            except Exception as exc:  # noqa: BLE001
                logger.exception("Error ingesting %s: %s", name, exc)
                result.failed.append(name)
                # Do NOT delete the file so it can be retried

        logger.info(
            "Pipeline complete — processed=%d  skipped=%d  failed=%d",
            len(result.processed), len(result.skipped), len(result.failed),
        )
        return result

    # ── private ───────────────────────────────────────────────────────────────
    def _ingest_document(self, pdf_path: Path, pages) -> None:
        name = pdf_path.name
        logger.info("[%s] chunking …", name)
        chunks = chunk_pages(pages, source=name)

        if not chunks:
            logger.warning("[%s] produced 0 chunks after splitting", name)
            return

        logger.info("[%s] %d chunks → embedding …", name, len(chunks))
        texts = [c.content for c in chunks]
        embeddings = self._embedder.embed(texts)

        logger.info("[%s] storing %d vectors …", name, len(embeddings))
        self._store.add(chunks, embeddings)
        self._store.save()            # persist BEFORE deleting source

        logger.info("[%s] ✓ persisted — deleting from cache", name)
        # _safe_delete(pdf_path)


# ── helpers ───────────────────────────────────────────────────────────────────
def _safe_delete(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
        logger.debug("Deleted %s", path)
    except OSError as exc:
        logger.warning("Could not delete %s: %s", path, exc)


# ── convenience runner ────────────────────────────────────────────────────────
def run_ingestion(
    cache_dir: Path = CACHE_DIR,
    embedder: "Embedder | None" = None,
    store: "VectorStore | None" = None,
) -> IngestionResult:
    """
    Module-level shortcut — create a pipeline and run it.

    Pass `embedder` and `store` to use a specific embedding model and its
    corresponding FAISS store (e.g. when a non-default model is active).
    """
    from .embedder import Embedder       # avoid circular at module level  # noqa: F401
    from .vector_store import VectorStore  # noqa: F401
    pipeline = IngestionPipeline(cache_dir=cache_dir, embedder=embedder, store=store)
    return pipeline.run()
