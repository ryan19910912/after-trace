# AFTERTRACE Support / Feedback Policy

Durable product/development contract for AFTERTRACE customer support surfaces.

## Product boundary

AFTERTRACE remains Web + PWA-first. LINE is not a Record/capture/search/group/AI product surface anymore.

However, the official LINE OA is intentionally retained as an **external customer-support contact channel**.

This does not reintroduce LINE into the core product domain.

## Web / PWA customer support entry points

Web and PWA should expose two separate customer-facing actions:

### 意見回饋

- stays inside AFTERTRACE;
- uses a simple feedback form;
- persists to AFTERTRACE durable data;
- is visible/manageable from Admin;
- suitable for suggestions, feature requests, UX comments, non-urgent bug reports and general product feedback;
- may include useful context such as public account id, user id internally, app version/surface, timestamp and optional screenshot/description where the user chooses to provide it.

### 聯絡客服

- opens the official AFTERTRACE LINE OA;
- customer-facing wording is **聯絡客服**;
- do not label the UI as `客訴管道`;
- do not add wording such as `人工回覆非即時` to the customer-facing button/subtitle;
- the LINE conversation remains outside the core AFTERTRACE Record/group/AI domain.

## Support account lookup

Customer support must not depend on the user having linked a particular third-party identity.

Every AFTERTRACE account has an immutable, unique, customer-facing `public_account_id` such as `AT-7K4M2P`.

Rules:

- this id is not the raw database primary key;
- it is opaque/non-sequential and safe to disclose to support;
- Web/PWA shows it as **帳號 ID** near the user name in the authenticated top-right account area;
- the account id has a one-tap copy action;
- Admin user search supports exact lookup by this account id;
- support may ask the customer to provide the copied 帳號 ID when account identification is needed;
- users do not need to disclose Google email, LINE user id, LINE display name or other third-party identifiers merely to identify the AFTERTRACE account.

Google Login and LINE Login are both accepted sign-in providers, but support lookup remains AFTERTRACE-account based rather than provider based.

## LINE OA behavior

For the initial product stage, LINE OA is intentionally simple:

- human-operated support channel;
- no RAG knowledge base;
- no general-purpose AI support bot;
- no Record create/edit/search commands;
- no group management;
- no subscription/AI entitlement mutations from chat;
- no synchronization of LINE support conversation history into AFTERTRACE Admin for MVP.

A simple LINE OA built-in automatic acknowledgement is acceptable, for example a generic message confirming receipt and asking the customer to provide useful problem context/screenshots/account id when appropriate. This acknowledgement should not promise a specific response time or SLA.

If support volume grows later, a lightweight intent classifier or FAQ automation may be reconsidered, but it must remain a support-layer feature rather than a return of LINE as a product surface.

## Admin

Admin should manage the in-product `意見回饋` records. Initial useful fields/status include:

- feedback id;
- public account id / user id when authenticated;
- category such as BUG / FEATURE / UX / OTHER;
- message/content;
- optional context/metadata;
- status such as OPEN / IN_PROGRESS / RESOLVED / IGNORED;
- created_at / updated_at.

Admin user search should support `public_account_id` so a customer can simply copy the Web/PWA 帳號 ID and send it through LINE OA or another support channel.

LINE OA support conversations do not need to be mirrored into this table for MVP.

## Architecture rule

Do not retain or rebuild LINE webhook product complexity merely because LINE OA remains available for customer support.

The core target remains:

- Web / PWA = product;
- Chrome extension = optional fast capture;
- LINE OA = external support contact channel only.

Any future LINE webhook work must be explicitly justified by a support requirement and must not silently reintroduce the retired `小跡` Record/group/AI product behavior.

GitHub Actions must not be used as validation unless explicitly requested by the user.
