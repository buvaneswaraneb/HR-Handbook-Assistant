import os
import httpx
from dotenv import load_dotenv

load_dotenv("backend/app/services/.env")
api_key = os.environ.get("GROQ_API_KEY")

def test_groq(prompt_len):
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": "llama-3.1-8b-instant",
        "messages": [{"role": "user", "content": "A" * prompt_len}]
    }
    resp = httpx.post(url, headers=headers, json=payload)
    print(f"Length {prompt_len}: Status {resp.status_code}, {resp.text}")

test_groq(24000)
test_groq(50000)
test_groq(100000)
