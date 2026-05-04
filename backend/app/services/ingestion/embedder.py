"""
embedder.py — Batch embedding via sentence-transformers with multi-model support.

Supported model profiles
------------------------
  "minilm"  : sentence-transformers/all-MiniLM-L6-v2
                384-dim | ~22M params | fast CPU | good retrieval quality
  "qwen"    : Qwen/Qwen3-Embedding-8B
                4096-dim | ~8B params | high accuracy | GPU recommended

Design choices:
  • Each profile has its own Embedder instance (cached in _embedder_cache).
  • Qwen3-Embedding uses a separate query instruction prefix — pass
    is_query=True when embedding search questions.
  • Device auto-detection: CUDA → MPS (Apple Silicon) → CPU.
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
        model_key: str = DEFAULT_MODEL_KEY,
        batch_size: int | None = None,
        device: str | None = None,
    ) -> None:
        if model_key not in MODEL_PROFILES:
            raise ValueError(
                f"Unknown model_key '{model_key}'. "
                f"Choose from: {list(MODEL_PROFILES)}"
            )
        profile = MODEL_PROFILES[model_key]
        self._model_key        = model_key
        self._model_id         = profile["model_id"]
        self._dim              = profile["dimension"]
        self._batch_size       = batch_size or profile["batch_size"]
        self._query_prompt     = profile["query_prompt_name"]
        self._trust_remote     = profile["trust_remote_code"]
        self._device           = device or _auto_device()
        self._model            = None    # lazy-loaded

    # ── public ────────────────────────────────────────────────────────────────
    def embed(self, texts: Sequence[str], is_query: bool = False) -> np.ndarray:
        """
        Embed a list of texts.

        Parameters
        ----------
        texts    : Strings to embed.
        is_query : True when embedding a search question.  Enables the
                   query-instruction prefix on models that require it
                   (e.g. Qwen/Qwen3-Embedding-8B).
        """
        if not texts:
            return np.empty((0, self._dim), dtype=np.float32)

        model = self._get_model()
        logger.info(
            "Embedding %d texts with model '%s' on %s (is_query=%s)",
            len(texts), self._model_id, self._device, is_query,
        )

        encode_kwargs: dict = dict(
            batch_size           = self._batch_size,
            show_progress_bar    = False,
            convert_to_numpy     = True,
            normalize_embeddings = True,   # cosine similarity via dot-product
        )
        if is_query and self._query_prompt:
            encode_kwargs["prompt_name"] = self._query_prompt

        vectors = model.encode(list(texts), **encode_kwargs)
        return vectors.astype(np.float32)

    @property
    def dimension(self) -> int:
        return self._dim

    @property
    def model_key(self) -> str:
        return self._model_key

    @property
    def model_id(self) -> str:
        return self._model_id

    # ── internal ──────────────────────────────────────────────────────────────
    def _get_model(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer
            logger.info(
                "Loading embedding model '%s' on device '%s' …",
                self._model_id, self._device,
            )
            kwargs: dict = {"device": self._device}
            if self._trust_remote:
                kwargs["trust_remote_code"] = True
            self._model = SentenceTransformer(self._model_id, **kwargs)
        return self._model


# ── factories ─────────────────────────────────────────────────────────────────
_embedder_cache: dict[str, Embedder] = {}


def create_embedder(model_key: str = DEFAULT_MODEL_KEY) -> Embedder:
    """Return a (cached) Embedder for the given profile key."""
    if model_key not in _embedder_cache:
        _embedder_cache[model_key] = Embedder(model_key=model_key)
    return _embedder_cache[model_key]


def get_default_embedder() -> Embedder:
    """Backwards-compatible convenience — always returns the minilm embedder."""
    return create_embedder(DEFAULT_MODEL_KEY)
