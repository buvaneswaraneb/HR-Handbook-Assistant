import os
from dotenv import load_dotenv
from groq import Groq
from groq.types.chat import ChatCompletionMessageParam

load_dotenv()
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

messages: list[ChatCompletionMessageParam] = [
    {"role": "system", "content": "You are a helpful assistant."}
]

print("🤖 Chatbot started (type 'exit' to quit)\n")

while True:
    user_input = input("You: ")

    if user_input.lower() == "exit":
        print("Bot: Goodbye!")
        break

    messages.append({"role": "user", "content": user_input})

    response = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=messages
    )

    reply = response.choices[0].message.content
    messages.append({"role": "assistant", "content": reply})

    print("Bot:", reply, "\n")