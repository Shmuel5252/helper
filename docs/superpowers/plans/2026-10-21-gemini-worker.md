# Gemini account worker implementation plan

> Use executing-plans in this session. The owner explicitly authorized completing and deploying the free integration; do not ask again for plan or deployment approval.

**Goal:** Phone requests produce Gemini website media on the existing Oracle host and retain originals in the private archive.
**Architecture:** Existing Next routes enqueue atomic Supabase jobs. A single outbound-polling worker attaches to the owner's dedicated local Chromium profile. Scoped upload URLs carry originals directly to Storage. There is no paid API fallback.
**Tech stack:** Next 16, Postgres RPC, Node 24, Playwright CDP, systemd.
**Spec:** ../specs/2026-10-21-gemini-account-bridge-design.md

## Global constraints
- Existing free chat, OpenArt and explicit API paths remain functional.
- No payment, plan upgrade, cookie export, security bypass, or public debugging port.
- Only the current job's attachments and output paths are available to the worker.
- Submission intent precedes Send; expired submitted jobs become uncertain, never resubmitted.
- Device isolation and owner-only archive remain. No archive badges in ordinary chat.

## Tasks
1. Queue and contract: add account model keys, authenticated worker protocol, transactional enqueue/claim/renew/finish SQL, stale-job expiry, immutable output reservation and deferred deletion cleanup. Test invalid token/model/source/file, no paid confirmation for account models, atomic claims and expired leases.
2. UI and server: branch start/refresh away from API, dynamic model availability with account defaults, reuse media through current provider, owner connection status. Run unit suite, typecheck and build.
3. Worker: deterministic visible controls, fresh source chat, attachment upload, persist intent/source, bounded wait, original download, hash/upload/finish retry. UI changes/challenges stop. Install as unprivileged service, attach only loopback CDP. Test lifecycle with fakes and actual signed-in browser.
4. Deploy: apply additive migration, configure a separate worker secret, deploy to existing Vercel project. Test an image and video through the actual queue, archive readback and unrelated-device denial. Review full changes before reporting completion.

## Review focus
- Lost acknowledgement after Send: no duplicate generation.
- Expired claim or deleted chat: cannot complete or resurrect output.
- Quota/challenge/missing control: no paid fallback or fabricated success.
- Input/output isolation: no arbitrary URL fetch or other chat attachment access.
- Offline server: new account jobs unavailable, old jobs reach a bounded terminal state.

## Progress / rulings
- Login verified visually in regular Chromium; image and video controls are visible.
- Ruling: preserve this dirty working tree containing the deployed archive; no unrelated reset or commit. User explicitly requested continuing this implementation in the shared project.
- Ruling: after a crashed submitted job, mark uncertain instead of automatic source recovery. This sacrifices recovery convenience to prevent duplicates; source URL is retained for owner diagnostics.
- Queue, authenticated worker protocol, UI, additive migrations 003/004/005 and
  production deployment are implemented. Production deployment
  `dpl_6MJTT2inE5U2dMMf9tEAmu2m8Tos` is READY.
- 71 application tests, nine worker/download/lease tests, typecheck and lint pass.
  Live SQL tests pass for ownership, duplicate requests, single claim, expiry,
  submitted-job deletion fencing and deleted-chat non-resurrection.
- Actual image generation, private Storage hash readback, owner archive rendering
  and unrelated-device denial passed. Existing MP4 download check passed.
- Live fixes: scope Hebrew tool selection to the menu; select existing Pro for
  videos; use browser CDP download events correlated with page download events
  (popup frame IDs differ); avoid removing local history during creation's 404
  window. No paid API fallback or paid infrastructure enabled.
- Explicit owner maintenance recovery is now supported for failed jobs with
  saved source URLs and no reserved output. It never submits a generation;
  automatic source recovery remains disabled. Live SQL tests cover recovery
  fencing, old-token rejection and deleted-chat rejection.
- Two video originals and an image were recovered through the normal worker;
  the final flower video also passed hash/access checks and inline playback to
  completion in the mobile viewport. Temporary health/renewal transport errors
  no longer revoke valid claims; server rejection and actual expiry still do.
- Final read-only review of lease and source-only recovery found no blocker.
- Final fresh-generation verification is limited by Gemini's disabled video
  tool and visible usage-limit warning. The job stopped before Send; existing
  generated videos are archived and playable. Account quota is external to the
  integration and no upgrade/fallback was attempted.
