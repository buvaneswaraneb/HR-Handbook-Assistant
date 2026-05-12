# Docker Setup

This Docker setup runs the Osmium FastAPI backend. The frontend is static and can stay on GitHub Pages.

## Files

- `Dockerfile` builds the backend API image.
- `docker-compose.yml` runs the backend locally.
- `.dockerignore` keeps local secrets, caches, and generated files out of the image.

## Requirements

Create one root `.env` file before running Docker. The app no longer uses `backend/app/services/.env`.

Required values include:

```env
SUPABASE_URL=
SUPABASE_KEY=
SUPABASE_ANON_KEY=
SUPABASE_JWT_SECRET=
GROQ_API_KEY=
GROQ_MODEL=llama-3.1-8b-instant
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_FOLDER=hr-assistant
FRONTEND_URL=
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=
```

## Run Locally

Build and start the backend:

```bash
docker compose up --build
```

Open the health check:

```bash
curl http://localhost:8000/health
```

Expected response:

```json
{"status":"ok"}
```

Stop the backend:

```bash
docker compose down
```

Remove the runtime volume too:

```bash
docker compose down -v
```

## Run Without Compose

Build:

```bash
docker build -t osmium-backend .
```

Run:

```bash
docker run --env-file .env -p 8000:8000 osmium-backend
```

## Render Docker Settings

If using Render with Docker:

- Environment: Docker
- Dockerfile Path: `Dockerfile`
- Docker Build Context Directory: `.`
- Health Check Path: `/health`

Set all `.env` values in the Render dashboard. Do not upload the local `.env` file.
