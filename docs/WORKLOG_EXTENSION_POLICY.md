# AFTERTRACE Chrome Extension Policy

Durable product/development contract for the AFTERTRACE Chrome extension.

## Product role

The Chrome extension is a **fast capture surface**, not a second full AFTERTRACE application.

It reuses the same AFTERTRACE account, Record APIs, group authorization, AI entitlement and usage accounting as Web/PWA.

## Accepted capture scope

The extension supports explicit user-initiated:

1. quick text Record;
2. browser/device speech-to-text;
3. selected webpage text;
4. optional current page title + URL context;
5. visible-tab screenshot sent to image AI **only when the current user has an active AI Pro subscription**.

The extension must not create an extension-only Record domain.

## UX

Keep the popup compact:

- destination picker;
- text area;
- voice-to-text action;
- optional page-information toggle;
- screenshot action + preview;
- save action;
- clear status/error copy;
- link to the full Web app.

Do not build a full history manager, notification center, large sidebar workspace or open-ended AI chat inside the extension.

## Selected text / page context

Selected-text capture is explicit. Current page title/URL are bounded context and must be visible before save.

Do not silently capture full page content, clipboard, browsing history or tabs.

## Screenshot / image capture

Screenshot capture requires an explicit click. Current implementation may use the visible tab/viewport.

Rules:

- never background-capture screenshots;
- never continuously monitor screen content;
- preview remains local until the user explicitly saves;
- when saved, screenshot goes through `/api/v1/ai/capture/image` and the same backend authorization/accounting as Web image AI;
- screenshot/image AI requires **active AI Pro**;
- the one-time FREE AI Search trial does **not** unlock screenshot/image AI;
- the original screenshot is not a durable attachment unless a future product decision explicitly adds attachment storage.

Current image defaults: one image per request and 5 MB per image.

## Authentication

The extension authenticates against the same AFTERTRACE account as Web/PWA. It must not store Google/LINE/Apple provider credentials or AI provider keys.

Use the bounded explicit Web-to-extension handoff flow for AFTERTRACE session connection.

## Free vs AI Pro

FREE extension features:

- manual text capture;
- selected-text capture;
- optional current page title/URL;
- browser/device speech-to-text;
- authorized destination selection.

FREE AI Search trial points are used only on the Web/PWA natural-language Search surface. They do not unlock provider-backed AI inside the extension.

Any provider-backed extension feature requires active AI Pro, including:

- screenshot/image interpretation;
- future AI text organization inside the extension;
- future AI voice interpretation or other provider-backed extension processing.

## Permissions/privacy

Request the minimum Chrome permissions needed for accepted features. Avoid browsing-history permissions and broad host access unless separately reviewed.

Never store AI provider keys in the extension. Provider calls go through AFTERTRACE backend.

## Out of scope

Do not add:

- continuous browsing-history capture;
- automatic full-page archiving;
- always-on microphone/screen capture;
- meeting-length background recording;
- automatic tab monitoring;
- RAG over all visited pages;
- a persistent extension AI agent/sidebar;
- separate extension-only subscription/accounting.

## Validation

Distinguish AUTHORED from actually executed PASS. Do not use GitHub Actions unless explicitly requested by the user.
