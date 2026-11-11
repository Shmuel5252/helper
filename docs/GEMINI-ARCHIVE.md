# Gemini and owner archive

The existing `/` chat keeps its existing provider, local history and OpenArt flow.
`/gemini` uses the signed-in Gemini browser account and stores its complete conversation
in the owner's Supabase project. Its localStorage index only contains conversation
IDs created in that browser. Another browser starts with an empty list. Ordinary
chat contains no backup, tracking or database indicators, per the owner's preference.

## Setup

1. Apply `supabase/migrations/202610210001_archive.sql` to the intended Supabase project.
2. Configure server-only `GEMINI_WORKER_SECRET`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
   `ADMIN_CODE`, and `CRON_SECRET` in the deployment environment. Preserve the
   existing `AI_*`, `ACCESS_CODE` and OpenArt/Redis settings. Never use NEXT_PUBLIC.
3. Deploy the application. Local `.env.local` values are not uploaded by Git.
4. Visit `/gemini`; owner archive is `/admin/archive`, protected with `ADMIN_CODE`.
   The code is shared with the existing OpenArt administration, never with visitors.
5. Confirm the scheduled `/api/cron/archive` task runs on the deployed host, using
   `Authorization: Bearer <CRON_SECRET>`. The included Vercel schedule is daily;
   browser polling checks active conversations every five seconds. For heavier use,
   configure a more frequent external scheduler, within your host's plan limits.

`node --env-file=.env.local scripts/check-archive.mjs --probe` verifies actual
database writes, duplicate request claims, private file writes and reads. It removes
only its own randomly named temporary probe records/files and never calls Gemini.

## Retention and recovery

- Original accepted files (up to 4MB each), extracted document text, ordered user
  messages, answers and generated media are stored. Generated files up to 50MiB are
  copied into the private `chat-archive` bucket; access always goes through the app.
- PostgreSQL stores metadata, original text and results; actual files are in Storage.
  Cloud persistence is not a separate disaster-recovery backup. Arrange exports of
  both PostgreSQL and Storage for recovery from deletion or account loss. Database
  backups alone do not include Storage object bytes.
- Generation uses the signed-in Oracle browser worker only (account-image/video).
  The paid API client and model choices have been removed. Old client submissions
  using API model keys are rejected, even with a payment-confirmation flag.
- Legacy API pending turns are retired locally on refresh/cron. No provider calls
  are made, no messages are appended, and existing files/results are preserved.
- The worker continues after a browser closes, saves results to private Storage,
  and never automatically resubmits a request with an uncertain outcome.
- See ORACLE-GEMINI-HOST.md for worker setup and recovery. No API fallback exists.
- No bulk migration of old free chats; switching pages does not upload them. Clearing
  browser data loses its local index/identity; the protected owner archive still has
  the server conversations. There is no per-device recovery-code workflow.

## Verification

- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
- Start `node tests/mock-archive.mjs` and `node tests/start-delete-test-app.mjs`,
  then `node tests/archive.int.mjs` and `node tests/chat-delete.int.mjs`.
- Test runner always overrides Gemini and Supabase credentials/endpoints with mocks.
- Tests are local only. Never generate prompts in user conversations for verification.

## Historical API release notes (superseded 2026-10-22)

The paid Gemini API connection was removed on 2026-10-22. Notes below describe
older deployments, not the current account-only flow.

References checked 2026-10-21:
- https://ai.google.dev/gemini-api/docs/background-execution
- https://ai.google.dev/gemini-api/docs/omni
- https://ai.google.dev/gemini-api/docs/image-generation
- https://supabase.com/docs/guides/getting-started/api-keys

Production release 2026-10-21: the current working tree was deployed directly through Vercel to project `helper`, deployment `dpl_A5zjxXV6Qvwr1Fz1YfE5YRK3xtpB` (READY), at https://helper-zeta-eight.vercel.app. This release includes uncommitted local changes; it is not represented by the earlier Git HEAD alone. Production access/admin codes, cron secret and Gemini/Supabase settings were synchronized without exposing provider credentials. Existing OpenArt settings were preserved. Login using the local access code succeeds, unauthenticated Gemini configuration returns 401, authenticated configuration reports available, and owner archive access succeeds. The free chat returned the requested response on the live site. Mobile viewport 390x844 has no horizontal overflow; chat switching and archived image/video loading work. This is desktop browser mobile emulation, not a physical-phone test.

Google media status at release: reading the existing image request still returns HTTP 429, Free Tier limit 0 requests/day for Nano Banana 2.1. Automatic browser-account generation is not implemented. The successful Gemini website image/video proof was imported to the private archive separately; it does not establish API billing readiness. A previous API text job returned provider high-demand 500. Vercel build status is READY; detailed build-log retrieval through the connector was denied by its team scope.

UI verification 2026-10-21: removed opening prompt cards; added shared subtle welcome artwork, immediate generation placeholder, inline image enlargement and video playback, optional save action and retryable preview errors. Verified pending state survives refresh, image preview is 640px source (not the previous 1px fixture), dialog closes on Escape, and MP4 plays to completion (5.055 seconds, no media error) at 390px viewport. Unit suite: 65 passed; archive integration, typecheck, lint and production build passed. Google status page showed All Systems Operational; GET of the existing live text job returned the same high-demand 500 on both v1 and v1beta directly. This does not establish a global incident or diagnose account-specific capacity.

Live paid-image attempt 2026-10-21: user authorized a real image test. Submitted one Nano Banana 2.1 job through the application, persisting its conversation/turn in actual Supabase. Google GET returned HTTP 429: Free Tier limit 0 requests/day for this model. AI Studio API Keys also shows Set up billing / Free tier for the key's Default Gemini Project. No generated asset was returned or saved. Earlier demo assets were local fixtures only. The test state is ignored under test-screenshots/paid-image-smoke.json to avoid duplicate submissions. Billing activation is required; the previous text-model 500 is not evidence of a global incident.

## Account-only release 2026-10-22

Deployment `dpl_4MgSNqQ6WaoB9uCLrNEGPKhMkhGR` is READY. The public site
https://helper-zeta-eight.vercel.app reports only `account-image` and `account-video`,
with the account worker ready. The separate paid Gemini key was removed from local
configuration and the Vercel project; the API client, paid choices and live API probe
were removed. The Google credential itself was not revoked at its issuer, and old
immutable deployments were not modified. Do not roll back to a historical API release.

Validation: 69 unit tests; typecheck and lint; local archive integration verifies
retired model rejection (including old billing confirmation), zero provider submissions
or polling, preserved existing output, archive isolation and cleanup. Local chat deletion
integration also passed. Production verification read configuration and page UI only;
no generation or development messages were submitted to real conversations.
