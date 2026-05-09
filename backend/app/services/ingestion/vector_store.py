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
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

import faiss
import numpy as np

from .chunker import Chunk

logger = logging.getLogger(__name__)

# Keep runtime writes outside backend/app so uvicorn --reload does not restart
# whenever ingestion saves FAISS files.
REPO_ROOT = Path(__file__).resolve().parents[4]
LEGACY_STORE_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "faiss-store"
RUNTIME_DIR = Path(os.getenv("HR_ASSISTANT_RUNTIME_DIR", Path(tempfile.gettempdir()) / "hr-assistant-runtime"))
STORE_DIR = Path(os.getenv("VECTOR_STORE_DIR", RUNTIME_DIR / "faiss-store"))
INDEX_FILE     = STORE_DIR / "index.faiss"
META_FILE      = STORE_DIR / "metadata.json"
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
        self._migrate_legacy_store()

        self._index: faiss.Index = self._load_index()
        self._dim = self._index.d
        self._metadata: list[dict[str, Any]] = self._load_metadata()
        self._processed: set[str] = self._load_processed()

    # ── public ────────────────────────────────────────────────────────────────
    def is_processed(self, doc_hash: str, workplace_id: str | None = None) -> bool:
        """Return True if this document was already ingested (dedup guard)."""
        return self._processed_key(doc_hash, workplace_id) in self._processed

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
            self._processed.add(self._processed_key(chunk.metadata["doc_hash"], chunk.metadata.get("workplace_id")))

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

        tmp_meta.replace(self._meta_file)
        tmp_proc.replace(self._processed_file)
        tmp_idx.replace(self._index_file)

        logger.info("Vector store saved — %d vectors, %d docs processed",
                    self._index.ntotal, len(self._processed))

    @property
    def total_vectors(self) -> int:
        return self._index.ntotal

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

    def search_with_threshold(
        self,
        query_vec: np.ndarray,
        score_threshold: float = 0.3,
        candidate_k: int | None = None,
        workplace_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """
        Retrieve all chunks whose cosine similarity score >= score_threshold.

        Parameters
        ----------
        query_vec       : Normalised query embedding (shape: [dim]).
        score_threshold : Minimum inner-product score to keep a chunk.
                          Range 0–1 (normalised vectors → cosine similarity).
                          0.3 keeps moderately relevant chunks;
                          raise to 0.5+ for stricter relevance.
        candidate_k     : How many candidates to pull from FAISS before
                          filtering.  Defaults to min(total_vectors, 50)
                          so we cast a wide net without unbounded memory.

        Returns
        -------
        List of metadata dicts sorted by score descending, all with
        _score >= score_threshold.
        """
        if self._index.ntotal == 0:
            return []

        k = self._index.ntotal if workplace_id else candidate_k if candidate_k is not None else min(self._index.ntotal, 50)
        k = min(k, self._index.ntotal)   # FAISS errors if k > ntotal

        scores, indices = self._index.search(query_vec.reshape(1, -1), k)

        results = []
        for score, idx in zip(scores[0], indices[0]):
            if idx < 0:
                continue
            if workplace_id and self._metadata[idx].get("workplace_id") != workplace_id:
                continue
            if float(score) < score_threshold:
                continue                  # below relevance bar — skip
            entry = dict(self._metadata[idx])
            entry["_score"] = float(score)
            results.append(entry)

        # Already sorted by FAISS (descending score), but sort explicitly
        results.sort(key=lambda x: x["_score"], reverse=True)
        logger.info(
            "search_with_threshold: %d/%d candidates passed threshold %.2f",
            len(results), k, score_threshold,
        )
        return results

    def delete_by_source(self, source: str, workplace_id: str | None = None) -> int:
        """
        Remove every vector chunk whose metadata source matches a file name.

        FAISS flat indexes compact row ids after deletion, so rebuild the index
        and metadata in the same pass to keep metadata rows aligned with vectors.
        """
        if not source or self._index.ntotal == 0:
            return 0
        if self._index.ntotal != len(self._metadata):
            logger.warning(
                "Vector metadata mismatch before deleting %s: index=%d metadata=%d",
                source,
                self._index.ntotal,
                len(self._metadata),
            )

        limit = min(self._index.ntotal, len(self._metadata))
        kept_vectors: list[np.ndarray] = []
        kept_metadata: list[dict[str, Any]] = []
        removed_hashes: set[str] = set()
        removed_count = 0

        for idx, metadata in enumerate(self._metadata[:limit]):
            if metadata.get("source") == source and (workplace_id is None or metadata.get("workplace_id") == workplace_id):
                removed_count += 1
                doc_hash = metadata.get("doc_hash")
                if isinstance(doc_hash, str):
                    removed_hashes.add(doc_hash)
                continue

            kept_vectors.append(np.asarray(self._index.reconstruct(idx), dtype=np.float32))
            kept_metadata.append(metadata)

        for metadata in self._metadata[limit:]:
            if metadata.get("source") == source and (workplace_id is None or metadata.get("workplace_id") == workplace_id):
                removed_count += 1
                doc_hash = metadata.get("doc_hash")
                if isinstance(doc_hash, str):
                    removed_hashes.add(doc_hash)
            else:
                kept_metadata.append(metadata)

        if removed_count == 0:
            logger.info("No vectors found for source %s", source)
            return 0

        new_index = faiss.IndexFlatIP(self._dim)
        if kept_vectors:
            new_index.add(np.vstack(kept_vectors).astype(np.float32))

        remaining_hashes = {
            metadata.get("doc_hash")
            for metadata in kept_metadata
            if isinstance(metadata.get("doc_hash"), str)
        }
        self._index = new_index
        self._metadata = kept_metadata
        self._processed.difference_update(removed_hashes - remaining_hashes)
        self.save()

        logger.info("Deleted %d vectors for source %s", removed_count, source)
        return removed_count

    def delete_by_doc_hash(self, doc_hash: str, workplace_id: str | None = None) -> int:
        """
        Remove every vector chunk and processed marker for a document hash.

        Use this before replacing an uploaded document so the pipeline can
        digest the same file contents again in the currently running process.
        """
        if not doc_hash:
            return 0

        processed_keys = {doc_hash, self._processed_key(doc_hash, workplace_id)}
        removed_count = self._delete_matching(
            lambda metadata: (
                metadata.get("doc_hash") == doc_hash
                and (workplace_id is None or metadata.get("workplace_id") == workplace_id)
            ),
            processed_keys=processed_keys,
            description=f"hash {doc_hash[:8]}",
        )

        if removed_count == 0 and self._processed.intersection(processed_keys):
            self._processed.difference_update(processed_keys)
            self.save()
            logger.info("Cleared processed marker for hash %s", doc_hash[:8])

        return removed_count

    def _delete_matching(self, predicate, processed_keys: set[str], description: str) -> int:
        if self._index.ntotal == 0:
            self._processed.difference_update(processed_keys)
            return 0

        if self._index.ntotal != len(self._metadata):
            logger.warning(
                "Vector metadata mismatch before deleting %s: index=%d metadata=%d",
                description,
                self._index.ntotal,
                len(self._metadata),
            )

        limit = min(self._index.ntotal, len(self._metadata))
        kept_vectors: list[np.ndarray] = []
        kept_metadata: list[dict[str, Any]] = []
        removed_count = 0

        for idx, metadata in enumerate(self._metadata[:limit]):
            if predicate(metadata):
                removed_count += 1
                continue

            kept_vectors.append(np.asarray(self._index.reconstruct(idx), dtype=np.float32))
            kept_metadata.append(metadata)

        for metadata in self._metadata[limit:]:
            if predicate(metadata):
                removed_count += 1
            else:
                kept_metadata.append(metadata)

        if removed_count == 0:
            self._processed.difference_update(processed_keys)
            return 0

        new_index = faiss.IndexFlatIP(self._dim)
        if kept_vectors:
            new_index.add(np.vstack(kept_vectors).astype(np.float32))

        self._index = new_index
        self._metadata = kept_metadata
        self._processed.difference_update(processed_keys)
        self.save()

        logger.info("Deleted %d vectors for %s", removed_count, description)
        return removed_count


    # ── private ───────────────────────────────────────────────────────────────
    @staticmethod
    def _processed_key(doc_hash: str, workplace_id: str | None = None) -> str:
        return f"{workplace_id}:{doc_hash}" if workplace_id else doc_hash

    @property
    def _index_file(self) -> Path:
        return self._dir / "index.faiss"

    @property
    def _meta_file(self) -> Path:
        return self._dir / "metadata.json"

    @property
    def _processed_file(self) -> Path:
        return self._dir / "processed.json"

    def _load_index(self) -> faiss.Index:
        if self._index_file.exists():
            logger.info("Loading existing FAISS index from %s", self._index_file)
            return faiss.read_index(str(self._index_file))
        logger.info("Creating new FAISS IndexFlatIP (dim=%d)", self._dim)
        return faiss.IndexFlatIP(self._dim)

    def _load_metadata(self) -> list[dict[str, Any]]:
        if self._meta_file.exists():
            return json.loads(self._meta_file.read_text())
        return []

    def _load_processed(self) -> set[str]:
        if self._processed_file.exists():
            return set(json.loads(self._processed_file.read_text()))
        return set()

    def _migrate_legacy_store(self) -> None:
        if self._dir == LEGACY_STORE_DIR:
            return
        if self._index_file.exists() or self._meta_file.exists() or self._processed_file.exists():
            return
        if not LEGACY_STORE_DIR.exists():
            return

        for filename in ("index.faiss", "metadata.json", "processed.json"):
            legacy_file = LEGACY_STORE_DIR / filename
            if legacy_file.exists():
                shutil.copy2(legacy_file, self._dir / filename)

        logger.info("Migrated legacy vector store from %s to %s", LEGACY_STORE_DIR, self._dir)
