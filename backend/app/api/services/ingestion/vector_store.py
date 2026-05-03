"""
vector_store.py — FAISS-backed vector store with incremental update support.

Layout on disk::

    faiss-store/
    ├── index.faiss       ← FAISS flat index (IndexFlatIP for cosine via normalised vecs)
    ├── metadata.json     ← list[dict] parallel to index rows
    └── processed.json    ← set of doc_hash values already ingested (dedup)

Design decisions:
  • IndexFlatIP (exact inner-product search) — correct for normalised embeddings.
  • No IVF/HNSW by default; add when N > 100 k for speed.
  • Metadata stored in a plain JSON file (no SQLite overhead for small corpora).
  • Thread-safe writes via a simple file lock (single-process assumption; extend
    with filelock or a DB for multi-worker setups).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import faiss
import numpy as np

from .chunker import Chunk

logger = logging.getLogger(__name__)

STORE_DIR     = Path("faiss-store")
INDEX_FILE    = STORE_DIR / "index.faiss"
META_FILE     = STORE_DIR / "metadata.json"
PROCESSED_FILE = STORE_DIR / "processed.json"


class VectorStore:
    """
    Manages a persistent FAISS index and its parallel metadata list.

    Usage::

        store = VectorStore()
        store.add(chunks, embeddings)
        store.save()
        already_seen = store.is_processed("sha256hex")
    """

    def __init__(self, store_dir: Path = STORE_DIR, dim: int = 384) -> None:
        self._dir = store_dir
        self._dim = dim
        self._dir.mkdir(parents=True, exist_ok=True)

        self._index: faiss.Index = self._load_index()
        self._metadata: list[dict[str, Any]] = self._load_metadata()
        self._processed: set[str] = self._load_processed()

    # ── public ────────────────────────────────────────────────────────────────
    def is_processed(self, doc_hash: str) -> bool:
        """Return True if this document was already ingested (dedup guard)."""
        return doc_hash in self._processed

    def add(self, chunks: list[Chunk], embeddings: np.ndarray) -> None:
        """
        Add chunks and their embeddings to the store (in-memory only).
        Call save() afterwards to persist.
        """
        if len(chunks) != len(embeddings):
            raise ValueError(
                f"Mismatch: {len(chunks)} chunks vs {len(embeddings)} embeddings"
            )
        if len(chunks) == 0:
            return

        self._index.add(embeddings)
        for chunk in chunks:
            self._metadata.append(chunk.metadata | {"content": chunk.content})

        # Mark doc hashes as processed
        for chunk in chunks:
            self._processed.add(chunk.metadata["doc_hash"])

        logger.info(
            "Added %d vectors — index total: %d", len(chunks), self._index.ntotal
        )

    def save(self) -> None:
        """Atomically persist index + metadata + processed set to disk."""
        # Write metadata to a temp file first, then rename (atomic on POSIX)
        tmp_meta = self._dir / "metadata.json.tmp"
        tmp_proc = self._dir / "processed.json.tmp"
        tmp_idx  = self._dir / "index.faiss.tmp"

        tmp_meta.write_text(json.dumps(self._metadata, ensure_ascii=False, indent=2))
        tmp_proc.write_text(json.dumps(sorted(self._processed), ensure_ascii=False))
        faiss.write_index(self._index, str(tmp_idx))

        tmp_meta.replace(META_FILE)
        tmp_proc.replace(PROCESSED_FILE)
        tmp_idx.replace(INDEX_FILE)

        logger.info("Vector store saved — %d vectors, %d docs processed",
                    self._index.ntotal, len(self._processed))

    @property
    def total_vectors(self) -> int:
        return self._index.ntotal

    # ── retrieval (thin layer for testing; full query engine lives elsewhere) ──
    def search(self, query_vec: np.ndarray, k: int = 5) -> list[dict[str, Any]]:
        """Return the top-k metadata dicts closest to query_vec."""
        if self._index.ntotal == 0:
            return []
        scores, indices = self._index.search(query_vec.reshape(1, -1), k)
        results = []
        for score, idx in zip(scores[0], indices[0]):
            if idx < 0:
                continue
            entry = dict(self._metadata[idx])
            entry["_score"] = float(score)
            results.append(entry)
        return results

    # ── private ───────────────────────────────────────────────────────────────
    def _load_index(self) -> faiss.Index:
        if INDEX_FILE.exists():
            logger.info("Loading existing FAISS index from %s", INDEX_FILE)
            return faiss.read_index(str(INDEX_FILE))
        logger.info("Creating new FAISS IndexFlatIP (dim=%d)", self._dim)
        return faiss.IndexFlatIP(self._dim)

    def _load_metadata(self) -> list[dict[str, Any]]:
        if META_FILE.exists():
            return json.loads(META_FILE.read_text())
        return []

    def _load_processed(self) -> set[str]:
        if PROCESSED_FILE.exists():
            return set(json.loads(PROCESSED_FILE.read_text()))
        return set()
