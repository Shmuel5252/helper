# fal media migration — 2026-11-11

## Scope and current state

The owner approved fal for both images and videos, with retirement of the Gemini
creation bridge **after** verified live generations and archive persistence.
Text chat remains on its existing provider. Historical archive rows, object IDs,
Google conversations, and local conversation contents are not migrated or deleted.
The owner subsequently authorized one image and one video test up to $0.50.
Both were submitted once through the production chat UI and completed successfully.

The local `.env.local` received FAL_KEY through fal's approved device flow.
Presence is confirmed; it does **not** prove generation access or credit balance.
The screenshot supplied by the owner requests completion of billing/credits.
Vercel account access was renewed. After explicit owner approval for Production
of `helper` / team `shmuel5252s-projects`, a separate fal deployment key was
authorized through fal's browser flow and piped directly to Vercel as a sensitive
Production variable. Its presence and target were verified without decrypting it.
Production uses `MEDIA_PROVIDER=fal` and `FAL_MEDIA_ENABLED=true`.
The owner requested removal of the application's daily allowance on 2026-11-11;
the implementation no longer reads `FAL_DAILY_LIMIT_USD` or uses a Redis counter.
Provider balance and provider-side limits still apply. Exhausted balance/payment
and quota failures display `לא הצלחנו ליצור.` and do not trigger automatic retries.
Deployment `dpl_DQMnugxg3qH8n5U3bJwfwNA3N9zj` was verified READY before this change
at the existing `https://helper-zeta-eight.vercel.app` alias. Same access code and
unified chat verified. Gemini worker credential was removed from Production and
its old credential now receives 401 at the canonical worker endpoint.

## Activation

- `MEDIA_PROVIDER=account` (default): existing Gemini image/video path remains.
- `MEDIA_PROVIDER=fal` with `FAL_MEDIA_ENABLED=true`: new media requests use fal.
- `FAL_KEY`: server-only API credential, never shipped to client/browser.
- `FAL_PUBLIC_ORIGIN`: canonical HTTPS app origin; callbacks go to `/api/fal/webhook`.
- No application daily spending cap or automatic top-up. `FAL_MEDIA_ENABLED=false`
  remains the separate switch for disabling new fal submissions.

Fixed allowlisted endpoints/settings:

- Image: `fal-ai/flux-2/klein/4b`, one 1024x1024 JPEG, four inference steps.
- Edit: `fal-ai/flux-2/klein/4b/edit`, same output settings; up to four input images.
- Video: `minimax/h3-max-turbo/text-to-video` or `/image-to-video`, 5 seconds,
  768P, balanced prompt expansion; at most one initial image.
- No automatic provider/model fallback. The daily-cap update preserves the
  owner's existing provider settings from commit `fb85ac5`.

The canonical UI remains unchanged. Composer selection is loaded from the server;
old Gemini creation requests are rejected after cutover, requiring refresh.
Existing `/api/gemini/assets/*` and conversation routes intentionally remain for
old bookmarks and media references; their names do not imply new Gemini calls.

## Persistence and failure behavior

`archive_begin_turn` atomically reserves the client request ID before a billable
submission. Retries of that ID return its stored state without resubmission.
An ambiguous submission becomes uncertain and is not automatically sent again.
Provider endpoint/request/status/result URLs are stored in private provider_id
metadata and stripped from public transcripts.

fal webhooks require an Ed25519 signature, a timestamp within five minutes, and
matching signed provider request ID. JWKS is fetched only from the official origin.
The callback obtains the result through the authenticated queue API; media URLs
are restricted to HTTPS fal.media hosts, redirects disallowed, and credentials
never forwarded to file downloads. Downloads are limited to 50 MiB and checked
against image/video signatures. The deterministic private Supabase object and
metadata are written before completion is reported. Polling and the existing
daily archive cron can recover when delivery fails. Repeated delivery is idempotent.

Ordinary local chat deletion retains the entire archive. The owner's separate
permanent archive deletion workflow continues to behave as before.

## Validation and remaining release gate

- `node --test lib/fal.test.ts`: protocol/URL/safety/signature/bounds/no-retry checks.
- `npm test`: existing regressions plus fal tests.
- `npm run typecheck`; targeted eslint on new server code.
- `tests/fal.int.mjs` against `tests/start-fal-test-app.mjs`, mock-archive,
  mock-upstash and mock-fal: real Next routes, no real credentials/external calls.
  Covers image/video, image input, callback with no client polling, duplicate
  callback/submission, transient archive outage, refusals, insufficient credits,
  uncertain submit, legacy client rejection, archive retention and repeated
  submissions beyond the former daily allowance. All test generations are mocked.
- Normal local Turbopack build hit a Windows CSS worker startup failure; an isolated
  webpack build with the same source and in-process Tailwind provides a separate
  build check. Vercel's own production build also completed successfully.

Initial migration results (before the owner's subsequent provider-setting change):
all 92 tests passed, including historical-fal import regression.
Typecheck and targeted eslint passed.
Isolated end-to-end test passed including the archive-outage recovery case.
Isolated webpack production build passed on retry, after Next emitted a security
advisory for the existing Next 16.4.0 dependency. That advisory remains unresolved;
do not describe the installed version as security-verified.

## Live verification — 2026-11-11

Daily-cap removal validation: `lib/fal-errors.test.ts`, typecheck, targeted eslint,
and the isolated route integration passed. The integration covers eight video
submissions beyond the former allowance and generic exhausted-credit errors.
No paid generations or existing conversation changes were made for this update.
The obsolete Production `FAL_DAILY_LIMIT_USD` variable was removed.

- New test conversation: `875933af-bfb5-59d1-9259-81c3ca5935f2`.
- Image turn `cc96630a-50a7-43a4-916e-263c45ce48e4`: completed, JPEG 1,050,827 bytes.
- Image-to-video turn `d6a0a926-5a3d-4a74-8afb-7b7fd77e87c2`: completed,
  MP4 5,491,230 bytes, 768x768, 5.184 seconds. Browser playback reached the end
  without a media error. Only one generation request of each kind was sent.
- Production chat restored both after reload. Owner archive visibly shows both
  prompts, original image and video. Private Supabase objects are readable and
  match recorded sizes; SHA256 evidence is in ignored `test-screenshots/fal-live-report.json`.
- All 28 pre-existing conversations, 56 turns and 33 assets retain their baseline
  hashes. No existing conversation was edited or deleted by the test.
- fal dashboard lists the same two completed request IDs and estimated total $0.15.
  This is a dashboard estimate, not a separately retrieved final invoice.
- Safety checks remain enabled; no automatic retry on refusal or unknown submission.
- Archive's connection label now reflects fal, with no layout change.

## Remaining Oracle shutdown

The production creation connection is disconnected. SSH to the pinned host timed
out and Oracle console redirected to sign-in, so stopping/disabling the VM's worker
and browser services was not possible in this session. Do not claim the VM is off.
After account access is restored, stop only those creation services. Do not
terminate/delete the VM, disks, Google history or OpenArt account without an explicit
request. Text chat remains on its existing Google API connection.
