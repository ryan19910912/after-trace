# AFTERTRACE Chrome Extension Policy

Durable product/development contract for the AFTERTRACE Chrome extension.

## Product role

The Chrome extension is a **fast capture surface**, not a second full AFTERTRACE application.

Core principle:

> Open in seconds, capture the useful work event, close it, and let the same AFTERTRACE account/timeline handle the rest.

The extension must reuse the same authenticated account, Source/group authorization, manual Record API, AI entitlement/accounting, and durable Record model as Web/PWA. Do not create an extension-only Record domain.

## Accepted capture scope

The extension should support all of the following capture paths:

1. **Quick text** — type a short Record directly in the popup.
2. **Quick voice** — explicit microphone start/stop; free browser/device speech-to-text may be used when available without AFTERTRACE provider AI; paid AI voice may use the normal paid AI pipeline when explicitly selected/available.
3. **Selected text** — save currently selected webpage text into a draft/Record through a context-menu or equivalent explicit user action.
4. **Current page context** — optionally attach the active page `title` and `URL` to the Record. This should be explicit/visible before save and must not silently archive the full page.
5. **Screenshot / image capture** — allow explicit visible-page or bounded screenshot/image capture for AI Pro processing. Do not continuously record or monitor the screen.

All capture modes must preserve the selected destination Source/group and require normal backend authorization.

## UX boundary

The extension should remain intentionally compact.

Recommended popup shape:

- current destination Source/group;
- microphone action;
- short text area;
- optional `附上目前頁面` toggle showing title/URL;
- save/submit action;
- clear error/retry state;
- link to open the full Web app when deeper management is needed.

Do not turn the extension into a large sidebar workspace, full notification center, full Record history manager, or open-ended AI chat surface for V1.

## Selected-text capture

Selected-text capture must be explicit and user initiated.

Recommended behavior:

- user selects text on a webpage;
- chooses `儲存到 AFTERTRACE` from a context menu or extension action;
- extension opens a compact draft containing the selected text;
- user may add a short note and choose destination Source/group;
- optional current page title/URL can be included;
- user confirms before persistence.

Do not automatically capture all page text, browsing history, or clipboard contents.

## Current page title / URL

Page metadata is context, not the Record body source of truth.

Persist title/URL as bounded metadata when included. The UI should make inclusion visible before save.

Do not crawl, summarize, or archive the full page merely because title/URL was attached. Any future page-content extraction requires an explicit product decision and clear user action.

## Screenshot / image capture

Screenshot/image capture is an explicit user action.

V1 may start with the currently visible tab/viewport or another bounded capture implementation supported by Chrome extension APIs. If region-selection UX materially increases complexity, visible-page capture may ship first and region selection may follow.

Rules:

- never background-capture screenshots;
- never continuously monitor screen content;
- do not store original screenshots longer than needed unless an explicit durable attachment feature is later accepted;
- AI Pro may analyze the image through the same provider/cost accounting path as other image input;
- free users must not receive provider-backed image interpretation unless covered by eligible one-time AI trial points.

## Permissions / privacy

Request the minimum Chrome extension permissions required for accepted functionality.

Likely bounded permissions may include active tab access, context menus, storage for non-secret UI preferences, and screenshot capability. Avoid broad host permissions or browsing-history permissions unless technically necessary and separately reviewed.

Never store provider API keys in the extension. Provider calls go through AFTERTRACE backend authorization/accounting.

## Authentication

The extension must authenticate against the same AFTERTRACE account as Web/PWA. Google, LINE, or Apple are login providers for the account, not extension-specific identity systems.

If an authenticated browser session cannot be reused safely across extension/browser boundaries, use a bounded explicit handoff/token flow rather than storing long-lived third-party credentials in extension storage.

## Free vs AI Pro

Free users can use provider-free extension functions such as:

- manual text capture;
- selected-text capture;
- current page title/URL context;
- free browser/device speech-to-text where supported;
- normal Source/group selection and manual Record persistence.

AI Pro or eligible Free AI trial points may enable provider-backed capabilities such as:

- AI voice interpretation;
- screenshot/image interpretation;
- AI title/keywords/date/entity enrichment;
- other paid AI processing explicitly initiated from the extension.

The extension must use the same entitlement and cost caps as Web/PWA.

## Explicitly out of scope for V1

Do not add:

- continuous browsing-history capture;
- automatic full-page archiving;
- always-on microphone recording;
- meeting-length background recording;
- automatic tab monitoring;
- RAG over every visited webpage;
- a large persistent AI sidebar/agent;
- separate extension-only subscription/accounting.

## Delivery order

The extension is built after the shared account/auth, Record APIs, AI entitlement/accounting and core Web/PWA flows are stable enough to reuse.

Within extension implementation, preferred order is:

1. popup shell + auth/session handoff;
2. Source/group picker;
3. quick text;
4. current page title/URL;
5. selected-text context-menu flow;
6. quick voice;
7. screenshot/image capture + AI Pro integration;
8. permission/privacy/browser smoke and Chrome Web Store packaging.

All tests must distinguish AUTHORED from actually executed PASS. Do not use GitHub Actions as validation unless explicitly requested by the user.
