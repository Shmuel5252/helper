# Gemini account media bridge

Status: proposed architecture; not implemented or enabled. The owner has requested
image/video generation from the deployed mobile chat through their Gemini website
account, with complete conversations retained in the existing private archive.
The outstanding operational choice is the worker host: this Windows computer,
which must stay awake, or a separately provisioned always-on server. No hosting
purchase, browser-profile installation, or new production provider is authorized
by this document itself.

## Evidence and intended outcome

The previous interactive browser test produced one image and one video through
the signed-in Gemini website, and both originals were imported into Supabase.
That proves an interactive workflow, not unattended operation. OpenArt uses its
official MCP/OAuth integration; the proposed Gemini bridge instead drives the
website. Google API OAuth is still access to a Cloud-project API, not evidence
of a consumer-subscription connector.

From the existing phone website, the owner and other authorized users select
Gemini-account image or video generation, submit a prompt, and receive progress
and the original output within the same conversation. Ordinary device histories
remain separate. The owner archive includes all prompts, attachments, replies,
and outputs. Existing free chat, API models, and OpenArt remain available.
There are no backup/database badges or technical tracking notices in ordinary UI.

## Architecture

1. The existing authenticated Next.js server validates the request and device
   ownership, then atomically creates an archive turn and browser job in Supabase.
2. A dedicated worker polls the server over outbound HTTPS. It claims one job
   using a restricted worker credential and a database lease. No inbound port or
   public browser-debugging port is needed on the owner's computer.
3. A dedicated persistent browser profile is signed into Gemini by the owner.
   Its cookies remain on the worker host; they are never copied from the user's
   normal profile or placed in Vercel, Supabase, frontend code, or log output.
4. The worker opens a fresh Gemini conversation for each media request, uses the
   visible image/video controls, supplies the prompt and authorized attachments,
   and obtains the result through the visible download control. It records the
   source conversation URL for recovery, scoped to the archive turn.
5. Original files upload directly to private Supabase Storage using short-lived,
   job-scoped upload authorization issued by the server. Files do not transit a
   Vercel function request body. Server validation commits asset metadata and the
   completed turn only after file presence, size and type are checked.
6. The phone polls the existing conversation endpoints and displays the completed
   text/media. Closing the phone page does not cancel an accepted job.

The worker uses deterministic UI actions: it never interprets model output as
instructions to browse, run code, change settings, or access other conversations.
The browser adapter must be verified against the current visible Gemini UI before
activation. CAPTCHA, account reauthentication, quota messages, missing controls,
or changed UI stop the job and require owner attention; they are not bypassed.

## Job lifecycle and recovery

- Queue creation is idempotent on the existing turn UUID and request hash.
- A transaction enforces one running browser job per account, with a renewable
  lease and unique claim token. A worker restart does not create a second owner.
- Record intent before clicking Send and record the resulting conversation URL
  as soon as visible. After submission may have occurred, a lost lease or timeout
  must never blindly resubmit. Recover the known conversation or mark uncertain.
- Completion is idempotent and fenced by claim token. Asset IDs and object paths
  are deterministic per output. Retry downloading/uploading existing results;
  never regenerate merely because archiving failed.
- Queued jobs may be reclaimed if no submission was attempted. Expired submitted
  jobs require recovery, not automatic retry of generation.
- Bound waiting time; surface a plain generation error for exhausted quota or
  unrecoverable failure. Connection diagnostics are owner-only. The normal chat
  does not claim success before the output is durably archived.
- Extend archive deletion to pending browser jobs. A deleted/tombstoned
  conversation rejects late completions, and durable cleanup removes uploaded
  orphan objects. Deletion affects this app's archive, not the Gemini source chat.

## Interface and access

- Add two clearly named choices: image through Gemini account, video through
  Gemini account. Do not promise a specific API model or per-generation API price
  for the website provider. Existing paid API choices retain their labels.
- Account generation has no API-key requirement or automatic paid-API fallback.
  It consumes whatever allowance is available in the signed-in Gemini account.
- The owner page exposes connected/offline/login-required state and a connection
  check. An offline worker disables new account jobs instead of accepting an
  indefinite queue. Recently accepted jobs retain explicit recoverable status.
- A fresh conversation per request prevents one phone's prompt from receiving
  context from another phone. Follow-up edits explicitly carry the chosen image
  and relevant local conversation context, subject to website capabilities.
- Worker endpoints use a separate revocable secret and narrow job operations;
  the existing public access code and owner archive code are not worker secrets.
- Service-role credentials remain server-side. Private input downloads and output
  uploads are limited to the current claimed job and short-lived URLs. Preserve
  device authorization and owner-only access to central history.

## Hosting choice

Local Windows worker: uses this computer; requires an awake machine, running
worker, Internet connection and valid Gemini session. Phone and computer do not
need the same network. A dedicated launcher and status check are required. Any
auto-start task must be installed explicitly as part of the chosen setup.

Always-on worker: same job protocol, hosted on a persistent machine with a browser
and encrypted persistent profile storage. Requires selecting/provisioning that
host and owner Google login there. No server price or availability is assumed.
The existing short-lived Vercel request handlers remain queue/controllers; they
are not treated as a permanently running signed-in browser.

## Acceptance before enabling on production

1. Confirm chosen host and owner login, without copying browser cookies.
2. Verify current visible image/video UI and original-file download behavior.
3. Test wrong-worker credentials, cross-device reads, duplicate submits, lease
   expiry before/after submission, worker restart, upload retry, deletion races,
   offline state and source/account quota errors using fixtures.
4. Submit one image and one video from the deployed mobile viewport. The actual
   autonomous worker must finish both without Codex manually completing the
   Gemini UI. Read original files back from private Storage and compare hashes.
5. Verify outputs in the requesting phone's chat and owner archive; verify an
   unrelated browser cannot read them. Refresh/close the phone during a job.
6. Disable account provider on failed readiness checks; preserve existing paths.

References inspected 2026-10-21:
- https://openart.ai/mcp/
- https://ai.google.dev/gemini-api/docs/oauth
- https://vercel.com/docs/functions/limitations
- docs/GEMINI-BROWSER-FEASIBILITY.md (local observed proof)
