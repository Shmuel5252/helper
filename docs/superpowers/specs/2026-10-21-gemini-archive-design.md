# Gemini with a central conversation archive

## Agreed product behavior

The existing free-key chat keeps its current browser-only history. A separate
Gemini key provides advanced chat, image generation, and video generation. Every
conversation using the new key is archived as a complete conversation, including
ordered messages, replies, attachments, generated images, and generated videos.

The archive is separate from ordinary chat history. Opening the app on another
browser does not populate that browser with other devices' conversations. The
owner can open a protected archive page and browse all backed-up conversations.
There is no user registration or recovery-code workflow for individual devices.
OpenArt remains connected and retains its existing model options and behavior.

## User experience

- A conversation has an explicit local or backed-up mode before its first send.
- Existing conversations default to local. They are never uploaded implicitly.
- Switching between local and backed-up modes starts a new conversation; it does
  not upload the previous conversation or silently change its retention policy.
- User correction during implementation: the ordinary interface shows Gemini and
  ordinary chat only. No backup/tracking/database labels or success badges. Storage
  failures use a generic operation error; owner archive remains separately protected.
- Backed-up chat offers Gemini models from the new key. Local chat retains the
  existing provider configuration, model choices, and quota indicators.
- Image/video controls identify their provider. OpenArt credits and Gemini usage
  charges remain distinct. Generation requires confirmation, as today. Do not
  present a precise quote when the provider does not provide one.
- The archive uses a conversation list with titles and dates and a chat-style
  detail page displaying the full ordered exchange and downloadable attachments.
- Deleting a local conversation does not implicitly delete its central archive.
  Archive deletion is a separate, explicit owner action.

## Proposed storage

Use a Supabase project owned by the user. PostgreSQL stores conversation and
message records and attachment metadata. A private Storage bucket holds actual
files. The browser never receives the Supabase secret/service-role key or Gemini
key. All storage access is performed through the application's server.

Record a random browser identity in a secure HTTP-only cookie and scope ordinary
archive writes and asset reads to it. Reuse the existing separate admin login for
owner archive access. A shared site access code is not sufficient to read every
browser's archived conversations. No ordinary route lists other browsers' data.
If browser identity is lost, the owner archive still retains the conversations;
there is no automatic restoration into that browser's ordinary chat sidebar.

Enable row-level security on archive tables and keep the file bucket private.
Do not add public read policies. Database and storage credentials are server-only.
Store and serve media through this site's origin, preserving the existing support
for filtered phones. Download and video-range responses enforce ownership/admin
access and use validated MIME types and attachment filenames.

## Save and generation behavior

Persist the user's message and its uploaded attachments before issuing a paid
request. Persist the returned answer/media before reporting backup success.
Store original accepted document files in addition to their extracted text; the
current local history only stores extracted text and is insufficient as a full
file archive. Preserve the image actually submitted and generated media bytes,
not merely browser thumbnails or expiring Google URLs.

Give conversations, messages, and generation attempts stable server-validated
identifiers. Retrying a request must not duplicate paid generation. Updates to
one answer must not overwrite another in-progress generation or newer metadata.
Provider and archive failures get different Hebrew messages. If archive setup is
missing or fails before submission, refuse a new backed-up paid request rather
than silently processing it without the promised archive.

The implementation plan must select and verify the documented Gemini request
mode for video, including deployment execution limits, disconnect behavior,
completion persistence, and retry semantics. Do not assume the old Veo polling
contract applies to the current Gemini video model.

## Models and billing

On October 21, 2026, a non-generating models-list request using the supplied new
key succeeded. It listed Gemini 4 Argon, Gemini 3.8 Flash, Nano Banana 2.1,
Nano Banana Pro, and Gemini Omni 1.1 Flash. This verifies key authentication and
model visibility, not billing activation, generation permission, or sufficient
quota. Before activation, confirm that the new key's project is paid and that
the original free-key project remains separate and without billing.

Use stable model identifiers verified against Google documentation and the
key's catalog. Do not use Veo 3.1 preview as a new integration default: current
Google documentation announces shutdown on October 22, 2026. Gemini cost labels
are estimates based on the provider's current pricing and must not claim to be
an exact account balance or translate into OpenArt credits.

## Implementation boundaries

- Preserve local conversation storage and the current OpenArt integration.
- Add separate server-side Gemini configuration; do not replace AI_API_KEY.
- Add archive persistence, private file delivery, and protected owner pages.
- Extend the composer and history types for backed-up mode and archive status.
- Keep original local data intact; no automatic bulk upload or migration.
- Add SQL schema/migrations and setup instructions for the user's own Supabase.
- No paid generation, production deployment, or external project creation has
  occurred as part of the initial key verification.

## Verification requirements

Test free/paid credential routing, mode isolation, and refusal to submit a paid
request without working archive storage. Test browser ownership and admin-only
cross-browser access, private file delivery, original attachment preservation,
streaming errors, repeated submissions, simultaneous generation updates, and
backup failure messaging. Re-run existing unit and browser tests for chat,
history, documents, images, quotas, and OpenArt. Test the actual configured
Supabase project before claiming backup is working. A live paid generation test
must be clearly identified as spending real API usage.

## Current setup state

- The new key is saved locally in ignored `.env.local` as GEMINI_API_KEY.
- The old provider variables have been preserved.
- The new key successfully authenticated a models-list request.
- Supabase project was created by the user in Ireland; schema and private bucket
  provisioned during implementation. Live temporary DB/file probes passed and were removed.
- Application changes are local until a deployment is explicitly completed.

## Primary references

- https://ai.google.dev/gemini-api/docs/api-key
- https://ai.google.dev/gemini-api/docs/models
- https://ai.google.dev/gemini-api/docs/openai
- https://ai.google.dev/gemini-api/docs/image-generation
- https://ai.google.dev/gemini-api/docs/omni
- https://ai.google.dev/gemini-api/docs/veo
- https://ai.google.dev/gemini-api/docs/pricing
- https://supabase.com/docs/guides/getting-started/quickstarts/nextjs
- https://supabase.com/docs/guides/storage
