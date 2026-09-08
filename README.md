# StudyPilot AI — Code Excerpt

This is a **curated excerpt** from StudyPilot AI, a full-stack Generative AI
academic copilot I built as a personal project. The full application (50+
pages, onboarding flow, adaptive accessibility engine, etc.) is kept in a
private repository; this repo shares only a selection of the engineering —
the parts most relevant to demonstrate technical range — so it is not a
runnable app on its own.

## What StudyPilot AI does

A subject-agnostic study copilot: it reads material a student uploads
(lecture notes, past assessments), builds a knowledge map of what they do
and don't understand, generates practice assessments, answers questions
grounded in their own course material, and puts together a study plan
around it.

## What's in this excerpt

**`lib/rag/`** — the retrieval-augmented generation pipeline:
- `chunking.ts` — splits ingested material into retrievable chunks
- `embedding-service.ts` — Gemini embeddings (`gemini-embedding-001`), batched
- `ingestion.ts` — turns uploaded material into stored, embedded chunks
- `retrieval.ts` — scoped semantic search: tries MongoDB Atlas `$vectorSearch`
  first, falls back to brute-force cosine similarity if the vector index
  isn't ready yet
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

**`lib/document-extraction.ts`** — multi-format ingestion: detects real file
type from byte signature, then extracts text from PDF (with OCR fallback for
image-only PDFs), DOCX (mammoth), PPTX (raw XML via JSZip), images
(Tesseract OCR), and RTF.

**`lib/db.ts`** — MongoDB Atlas connection handling and vector index setup.

**`lib/scheduling-engine.ts`** — a deterministic (non-LLM) study-plan
scheduler that replans after a poor assessment result.

**`lib/youtube.ts`** — external API integration: queries the YouTube Data
API for supplementary videos on extracted concepts, with ranking and
de-duplication.

**`lib/calendar-mock.ts`** — a clearly-labeled mock third-party integration
(Google Calendar), shaped so swapping in a real OAuth flow later is a
body-only change.

**`lib/jwt-edge.ts`** + **`middleware.ts`** — session handling with signed
JWTs (`jose`) and Next.js edge middleware for route protection.

**`app/api/`** — three representative Next.js API routes showing how the
above gets wired into real endpoints (`ai/analyze`, `ai/tutor`, `rag/search`).

## Tech stack

Next.js · React · TypeScript · Gemini API · MongoDB Atlas Vector Search ·
Tesseract OCR · JWT auth · Vitest

## Note

This repo is intentionally partial and will not run standalone (no UI, full
auth flow, or environment config included). It exists to make the
engineering easy to review without needing to clone or run the full product.
