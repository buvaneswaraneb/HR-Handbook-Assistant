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

import httpx
from dotenv import load_dotenv

from app.services.ingestion.embedder import get_default_embedder
from app.services.ingestion.vector_store import VectorStore

logger = logging.getLogger(__name__)

# Load .env from backend/app/services/.env
# __file__ is backend/app/services/rag/query.py
# .parent       == backend/app/services/rag/
# .parent.parent == backend/app/services/
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=_ENV_FILE, override=False)   # override=False → shell env wins

# ── config ────────────────────────────────────────────────────────────────────
GROQ_API_URL  = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL    = "llama-3.1-8b-instant"
TOP_K         = 5          # chunks retrieved from FAISS
MAX_TOKENS    = 1024

SYSTEM_PROMPT = """You are an internal HR assistant.
Your task is to answer questions using ONLY the provided context from company documents.

RULES (STRICT):
1. Use ONLY the given context.
2. Do NOT use outside knowledge.
3. If the answer is not present, respond with the exact JSON edge-case below.
4. Be concise and precise (max 4-6 sentences).
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

Do NOT add any text outside the JSON object."""


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
        top_k: int = TOP_K,
    ) -> None:
        self._store      = store or VectorStore()
        self._embedder   = get_default_embedder()
        self._api_key    = groq_api_key or os.environ.get("GROQ_API_KEY", "")
        self._top_k      = top_k

        if not self._api_key:
            raise ValueError(
                "GROQ_API_KEY is not set. "
                f"Add it to {_ENV_FILE} or export it in your shell."
            )

    def query(self, question: str) -> QueryResult:
        if not question.strip():
            raise ValueError("Question cannot be empty.")

        # 1. Embed question
        vec = self._embedder.embed([question])[0]

        # 2. Retrieve top-k chunks from FAISS
        raw_chunks = self._store.search(vec, k=self._top_k)
        logger.info("Retrieved %d chunks for question: %s", len(raw_chunks), question[:60])

        # 3. Build context string
        context_block = _build_context(raw_chunks)

        # 4. Call Groq
        llm_response = self._call_groq(question, context_block)

        # 5. Parse JSON
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
def _build_context(chunks: list[dict]) -> str:
    """Format FAISS results into the [CHUNK] block the system prompt expects."""
    parts = []
    for chunk in chunks:
        parts.append(
            f"[CHUNK]\n"
            f"source: {chunk.get('source', 'unknown')}\n"
            f"page: {chunk.get('page', 0)}\n"
            f"chunk_id: {chunk.get('chunk_id', '')}\n"
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
