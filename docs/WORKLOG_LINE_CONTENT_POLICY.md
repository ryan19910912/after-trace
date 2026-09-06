# AFTERTRACE LINE Content / Reply Policy

This document is part of the durable development contract for branch `revive/line-worklog` and must be read together with `WORKLOG_PRODUCT_SPEC.md` and `WORKLOG_REBUILD_PROGRESS.md` before implementation work that touches LINE ingestion, Reply handling, attachments, Record persistence, or cleanup.

## Command boundary

LINE OA and GROUP use the sentence-start assistant prefix **`小跡`**.

Fixed provider-free commands:

- `小跡 幫助`
- `小跡 狀態`
- GROUP `小跡 啟用 AI`
- GROUP `小跡 取消 AI`

All other addressed text is a natural-language request, for example:

- `小跡 幫我記一下今天晴空案收了三千`
- `小跡 我要查詢一下晴空案收款`
- Reply a deterministic Record -> `小跡 我想把金額改成 2800`
- Reply a deterministic Record -> `小跡 把這筆刪掉` / `小跡 幫我還原這筆` / `小跡 把這筆移到晴空案`

Ordinary chat not starting with `小跡` is not a product command.

The old customer-facing `@AFTERTRACE` syntax and OA Rich Menu pending-mode Postbacks are retired prelaunch behavior and must not be used in current UX/docs/tests.

## Reply-to-text temporary cache

**Only ordinary LINE GROUP TEXT messages are temporarily cached.**

LINE Reply provides the quoted message id, but old text cannot be fetched back from LINE later. LINE content API can retrieve eligible binary user content; it cannot reconstruct arbitrary past text after the webhook.

To support a group user who later Replies and naturally asks 小跡 to record that text:

- temporarily cache ordinary GROUP TEXT in PostgreSQL only;
- do not cache ordinary private/OA support text;
- do not cache AUDIO / IMAGE / FILE binaries;
- do not add Redis for MVP;
- default TTL = **5 days**;
- default per-group cap = **1000 text messages**;
- expired rows may be deleted; cap may prune oldest rows sooner;
- cache is temporary context, never a permanent Record;
- cached ordinary chat must not become AI input or a Record unless a user later explicitly Replies with a `小跡 ...` request that intends to preserve it;
- cache rows keep LINE message id, group identity, author LINE user id when available, text, **original LINE timestamp**, created/expires timestamps;
- lookup uses `quotedMessageId` within the same group;
- if quoted GROUP text is no longer cached, ask user to re-enter the content, e.g. `小跡 幫我記一下原文內容`;
- OA/private ordinary text is deliberately not cached. Replying later to private text therefore cannot recover that old text; ask user to send it again as a new `小跡 ...` Record request;
- do not weaken the privacy policy by adding private ordinary-text caching merely to emulate GROUP Reply-TEXT.

## Reply/Replay source timestamp — hard rule

The event-date reference for quoted/replayed content is the **original source message timestamp**, never the later Reply command timestamp.

Example:

- 9/3 original: `晴空案今天收3000清潔費`
- 9/5 user Replies: `小跡 幫我記一下這則`
- AI resolves `今天` against 9/3;
- resulting event date = 9/3;
- `created_at` may be 9/5.

Required behavior:

- GROUP Reply-to-TEXT uses cached `lineTimestamp` as `sourceTimestamp`;
- direct LINE Record request uses that command message's original LINE timestamp;
- Reply/Replay never uses Worker current time for relative dates;
- Reply/Replay never silently substitutes the later command timestamp when quoted source time is required;
- if original timestamp cannot be recovered, fail clearly/request resend rather than invent a current event date;
- applies to `今天`, `昨天`, `前天`, `明天`, `上週五` and similar expressions;
- interpretation uses `Asia/Taipei`.

Record event semantics are day-precision for MVP. A physical timestamp column may remain for compatibility, but it represents a canonical calendar-day marker rather than meaningful user clock time.

## Attachment policy — no binary cache

AUDIO / IMAGE / FILE binaries are **not cached** for delayed Reply recovery.

When a user Replies to an attachment and naturally asks 小跡 to record/process it:

1. read `quotedMessageId` from the command;
2. call LINE message-content API using that id;
3. if LINE still has content, process immediately;
4. if LINE returns `202`, do not send response body to AI; ask user to wait and Reply again later;
5. if unavailable/expired, ask user to resend;
6. if quoted id has no retrievable binary body, do not pretend it is an attachment;
7. do not fall back to local binary cache;
8. content API does not establish original attachment timestamp. Until original timestamp metadata is durably recoverable, delayed attachment Reply must not use the later command timestamp as event-date reference.

Do **not** permanently store original LINE binaries:

- AUDIO: no original audio retention;
- IMAGE: no original image retention;
- FILE: no original file retention.

After successful fetch, process enough durable textual content, persist Record text/trace facts, then discard binary.

## Audio

- fetch audio with `quotedMessageId`;
- feed supported audio to configured multimodal/audio-capable AI path when practical;
- persist transcript/text representation;
- normal AI title/date/search-term rules apply;
- do not retain original audio;
- Record input type = `AUDIO`.

## Image

- fetch image with `quotedMessageId`;
- feed image to configured multimodal model;
- persist useful extracted textual representation;
- normal AI title/date/search-term rules apply;
- do not retain original image;
- Record input type = `IMAGE`.

## General files

- fetch file with `quotedMessageId`;
- extract/read supported formats when practical;
- scanned/image-based documents may use multimodal extraction;
- store useful textual representation, not a persistent AI summary;
- normal title/date/search-term rules apply;
- do not retain original file;
- unsupported/unreadable files fail clearly or use an explicitly accepted safe metadata-only fallback;
- bound large document text before broad document support;
- Record input type = `FILE`.

## Durable LINE trace identifiers

Every persisted LINE Record keeps trace identifiers needed for diagnostics/idempotency:

- `line_message_id`: explicit `小跡` command/recording message id where applicable;
- `quoted_line_message_id`: replied-to text/audio/image/file id where applicable.

For Reply Records, `quoted_line_message_id` is first-class durable data.

Use identifiers to:

- trace interaction that created the Record;
- diagnose content-fetch failures;
- make redelivery/retry deterministic;
- prevent accidental duplicate recording where appropriate.

Never overwrite a different Record merely because a quoted id collides; idempotency must account for Source/group, command/quoted ids, author and Record state.

## Processing order / source-of-truth

- fixed `小跡 狀態` reads deterministic DB state and never invokes Gemini;
- direct TEXT natural request: run the bounded one-call interpretation, then persist/apply deterministically according to the resolved intent;
- GROUP Reply-to-TEXT: resolve cached text first and preserve cached original timestamp as interpretation/reference time when recording;
- PRIVATE Reply-to-TEXT: no private ordinary-text cache; when old text cannot be recovered, ask user to send it again as a new `小跡 ...` Record request;
- AUDIO/IMAGE/FILE: fetch content, extract/transcribe enough durable text before declaring Record saved;
- provider failure must not corrupt/overwrite durable raw text;
- durable Record text is source of truth; no separate persistent AI summary is required.

## PWA voice is separate from LINE binary policy

PWA Quick Capture voice is a PWA input modality, not LINE content retrieval.

Current MVP policy still avoids permanent original audio storage. PWA may hold a short-lived in-memory/current-request Blob for upload/retry, but does not require cross-session offline audio persistence. Once AI Draft/text extraction succeeds, durable Draft textual/structured content becomes the continuation point.

## Cleanup / operational checks

Development/bug-audit rounds should cover:

- only GROUP TEXT enters temporary text cache;
- private ordinary support text never cached;
- no AUDIO/IMAGE/FILE binary cache rows/payloads;
- 5-day TTL and 1000/group cap correctness;
- duplicate LINE webhook deliveries;
- Group Reply-to-TEXT after cache expiry;
- delayed Reply-to-TEXT preserves quoted timestamp;
- PRIVATE Reply-to-TEXT asks for re-entry rather than pretending binary fetch works;
- quoted attachment expiration/202/unavailable handling;
- delayed attachment Reply never substitutes command time for unknown source time;
- content `202` never reaches Gemini as attachment bytes;
- file size/format/provider failure handling;
- idempotent retry after partial failure;
- no binary data in PostgreSQL/logs;
- cross-group text-cache isolation;
- `小跡` is required at sentence start and ordinary chat stays ordinary;
- `小跡 狀態` bypasses provider/AI-point start checks and still works at zero balance.
