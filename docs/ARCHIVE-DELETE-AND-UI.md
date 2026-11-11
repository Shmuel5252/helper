# Archive deletion and interface polish

Implemented 2026-10-21. No application deployment or Git push was performed.

- Shared, labeled switch between the browser-local free chat and Gemini. Existing free-chat storage and OpenArt behavior are preserved.
- Consistent headers, composer surfaces, focus states, mobile spacing and calm welcome screen.
- Gemini history opens in a native modal drawer with search, Escape support and focus containment.
- Owner archive includes server-side title search, a conversation list and mobile list/detail navigation. Owner identifiers are stripped before sending list props to the client.
- Owner-only deletion uses an accessible confirmation dialog, clear irreversible-delete wording, a cancel default and in-flight protection. It does not call Google or remove the source conversation from Gemini.

## Deletion behavior

Migration `202610210002_archive_delete.sql` was applied successfully to the connected Supabase project. A transaction locks the conversation, rejects active generations, records file cleanup paths and deletes transcript/asset metadata together. An ID-only tombstone blocks resurrection by stale browser tabs. Private Storage cleanup happens immediately; a durable queue retries failures through the existing archive cron. Late uploads whose metadata insert loses a race with deletion register their object for cleanup. Browser indexes discard a conversation when the server reports it missing.

The cron must be scheduled in the deployed environment for cleanup retry after transient failures. Original files remain private and inaccessible through the application's asset route once their metadata is removed.

## Verification

- Production build, TypeScript and lint passed.
- 65 unit tests passed.
- Archive integration suite passed against the local simulator: owner isolation, media access, CSRF, admin-only deletion, active-generation protection, file-cleanup retry, repeat deletion and resurrection prevention.
- A new temporary conversation and text file were created in live Supabase and deleted through the application endpoint. Metadata and Storage removal were confirmed; recreating its ID was rejected. Existing user conversations and generated media were not deleted.
- Browser checks covered phone layout (390×844), desktop layout, mode switching, history drawer, confirmation cancel/Escape, private archive media and search. Production rendering was reviewed; temporary viewport overrides are reset after checking.

The earlier Gemini website experiment remains a feasibility proof. This work does not install an automatic browser worker or change the current Gemini API billing path.
