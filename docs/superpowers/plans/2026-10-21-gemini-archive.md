# Gemini archive implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement these tasks in this session.

**Goal:** Paid Gemini chat, images and video with durable private archives, preserving local chat and OpenArt.
**Architecture:** Separate /gemini composer and browser-local conversation index; server-owned Supabase conversation/turn/asset records. Google background Interactions jobs are saved before polling; a protected daily cron and browser polling copy results into private Storage.
**Tech Stack:** Next 16.4 route handlers, React, TypeScript, Supabase REST/Storage, Gemini Interactions REST.
**Spec:** docs/superpowers/specs/2026-10-21-gemini-archive-design.md

## Global constraints
- Keep existing free chat and OpenArt unchanged, including credentials and browser histories.
- No automatic cross-device chat listing; only owner archive can list all devices.
- Persist accepted original attachments and inputs before paid submission; ordinary chat must not show backup/database indicators.
- Server-only credentials; RLS, explicit service-role grants, private bucket, ownership-checked media.
- No deployment or paid smoke test implicitly claimed by local verification.

## Review focus
- Duplicate requests and uncertain network outcomes must not create a second paid job.
- Other browser identities cannot read or append to conversations or fetch files.
- Client disconnect/reload must not discard an already accepted job.
- Large/invalid uploads and failed storage must stop generation.
- Archive failure must remain retryable without resubmitting generation.

### Task 1: Storage and input contract
Files: supabase/migrations/202610210001_archive.sql; lib/archive/{types,validation,store,identity}.ts; lib/archive.test.ts.
Interfaces: Conversation, Turn, Asset; beginTurn input guarded by owner+UUID+digest; store REST requests use apikey only.
- [x] Test validation, ownership filtering, duplicate claims and output parsing with Node tests/mocks.
- [x] Implement schema, private bucket and service-role grants, atomic claim RPC.
- [x] Apply migration to user's new project; verify read/write and denied public access.

### Task 2: Gemini generation and routes
Files: lib/archive/{gemini,service,http}.ts; app/api/gemini/{config,conversations,turns,assets} routes; app/api/cron/archive/route.ts.
Interfaces: startTurn(conversationId, turnId, modelKey, text, assets); refreshTurn(id) with persisted upstream id and no automatic resubmission.
- [x] Test paid routing, persistence-before-generation, repeated requests, failed storage, denied assets and mock background completion.
- [x] Implement allowlisted chat/image/video models, background=true/store=true; durable starting state, uncertain outcome on timed-out start; poll and persist outputs atomically.
- [x] Add private range-capable file responses and cron settlement; validate same-origin mutations.

### Task 3: Local index, paid composer, protected archive
Files: components/{GeminiChat,ArchiveMessages}.tsx; app/gemini/page.tsx; app/admin/archive/page.tsx; app/api/admin/login/route.ts; components/Chat.tsx.
- [x] Add localStorage index containing only this browser's new conversation IDs; preserve original localStorage.
- [x] Build chat-style ordered transcript, model/mode selector, original uploads, explicit paid generation confirmation and pending state and generic action errors, without storage indicators.
- [x] Add owner archive list/details with original downloads and separate admin login redirect; no general archive list API.
- [x] Verify phone/desktop layout, refresh while pending, navigation isolation and login.

### Task 4: Verification and operational handoff
Files: tests/archive.int.mjs, tests/mock-archive.mjs, .env.example, docs/GEMINI-ARCHIVE.md, vercel.json.
- [x] Run unit, integration, typecheck, lint/build and relevant existing browser regression checks.
- [x] Fresh review of changed code and fix material findings.
- [x] Document admin setup, deployment env, cron, storage limits, cloud persistence versus disaster-recovery backups and live-test limitations.

## Execution ledger
- Authorization: user explicitly requested implementation; continue without re-requesting plan approval.
- Ruling: separate /gemini composer shares styling but not original Chat internals. This preserves free/OpenArt behavior and makes mode immutable per conversation.
- Ruling: all new generation uses background Interactions, documented 2026-05-20 revision. Inputs and job IDs survive disconnect; browser/cron settlement persists output. Unknown submission outcomes never automatically retry.
- Supabase schema applied; actual private database/file roundtrip and duplicate-claim probe passed and disposable probe data removed.

- Verification: 65 unit tests, archive integration suite, typecheck, lint and production build passed. Existing history and authentication browser regressions passed. Manual phone layout, reload during generation, image-to-video selection and protected owner archive verified with mocks.
- Fresh reviewer findings fixed: combine all selected documents; preserve loaded transcript on poll failure; release jobs after provider 404/410; paginate transcripts beyond 1,000 rows. Regression scenarios passed.
- Live Google test: two tiny text jobs submitted, no real image/video jobs. Polling returned HTTP 500 with a high-demand message, including retrying only the saved job. Live completed generation remains unverified; no production deployment performed.
- Remaining operational steps: production environment configuration/deployment and successful live generation verification. Current local credentials are ignored by Git; no credentials found in application/tests/docs sources.

- Existing OpenArt media browser regression suite passed on phone/desktop, light/dark, including image/video/edit, cancel/resume, quota and admin flows.
