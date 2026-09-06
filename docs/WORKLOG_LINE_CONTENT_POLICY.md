# AFTERTRACE LINE Content / Reply Policy — Retired Product Surface

## Status

LINE OA/GROUP integration is **retired from the target product architecture** as of the Web/PWA product reset.

This file remains only as a migration/cleanup reference while existing LINE-specific code/schema is removed safely. It is not a customer-facing product contract and must not be used to justify new LINE features.

## Target product replacement

The accepted customer surfaces are:

- Web;
- PWA;
- optional Chrome extension fast capture.

Groups are created inside AFTERTRACE and joined through AFTERTRACE invite links/tokens. AI entitlement is per user subscription. There is no target GROUP AI responsible-user concept.

## Legacy features to remove or isolate

Do not extend these legacy features:

- LINE OA/private webhook product commands;
- LINE GROUP bot commands;
- `小跡` command language;
- LINE Reply target mapping;
- temporary GROUP text cache;
- LINE binary attachment fetch/replay;
- LINE group profile cache/refresh;
- LINE member lifecycle authorization;
- LINE user mentions/textV2 rendering;
- OA friendship state as product behavior;
- GROUP AI responsible-user bind/release flows;
- LINE-specific AI runtime paths.

Existing code may remain temporarily until replacement Web/PWA flows are proven and migration cleanup is safe.

## Migration safety

While removing LINE:

- do not destroy unrelated durable Records, revisions, users, subscription/payment facts, AI usage facts or Admin diagnostics;
- preserve existing Dev database unless a safe forward migration is genuinely impossible;
- remove LINE-specific schema only after confirming no retained target feature depends on it;
- keep legacy migrations idempotent during transition;
- do not keep dead LINE runtime merely because old tests exist; update tests to the new product contract as the replacement surfaces are implemented.

## Replacement capture rules

### Free

- manual text Record CRUD;
- browser/device speech-to-text where supported without AFTERTRACE provider AI;
- deterministic content/date search.

### Paid AI

- natural-language text;
- AI voice;
- image/file/PDF input;
- title/keywords/date/entity enrichment for new AI operations;
- natural-language search;
- related Records;
- time-range summary;
- AI rewrite;
- task extraction/proposal.

## Replacement group authorization

GROUP authorization comes from AFTERTRACE membership created through authenticated invite/join flows. Server-side checks apply to every operation.

LINE group membership/bot presence must not remain a hidden authorization dependency.

## Replacement reminder path

Task reminders use Web/PWA data plus Cloudflare scheduled processing and PWA push. LINE messaging is not the notification transport in the target product.

## Development rule

Do not spend new product-development time fixing LINE E2E behavior unless the fix is strictly necessary to make migration/removal safe. Current priority is Web/PWA/Chrome + subscription AI.

GitHub Actions must not be used as validation unless explicitly requested by the user.
