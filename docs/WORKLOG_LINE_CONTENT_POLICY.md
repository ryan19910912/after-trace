# AFTERTRACE LINE Content / Reply Policy

This document is part of the durable development contract for branch `revive/line-worklog` and must be read together with `WORKLOG_PRODUCT_SPEC.md` and `WORKLOG_REBUILD_PROGRESS.md` before implementation work that touches LINE ingestion, Reply handling, attachments, record persistence, or cleanup.

## Reply-to-text temporary cache

**Only ordinary LINE GROUP TEXT messages are temporarily cached.**

LINE Reply provides the quoted message id, but old text cannot be fetched back from LINE later. The LINE Messaging API content endpoint supports binary user content such as image/video/audio/file; there is no API to retrieve a user's past text again after the original webhook event. To support group users who forget to mark a text immediately and Reply several days later:

- Temporarily cache ordinary LINE group text in PostgreSQL only.
- Do not cache ordinary private/OA support text.
- Do not cache AUDIO / IMAGE / FILE content or binaries.
- Do not add Redis for MVP.
- Default TTL: **5 days**.
- Default per-group cap: **1000 text messages**.
- A row is eligible for deletion when TTL has expired; the cap may prune the oldest rows sooner if a group exceeds 1000 cached text messages.
- Cache is strictly temporary and is not a permanent work record.
- Cached ordinary chat must not be treated as AI input or a saved AFTERTRACE record unless a user later explicitly Replies and invokes `@AFTERTRACE`.
- Cache rows should keep at least LINE message id, group/source identity, author LINE user id when available, text, created time, expires time.
- Group Reply-to-text lookup uses `quotedMessageId` against this temporary cache.
- When the quoted group text no longer exists in cache, LINE cannot reconstruct the text from `quotedMessageId`; return a clear response asking the user to re-enter it, for example `@AFTERTRACE 原文`.
- In OA one-to-one chat, ordinary support text is deliberately not cached. Therefore replying later to a private text cannot reconstruct the quoted text from LINE. Ask the user to send `@AFTERTRACE 原文` instead. Do not weaken the privacy/content policy by adding a private ordinary-text cache just to emulate group Reply-TEXT behavior.
- Make TTL and per-group cap operator-configurable later if practical, but 5 days / 1000 is the MVP default.

## Attachment policy: no temporary cache

AUDIO / IMAGE / FILE are **not cached at all** for delayed Reply recovery.

When a user Replies to an attachment and invokes `@AFTERTRACE`:

1. Read `quotedMessageId` from the command message.
2. Directly call the LINE message-content API using that message id.
3. If LINE still has the content, process it immediately.
4. If LINE returns `202`, the binary content is still being prepared. Do not pass the response body to AI; tell the user to wait and send a new Reply `@AFTERTRACE` against the same attachment later.
5. If LINE no longer has the content or the content API returns unavailable/expired, reply clearly that the content has expired and ask the user to resend it.
6. If the content endpoint reports that the quoted message has no retrievable binary body (for example a past text), do not pretend it is an attachment; ask the user to re-enter the text or resend the attachment as appropriate.
7. Do not fall back to a local attachment cache because there is no attachment cache in the MVP.

Do **not** permanently store original LINE attachment binaries:

- AUDIO: do not retain the original audio file.
- IMAGE: do not retain the original image file.
- FILE: do not retain the original uploaded file.

After successful LINE content fetch, process the content and persist the durable textual Record content plus normal Record trace fields, then discard the binary.

## Audio

- Fetch audio directly from LINE using `quotedMessageId`.
- Feed supported audio directly to the configured multimodal/audio-capable AI path when practical; a separate STT product layer is not required for MVP.
- Persist the resulting transcript/text representation as durable Record content.
- AI-assisted ingestion may also determine the single Record title and `occurred_at` under the normal title-parsing contract.
- Do not keep or cache the original audio binary after processing.
- Record input type is `AUDIO`.

## Image

- Fetch the image directly from LINE using `quotedMessageId`.
- Feed the fetched image to the configured multimodal model.
- Persist useful extracted text/description as durable Record content.
- AI-assisted ingestion may also determine the single Record title and `occurred_at` under the normal title-parsing contract.
- Do not keep or cache the original image binary after processing.
- Record input type is `IMAGE`.

## General files

- Fetch the file directly from LINE using `quotedMessageId`.
- Extract readable text for supported formats when practical (for example plain text/CSV/Markdown/PDF/DOCX/XLSX-style content through appropriate parsers or provider-native document understanding where validated).
- For scanned/image-based documents, multimodal extraction may be used.
- Store the useful extracted textual representation as durable Record content. Do not maintain a separate persistent per-record AI summary.
- AI-assisted ingestion may also determine the single Record title and `occurred_at` under the normal title-parsing contract.
- Do not retain or cache the original file binary.
- Unsupported or unreadable files should fail clearly or preserve only safe metadata (file name/type/size) if the product intentionally supports a metadata-only fallback.
- Avoid blindly storing unlimited document text; apply a sensible text-size limit or separate content storage strategy before supporting very large documents.
- Record input type is `FILE`.

## Durable LINE trace identifiers

Every persisted work record created from LINE must retain trace identifiers needed for diagnostics and idempotency:

- `line_message_id`: the message id of the explicit `@AFTERTRACE` command/recording message when applicable.
- `quoted_line_message_id`: the message id of the text/audio/image/file being replied to when applicable.

For Reply-based records, `quoted_line_message_id` is a first-class persisted field, not temporary metadata.

Use these identifiers to:

- trace which LINE interaction created a record;
- diagnose content-fetch failures;
- make retry/redelivery behavior deterministic;
- prevent accidental duplicate recording of the same quoted attachment/content when appropriate.

Do not overwrite a different record merely because a quoted message id collides with an existing record; define idempotency deliberately around Source/group, quoted message id, command message id, author and Record state.

## Processing order / source-of-truth rule

- For direct TEXT commands, persist raw/durable Record text first; AI title/time interpretation happens after durable raw persistence where practical.
- For GROUP Reply-to-TEXT, resolve cached quoted text first, then persist the resolved text with both LINE ids before optional AI title/time interpretation.
- For PRIVATE Reply-to-TEXT, do not create a private ordinary-text cache; when the original text is no longer present in the current webhook, ask the user to send `@AFTERTRACE 原文`.
- For AUDIO/IMAGE/FILE, call LINE content API directly, then extract/transcribe/understand enough durable textual content before declaring the Record saved, because neither a local cache nor the original binary is retained.
- AI/provider failure must not corrupt or overwrite existing durable raw/textual content.
- The durable Record text is the source of truth; no separate persistent AI summary is required.

## Cleanup / operational checks

Development and bug-audit rounds should cover:

- only GROUP TEXT enters the temporary cache;
- private ordinary support text is never cached;
- no AUDIO/IMAGE/FILE cache rows or binary payloads are created;
- 5-day TEXT TTL pruning correctness;
- 1000-message per-group TEXT cap pruning order;
- duplicate LINE webhook deliveries;
- Group Reply-to-TEXT after cache expiry;
- Private Reply-to-TEXT returns explicit re-entry guidance rather than attempting binary fetch as text;
- quoted AUDIO/IMAGE/FILE expired at LINE;
- LINE content `202` preparation state never reaches Gemini as attachment bytes;
- attachment content API unavailable/error handling;
- file too large / unsupported format;
- attachment fetch succeeds but AI/parser fails;
- idempotent retry after partial failure;
- no binary attachment data accidentally persisted in PostgreSQL/logs;
- cross-group quoted-message/TEXT-cache isolation.
