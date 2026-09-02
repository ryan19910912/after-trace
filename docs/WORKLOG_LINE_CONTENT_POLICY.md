# AFTERTRACE LINE Content / Reply Policy

This document is part of the durable development contract for branch `revive/line-worklog` and must be read together with `WORKLOG_PRODUCT_SPEC.md` and `WORKLOG_REBUILD_PROGRESS.md` before implementation work that touches LINE ingestion, Reply handling, attachments, record persistence, or cleanup.

## Reply-to-text temporary cache

LINE Reply provides the quoted message id but old text cannot be fetched back from LINE later. To support users who forget to mark a text immediately and Reply several days later:

- Temporarily cache ordinary LINE group text in PostgreSQL only.
- Do not add Redis for MVP.
- Default TTL: **5 days**.
- Default per-group cap: **1000 text messages**.
- A row is eligible for deletion when TTL has expired; the cap may prune the oldest rows sooner if a group exceeds 1000 cached text messages.
- Cache is strictly temporary and is not a permanent work record.
- Cached ordinary chat must not be treated as AI input or a saved AFTERTRACE record unless a user later explicitly Replies and invokes `@AFTERTRACE`.
- Cache rows should keep at least LINE message id, group/source identity, author LINE user id when available, text, created time, expires time.
- Reply-to-text lookup uses `quotedMessageId` against this temporary cache.
- When the quoted text no longer exists in cache, return a clear content-expired response and ask the user to resend/re-enter it.
- Make TTL and per-group cap operator-configurable later if practical, but 5 days / 1000 is the MVP default.

## Attachment storage policy

Do **not** permanently store original LINE attachment binaries for MVP:

- AUDIO: do not retain the original audio file.
- IMAGE: do not retain the original image file.
- FILE: do not retain the original uploaded file.

When a user Replies to an attachment and invokes `@AFTERTRACE`:

1. Read `quotedMessageId` from the command message.
2. Fetch the quoted attachment from LINE using the existing content-fetch foundation while LINE still retains the content.
3. If LINE content is unavailable/expired, return a content-expired response; do not create a misleading successful record.
4. Process the fetched content and persist the durable textual/structured result, then discard the binary.

## Audio

- Feed supported audio directly to the configured multimodal/audio-capable AI path when practical; a separate STT product layer is not required for MVP.
- Persist the resulting transcript/text representation and normalized summary/metadata.
- Do not keep the original audio binary after processing.
- Record input type is `AUDIO`.

## Image

- Feed the fetched image to the configured multimodal model.
- Persist useful extracted text/description/summary and normalized metadata.
- Do not keep the original image binary after processing.
- Record input type is `IMAGE`.

## General files

- Fetch the file from LINE using the quoted message id.
- Extract readable text for supported formats when practical (for example plain text/CSV/Markdown/PDF/DOCX/XLSX-style content through appropriate parsers).
- For scanned/image-based documents, multimodal extraction may be used.
- Store extracted text and/or a concise AI summary as the durable work record content.
- Do not retain the original file binary.
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

Do not overwrite a different record merely because a quoted message id collides with an existing record; define idempotency deliberately around source/group, quoted message id, command message id, author, and record state.

## Processing order / source-of-truth rule

- For direct TEXT commands, persist raw text first; AI normalization happens after durable raw persistence.
- For Reply-to-TEXT, resolve cached quoted text first, then persist the raw resolved text with both LINE ids before optional AI normalization.
- For AUDIO/IMAGE/FILE, fetch and successfully extract enough durable textual content before declaring the record saved, because the binary itself will not be retained.
- AI/provider failure must not corrupt or overwrite existing durable raw/textual content.

## Cleanup / operational checks

Development and bug-audit rounds should cover:

- 5-day TTL pruning correctness;
- 1000-message per-group cap pruning order;
- duplicate LINE webhook deliveries;
- Reply after cache expiry;
- quoted attachment expired at LINE;
- file too large / unsupported format;
- attachment fetch succeeds but AI/parser fails;
- idempotent retry after partial failure;
- no binary attachment data accidentally persisted in PostgreSQL/logs;
- cross-group quoted-message/cache isolation.
