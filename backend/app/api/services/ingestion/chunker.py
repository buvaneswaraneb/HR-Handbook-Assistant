"""
chunker.py — Production-grade semantic chunking.

Strategy:
  1. Split on paragraph boundaries first (double-newline).
  2. Accumulate paragraphs until we approach the token budget.
  3. If a single paragraph exceeds the budget, split it on sentence
     boundaries (never mid-sentence).
  4. Apply a rolling overlap by prepending the tail of the previous chunk.

Target: 600–800 tokens per chunk, ~100–150 token overlap.
Token estimation: ~4 chars ≈ 1 token (conservative, no external token is needed).
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from typing import Iterator

from .loader import PageRecord

# ── tuneable constants ────────────────────────────────────────────────────────
CHUNK_TARGET_TOKENS = 700        # aim for the middle of 600-800
CHUNK_MAX_TOKENS    = 800
OVERLAP_TOKENS      = 125        # middle of 100-150

CHARS_PER_TOKEN     = 4          # coarse but dependency-free estimation


def _tok(text: str) -> int:
    """Estimate token count from character count."""
    return max(1, len(text) // CHARS_PER_TOKEN)


# ── data model ────────────────────────────────────────────────────────────────
@dataclass
class Chunk:
    content: str
    metadata: dict = field(default_factory=dict)

    @property
    def token_count(self) -> int:
        return _tok(self.content)


# ── public API ────────────────────────────────────────────────────────────────
def chunk_pages(pages: list[PageRecord], source: str) -> list[Chunk]:
    """
    Convert a document's pages into overlapping, semantically-aware chunks.
    Each chunk carries full provenance metadata.
    """
    chunks: list[Chunk] = []
    previous_tail: str = ""

    for page in pages:
        page_chunks = list(_chunk_text(page.text, previous_tail))
        for raw_content in page_chunks:
            chunk_id = str(uuid.uuid4())
            chunk = Chunk(
                content=raw_content,
                metadata={
                    "source":      source,
                    "page":        page.page,
                    "chunk_id":    chunk_id,
                    "token_count": _tok(raw_content),
                    "doc_hash":    page.doc_hash,
                },
            )
            chunks.append(chunk)

        if page_chunks:
            previous_tail = _tail(page_chunks[-1])

    return chunks


# ── internal splitting logic ──────────────────────────────────────────────────
def _chunk_text(text: str, overlap_seed: str) -> Iterator[str]:
    """
    Yield chunks for a single page's text.
    `overlap_seed` is text carried over from the previous chunk/page.
    """
    paragraphs = _split_paragraphs(text)
    buffer: list[str] = []
    buffer_tokens = 0

    if overlap_seed:
        buffer.append(overlap_seed)
        buffer_tokens = _tok(overlap_seed)

    for para in paragraphs:
        para_tokens = _tok(para)

        # Para fits in current buffer
        if buffer_tokens + para_tokens <= CHUNK_MAX_TOKENS:
            buffer.append(para)
            buffer_tokens += para_tokens

            # Flush when we've hit the target
            if buffer_tokens >= CHUNK_TARGET_TOKENS:
                chunk_text = _join(buffer)
                yield chunk_text
                # Overlap: keep the tail of what we just emitted
                tail = _tail(chunk_text)
                buffer = [tail] if tail else []
                buffer_tokens = _tok(tail)

        else:
            # Para is larger than budget — split on sentences
            if buffer:
                yield _join(buffer)
                tail = _tail(_join(buffer))
                buffer = [tail] if tail else []
                buffer_tokens = _tok(tail)

            if para_tokens <= CHUNK_MAX_TOKENS:
                buffer.append(para)
                buffer_tokens += para_tokens
            else:
                # Sentence-level fallback
                for sentence_chunk in _split_sentences(para):
                    yield sentence_chunk

    if buffer:
        leftover = _join(buffer)
        if leftover.strip():
            yield leftover


def _split_paragraphs(text: str) -> list[str]:
    """Split on blank lines, strip whitespace, drop empties."""
    return [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]


def _split_sentences(text: str) -> Iterator[str]:
    """
    Sentence-boundary splitter that never breaks mid-sentence.
    Falls back to yielding the whole text if sentences are too large.
    """
    # Naive but robust sentence splitter (avoids nltk dependency)
    sentence_re = re.compile(r"(?<=[.!?])\s+(?=[A-Z])")
    sentences = sentence_re.split(text)

    buffer: list[str] = []
    buffer_tokens = 0

    for sent in sentences:
        sent_tokens = _tok(sent)
        if buffer_tokens + sent_tokens > CHUNK_MAX_TOKENS and buffer:
            yield " ".join(buffer)
            tail = _tail(" ".join(buffer))
            buffer = [tail] if tail else []
            buffer_tokens = _tok(tail)

        buffer.append(sent)
        buffer_tokens += sent_tokens

    if buffer:
        yield " ".join(buffer)


def _tail(text: str, tokens: int = OVERLAP_TOKENS) -> str:
    """Return the last `tokens` worth of characters from text."""
    chars = tokens * CHARS_PER_TOKEN
    return text[-chars:].strip() if len(text) > chars else text.strip()


def _join(parts: list[str]) -> str:
    return "\n\n".join(p for p in parts if p.strip())
