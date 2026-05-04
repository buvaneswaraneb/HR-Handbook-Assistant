import os
import httpx

api_key = os.environ.get("GROQ_API_KEY", "")

# Load API key from env file
from dotenv import dotenv_values
env_vars = dotenv_values("backend/app/services/.env")
if "GROQ_API_KEY" in env_vars:
    api_key = env_vars["GROQ_API_KEY"]

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type":  "application/json",
}

# test with varying payload sizes
for size in [1000, 5000, 10000, 16000, 32000]:
    payload = {
        "model": "llama-3.1-8b-instant",
        "max_tokens": 1024,
        "temperature": 0.0,
        "messages": [
            {"role": "user", "content": "a" * size}
        ]
    }
    resp = httpx.post("https://api.groq.com/openai/v1/chat/completions", headers=headers, json=payload)
    print(f"Size: {size}, Status: {resp.status_code}")
    if resp.status_code != 200:
        print(resp.text)
