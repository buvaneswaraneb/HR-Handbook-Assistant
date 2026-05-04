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
from datetime import datetime
from pathlib import Path

from dotenv import dotenv_values


# ── custom hourly rotating handler ────────────────────────────────────────────
class HourlyRotatingHandler(logging.FileHandler):
    """Creates a new log file every hour with format: dd-mm-yy-hh:00.log"""
    
    def __init__(self, log_dir: Path, backupCount: int = 24):
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.backupCount = backupCount
        self.last_hour = None
        
        # Create initial filename
        self._generate_filename()
        try:
            super().__init__(str(self.current_filepath), encoding='utf-8')
        except Exception as e:
            print(f"Error initializing logging handler: {e}")
            raise
    
    def _generate_filename(self):
        """Generate filename based on current hour with :00 for minutes."""
        now = datetime.now()
        self.last_hour = (now.year, now.month, now.day, now.hour)
        # Create filename with :00 so all logs in the same hour use the same file
        # e.g., 13:15 → 04-05-26-13:00.log, 13:59 → 04-05-26-13:00.log
        date_hour = now.strftime("%d-%m-%y-%H")
        self.current_filepath = self.log_dir / f"{date_hour}:00.log"
    
    def emit(self, record: logging.LogRecord) -> None:
        """Check if hour changed and rotate if needed."""
        try:
            now = datetime.now()
            current_hour = (now.year, now.month, now.day, now.hour)
            
            # If hour changed, rotate to new file
            if current_hour != self.last_hour:
                self.doRollover()
            
            super().emit(record)
        except Exception as e:
            print(f"Error in logger emit: {e}")
            self.handleError(record)
    
    def doRollover(self):
        """Close current file and open a new one."""
        try:
            # Close the current stream and file
            if self.stream:
                self.flush()
                self.stream.close()
            
            # Generate new filename for the new hour
            self._generate_filename()
            self.baseFilename = str(self.current_filepath)
            
            # Open the new file
            self.stream = self._open()
        except Exception as e:
            print(f"Error in doRollover: {e}")
            raise


# ── configure logging ─────────────────────────────────────────────────────────
LOGS_DIR = Path(__file__).resolve().parent.parent.parent / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)

# Configure root logger
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

# Clear any existing handlers to avoid duplicates
logger.handlers.clear()

# Hourly rotating file handler
try:
    hourly_handler = HourlyRotatingHandler(LOGS_DIR, backupCount=168)  # keep 7 days of logs
    hourly_handler.setLevel(logging.DEBUG)
    file_formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    hourly_handler.setFormatter(file_formatter)
    logger.addHandler(hourly_handler)
    print(f"✓ Logger initialized - logs will be saved to: {LOGS_DIR}")
except Exception as e:
    print(f"✗ Failed to initialize logger: {e}")

# Console handler (optional, for development)
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.INFO)
console_formatter = logging.Formatter('%(levelname)s - %(message)s')
console_handler.setFormatter(console_formatter)
logger.addHandler(console_handler)

# ── load .env anchored to its real location ───────────────────────────────────
# __file__ == backend/app/services/rag/query.py
# .parent        == backend/app/services/rag/
# .parent.parent == backend/app/services/          ← where .env lives
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
_env_vars = dotenv_values(_ENV_FILE)   # returns {} if file not found (no crash)

import httpx

from app.services.ingestion.embedder import get_default_embedder
from app.services.ingestion.vector_store import VectorStore

# ── config ────────────────────────────────────────────────────────────────────
GROQ_API_URL     = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL       = "llama-3.1-8b-instant"  # adjust as needed; check Groq docs for available models
MAX_TOKENS       = 1024
BATCH_SIZE       = 10     # max chunks per API call to avoid 413 payload errors

# Retrieval settings
SCORE_THRESHOLD  = 0.30   # min cosine similarity to include a chunk (0–1)
CANDIDATE_K      = 5     # how many candidates FAISS returns before filtering
CONTEXT_TOKEN_BUDGET = 4_000  # ~4 chars per token; trim context if too long

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

SYNTHESIS_PROMPT = """ You are an HR assistant synthesizing answers from multiple document batches.

Your task: Combine the following batch results into one coherent, accurate final answer.

RULES:
1. Synthesize all batch answers into a single comprehensive answer.
2. Avoid repeating information.
3. Keep citations from sources that directly support the final answer.
4. If batch results conflict, prioritize higher relevance scores.
5. If NO batch has a definitive answer, return the standard "I don't know" response.

OUTPUT FORMAT — return ONLY valid JSON:
{
  "answer": "<synthesized final answer>",
  "sources": [
    {"file": "<filename>", "page": <number>, "chunk_id": "<chunk_id>"}
  ],
  "context_preview": [
    {"text": "<excerpt max 200 chars>", "file": "<filename>", "page": <number>}
  ]
}

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
        raw_chunks = self._store.search_with_threshold(
            vec,
            score_threshold=self._score_threshold,
            candidate_k=self._candidate_k,
        )
        logger.info(
            "Retrieved %d relevant chunks (threshold=%.2f) for: %s",
            len(raw_chunks), self._score_threshold, question[:60],
        )

        # 3. Trim to context token budget
        raw_chunks = _trim_to_budget(raw_chunks, budget_chars=CONTEXT_TOKEN_BUDGET * 4)

        # 4. Process chunks in batches of BATCH_SIZE to avoid 413 Payload Too Large
        batch_results = []
        num_batches = (len(raw_chunks) + BATCH_SIZE - 1) // BATCH_SIZE
        
        for batch_idx in range(num_batches):
            start_idx = batch_idx * BATCH_SIZE
            end_idx = min(start_idx + BATCH_SIZE, len(raw_chunks))
            batch_chunks = raw_chunks[start_idx:end_idx]
            
            logger.info(
                "Processing batch %d/%d (%d chunks)",
                batch_idx + 1, num_batches, len(batch_chunks)
            )
            
            # Build context for this batch
            context_block = _build_context(batch_chunks)
            
            # Estimate token count
            token_count = _estimate_token_count(SYSTEM_PROMPT, question, context_block)
            logger.debug(
                "Batch %d token estimation: ~%d tokens",
                batch_idx + 1, token_count
            )
            
            # Call Groq for this batch
            llm_response = self._call_groq(question, context_block)
            batch_result = _parse_response(llm_response, batch_chunks)
            batch_results.append(batch_result)

        # 5. Synthesize results from all batches
        if num_batches == 1:
            # Only one batch, return as-is
            final_result = batch_results[0]
        else:
            # Multiple batches: synthesize into final answer
            logger.info("Synthesizing %d batch results into final answer", num_batches)
            final_result = self._synthesize_batch_results(question, batch_results, raw_chunks)

        return final_result

    def _synthesize_batch_results(
        self, question: str, batch_results: list[QueryResult], all_chunks: list[dict]
    ) -> QueryResult:
        """
        Synthesize answers from multiple batches into a single final answer.
        Calls Groq one more time with batch summaries.
        """
        # Build a summary of all batch results for synthesis
        batch_summaries = []
        all_sources = []
        all_previews = []
        
        for idx, result in enumerate(batch_results):
            batch_summaries.append(f"Batch {idx + 1}: {result.answer}")
            all_sources.extend(result.sources)
            all_previews.extend(result.context_preview)
        
        synthesis_input = (
            f"Question: {question}\n\n"
            "Batch Results:\n"
            + "\n".join(batch_summaries) +
            "\n\nCombine these batch answers into a single, coherent response. "
            "Use all relevant sources cited in the batches."
        )
        
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": GROQ_MODEL,
            "max_tokens": MAX_TOKENS,
            "temperature": 0.0,
            "messages": [
                {"role": "system", "content": SYNTHESIS_PROMPT},
                {"role": "user", "content": synthesis_input},
            ],
        }
        
        try:
            with httpx.Client(timeout=30) as client:
                resp = client.post(GROQ_API_URL, headers=headers, json=payload)
                resp.raise_for_status()
            llm_response = resp.json()["choices"][0]["message"]["content"]
        except Exception as e:
            logger.error("Synthesis call failed: %s. Returning first batch result.", e)
            return batch_results[0]
        
        # Parse synthesis response
        result = _parse_response(llm_response, all_chunks)
        
        # Merge sources (deduplicate if needed)
        if not result.sources:
            result.sources = all_sources
        if not result.context_preview:
            result.context_preview = all_previews
        
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


def _estimate_token_count(system_prompt: str, question: str, context: str) -> int:
    """
    Estimate token count for system prompt + question + context.
    Uses a simple ~1 token per 4 characters approximation.
    For production, consider using tiktoken: pip install tiktoken
    """
    total_text = system_prompt + question + context
    # Rough estimation: ~4 characters per token for English text
    estimated_tokens = len(total_text) // 4
    return estimated_tokens
