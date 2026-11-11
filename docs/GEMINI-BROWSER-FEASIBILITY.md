# Gemini account browser feasibility — 2026-10-21

User-authorized live proof through the existing signed-in Chrome profile. This is a feasibility test, not an installed automatic provider or deployment.

## Observed result

- Gemini's visible UI offered image and video generation on the user's account.
- Created one original ginger-cat image using the image tool. Source conversation: https://gemini.google.com/app/e242ef627f1e1e4b
- Used the visible full-size download control. Saved JPEG: 3,140,958 bytes, 2752×1536. The browser download event timed out even though Chrome saved the file successfully; verified the newly downloaded file directly.
- Created one short ginger-cat video through the video tool. Source conversation: https://gemini.google.com/app/6aa69601e4badb41
- Used the visible video download control. Saved MP4: 2,869,429 bytes, 1280×720, 10.005 seconds. Gemini's response: “הסרטון שלך מוכן!”
- No Gemini API key, extracted browser cookies, private endpoints, or CLI authentication tokens were used to generate either result.

## Persistence verified

Imported both test outputs and their prompts into the existing private Supabase archive using its server credentials, through an ignored one-off test script. Conversation ID: `3e3b18e6-c2a9-4c59-a951-bd2c8c534860`, title: “בדיקת חשבון Gemini — חתול על חלון”.

- Original bytes are stored in the private `chat-archive` bucket.
- `archive_conversations`, `archive_turns`, and `archive_assets` hold the transcript and asset references.
- Both files were read back from Storage and compared to the downloaded originals using SHA-256: exact matches.
- Owner archive was opened at `/admin/archive?id=3e3b18e6-c2a9-4c59-a951-bd2c8c534860` on the local production build. The image loaded at its full intrinsic dimensions. The video loaded with readyState 4 and played to its 10.005-second end without a media error.
- Test conversation is owner-archive-only; it was not attached to an ordinary browser's conversation index.
- Evidence screenshot: `test-screenshots/gemini-account-archive-proof.png` (ignored).

## What remains before a product integration

This proof was orchestrated interactively by Codex. The application does not yet submit new jobs to the Gemini website. A permanent integration would require a dedicated browser worker on an awake machine, a job queue, private device ownership, completion/import handling, and reconnect handling. Existing browser tool access in this Codex session is not an independently running worker available to the deployed app.

Browser integration would depend on Gemini's UI, session availability and account quotas. One successful image and video test does not establish long-term automation reliability. The existing API implementation and OpenArt integration remain unchanged. No deployment was performed.
