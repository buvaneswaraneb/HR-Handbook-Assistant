"""
embedder.py — Lightweight batch embedding via sentence-transformers.

Model: all-MiniLM-L6-v2
  • 384-dim vectors — small FAISS index
  • ~22 M params — fast CPU inference
  • No API key / no token cost
  • Solid retrieval quality for RAG

Design choices:
  • Model loaded once, reused across calls (singleton pattern).
  • encode() is called in batches to maximise throughput.
  • Returns numpy float32 arrays directly (FAISS-ready).
"""

from __future__ import annotations

import logging
from typing import Sequence

import numpy as np

logger = logging.getLogger(__name__)

# ── defaults ──────────────────────────────────────────────────────────────────
DEFAULT_MODEL      = "all-MiniLM-L6-v2"
DEFAULT_BATCH_SIZE = 64          # sweet spot for CPU; increase for GPU
EMBEDDING_DIM      = 384         # MiniLM-L6 output size


class Embedder:
    """
    Wraps sentence-transformers for batched, reusable embedding.

    Usage::

        embedder = Embedder()
        vectors = embedder.embed(["chunk one", "chunk two", ...])
    """

    def __init__(
        self,
        model_name: str = DEFAULT_MODEL,
        batch_size: int = DEFAULT_BATCH_SIZE,
        device: str | None = None,   # None → auto-detect (cpu / cuda)
    ) -> None:
        self._model_name = model_name
        self._batch_size = batch_size
        self._device = device
        self._model = None           # lazy-loaded

    # ── public ────────────────────────────────────────────────────────────────
    def embed(self, texts: Sequence[str]) -> np.ndarray:
        """
        Embed a list of texts in batches.

        Returns
        -------
        np.ndarray  shape (N, EMBEDDING_DIM), dtype float32
        """
        if not texts:
            return np.empty((0, EMBEDDING_DIM), dtype=np.float32)

        model = self._get_model()
        logger.info(
            "Embedding %d texts with model '%s' (batch_size=%d)",
            len(texts), self._model_name, self._batch_size,
        )

        vectors = model.encode(
            list(texts),
            batch_size=self._batch_size,
            show_progress_bar=False,
            convert_to_numpy=True,
            normalize_embeddings=True,   # cosine similarity via dot-product
        )
        return vectors.astype(np.float32)

    @property
    def dimension(self) -> int:
        return EMBEDDING_DIM

    # ── internal ──────────────────────────────────────────────────────────────
    def _get_model(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer  # deferred import
            logger.info("Loading embedding model '%s' …", self._model_name)
            self._model = SentenceTransformer(
                self._model_name,
                device=self._device,
            )
        return self._model


# ── module-level singleton (optional convenience) ─────────────────────────────
_default_embedder: Embedder | None = None


def get_default_embedder() -> Embedder:
    global _default_embedder
    if _default_embedder is None:
        _default_embedder = Embedder()
    return _default_embedder
