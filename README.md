# StudyPilot AI — Code Excerpt (RAG & LLM Orchestration)

This is a **curated excerpt** from StudyPilot AI, a full-stack Gen AI academic
copilot I built for the EUI GenAI Hackathon. The full application (50+ pages,
auth, onboarding, accessibility engine, mock calendar integration, etc.) is
kept in a private repository; this repo shares only the Generative AI
engineering — the part most relevant to demonstrate for an AI-focused role —
so it's not a runnable app on its own.

## What StudyPilot AI does

A subject-agnostic study copilot: it reads what a student uploads (lecture
notes, past assessments), figures out what a professor emphasizes, tests the
student on it, finds real knowledge gaps, and builds a study plan around how
they personally learn.

## What's in this excerpt

**`lib/rag/`** — the retrieval-augmented generation pipeline:
- `chunking.ts` — splits ingested material into retrievable chunks
- `embedding-service.ts` — Gemini embeddings (`gemini-embedding-001`), batched
- `ingestion.ts` — turns uploaded material into stored, embedded chunks
- `retrieval.ts` — course/student-scoped semantic search: tries MongoDB Atlas
  `$vectorSearch` first, falls back to brute-force cosine similarity if the
  vector index isn't ready yet
- `context-builder.ts` — assembles retrieved chunks into grounded LLM context
- `eval/dataset.ts` — a small evaluation set used to sanity-check retrieval
  quality, not just eyeball it
- Matching `.test.ts` files for each module

**`lib/ai/`** — the LLM orchestration layer:
- `orchestrator.ts` — routes requests to a provider, with typed inputs/outputs
- `providers/gemini-provider.ts`, `providers/openai-provider.ts` — swappable
  provider implementations behind one interface
- `prompts.ts`, `schemas.ts`, `types.ts`, `config.ts`, `modes.ts` — prompt
  templates, structured-output schemas, and provider configuration

**`lib/db.ts`** — MongoDB Atlas connection handling and vector index setup.

**`lib/scheduling-engine.ts`** — a deterministic (non-LLM) study-plan
scheduler that replans after a poor assessment result — included to show the
non-AI algorithmic side of the app too.

**`app/api/`** — three representative Next.js API routes showing how the
above gets wired into real endpoints (`ai/analyze`, `ai/tutor`, `rag/search`).

## Tech stack

Next.js · TypeScript · Gemini API · MongoDB Atlas Vector Search · Vitest

## Note

This repo is intentionally partial and will not run standalone (no UI, auth,
or environment config included). It exists to make the RAG/LLM engineering
easy to review without needing to clone or run the full product.
