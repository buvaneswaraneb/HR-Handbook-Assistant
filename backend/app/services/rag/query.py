"""
query.py — RAG query layer.

Flow:
  1. Embed user question via sentence-transformers (same model as ingestion).
  2. Retrieve top-k chunks from FAISS vector store.
  3. Format chunks into the context block the LLM expects.
  4. Call Groq (llama-3.1-8b-instant) with the strict system prompt.
  5. Parse and return structured JSON response.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import dotenv_values

# ── load .env anchored to its real location ───────────────────────────────────
# __file__ == backend/app/services/rag/query.py
# .parent        == backend/app/services/rag/
# .parent.parent == backend/app/services/          ← where .env lives
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
_env_vars = dotenv_values(_ENV_FILE)   # returns {} if file not found (no crash)

import httpx

from app.services.ingestion.embedder import get_default_embedder
from app.services.ingestion.vector_store import VectorStore

logger = logging.getLogger(__name__)

# ── config ────────────────────────────────────────────────────────────────────
GROQ_API_URL     = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL       = "llama-3.1-8b-instant"
MAX_TOKENS       = 1024

# Retrieval settings
SCORE_THRESHOLD  = 0.30   # min cosine similarity to include a chunk (0–1)
CANDIDATE_K      = 10     # how many candidates FAISS returns before filtering
CONTEXT_TOKEN_BUDGET = 6_000  # ~4 chars per token; trim context if too long

SYSTEM_PROMPT = """ You are an internal HR assistant.
Your task is to answer questions using ONLY the provided context from company documents.

IMPORTANT RULES:
- DO NOT hallucinate.
- If you cannot find the answer in the context, say:
  "I don't have the answer based on the provided documents."

If the user greets (e.g., "hi", "hello"), respond with a brief greeting and ask how you can help.
Otherwise, answer using ONLY the provided context.

RULES (STRICT):
1. Use ONLY the given context.
2. Do NOT use outside knowledge.
3. If the answer is not present, respond with the exact JSON edge-case below.
5. Do NOT repeat the question.
6. Do NOT include unnecessary explanation.

CITATION RULES:
- You MUST cite sources for every answer.
- Use ONLY provided metadata.
- Do NOT invent sources.

OUTPUT FORMAT — return ONLY valid JSON, nothing else:
{
  "answer": "<final answer>",
  "sources": [
    {"file": "<filename>", "page": <number>, "chunk_id": "<chunk_id>"}
  ],
  "context_preview": [
    {"text": "<excerpt max 200 chars>", "file": "<filename>", "page": <number>}
  ]
}

If no answer found, return exactly:
{"answer": "I don't know based on the provided documents.", "sources": [], "context_preview": []}

Do NOT add any text outside the JSON object. """

# ── data models ───────────────────────────────────────────────────────────────
@dataclass
class QueryResult:
    answer: str
    sources: list[dict]
    context_preview: list[dict]
    raw_chunks: list[dict]   # full FAISS results (for debugging)


# ── main query function ───────────────────────────────────────────────────────
class RAGQueryEngine:
    def __init__(
        self,
        store: VectorStore | None = None,
        groq_api_key: str | None = None,
        score_threshold: float = SCORE_THRESHOLD,
        candidate_k: int = CANDIDATE_K,
    ) -> None:
        self._store           = store or VectorStore()
        self._embedder        = get_default_embedder()
        # Priority: explicit arg → .env file → shell environment
        self._api_key         = groq_api_key or _env_vars.get("GROQ_API_KEY") or os.environ.get("GROQ_API_KEY", "")
        self._score_threshold = score_threshold
        self._candidate_k     = candidate_k

        if not self._api_key:
            raise ValueError(
                "GROQ_API_KEY is not set. "
                "Export it: export GROQ_API_KEY=gsk_..."
            )

    def query(self, question: str) -> QueryResult:
        if not question.strip():
            raise ValueError("Question cannot be empty.")

        # 1. Embed question
        vec = self._embedder.embed([question])[0]

        # 2. Retrieve ALL chunks that pass the relevance threshold
        #    (up to CANDIDATE_K candidates scanned, no fixed top-k cutoff)
        raw_chunks = self._store.search_with_threshold(
            vec,
            score_threshold=self._score_threshold,
            candidate_k=self._candidate_k,
        )
        logger.info(
            "Retrieved %d relevant chunks (threshold=%.2f) for: %s",
            len(raw_chunks), self._score_threshold, question[:60],
        )

        # 3. Trim to context token budget (avoid exceeding LLM context window)
        raw_chunks = _trim_to_budget(raw_chunks, budget_chars=CONTEXT_TOKEN_BUDGET * 4)

        # 4. Build context string
        context_block = _build_context(raw_chunks)

        # 5. Call Groq
        llm_response = self._call_groq(question, context_block)

        # 6. Parse JSON
        result = _parse_response(llm_response, raw_chunks)
        return result

    def _call_groq(self, question: str, context: str) -> str:
        user_message = f"Context:\n{context}\n\nQuestion: {question}"

        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type":  "application/json",
        }
        payload = {
            "model":       GROQ_MODEL,
            "max_tokens":  MAX_TOKENS,
            "temperature": 0.0,   # deterministic for RAG
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": user_message},
            ],
        }

        with httpx.Client(timeout=30) as client:
            resp = client.post(GROQ_API_URL, headers=headers, json=payload)
            resp.raise_for_status()

        return resp.json()["choices"][0]["message"]["content"]


# ── helpers ───────────────────────────────────────────────────────────────────
def _trim_to_budget(chunks: list[dict], budget_chars: int) -> list[dict]:
    """
    Keep chunks in score order until the cumulative content length would
    exceed budget_chars.  Ensures we never overflow the LLM context window
    even when many chunks pass the similarity threshold.
    """
    kept, total = [], 0
    for chunk in chunks:          # already sorted best-score-first
        content_len = len(chunk.get("content", ""))
        if total + content_len > budget_chars:
            break
        kept.append(chunk)
        total += content_len
    if len(kept) < len(chunks):
        logger.info("Context trimmed: kept %d/%d chunks within %d-char budget",
                    len(kept), len(chunks), budget_chars)
    return kept


def _build_context(chunks: list[dict]) -> str:
    """Format FAISS results into the [CHUNK] block the system prompt expects."""
    parts = []
    for chunk in chunks:
        parts.append(
            f"[CHUNK]\n"
            f"source: {chunk.get('source', 'unknown')}\n"
            f"page: {chunk.get('page', 0)}\n"
            f"chunk_id: {chunk.get('chunk_id', '')}\n"
            f"relevance_score: {chunk.get('_score', 0):.3f}\n"
            f"content:\n{chunk.get('content', '')}\n"
        )
    return "\n".join(parts)


def _parse_response(raw: str, chunks: list[dict]) -> QueryResult:
    """Parse LLM JSON output — with a safe fallback if malformed."""
    # Strip markdown fences if the model adds them despite instructions
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```")[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
    cleaned = cleaned.strip()

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning("LLM returned non-JSON: %s", raw[:200])
        data = {
            "answer": "I don't know based on the provided documents.",
            "sources": [],
            "context_preview": [],
        }

    return QueryResult(
        answer          = data.get("answer", ""),
        sources         = data.get("sources", []),
        context_preview = data.get("context_preview", []),
        raw_chunks      = chunks,
    )
