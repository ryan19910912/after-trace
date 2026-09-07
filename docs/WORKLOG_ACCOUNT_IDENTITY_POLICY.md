# AFTERTRACE Account / Identity Policy

Durable product/development contract for AFTERTRACE account identity and login.

## Login providers

AFTERTRACE uses provider-neutral accounts.

Current customer login plan:

- Google Login — first-class login option;
- LINE Login — first-class login option;
- Apple Login — supported login option, implementation priority after Google/LINE if sequencing is required.

The AFTERTRACE account must not depend on Google email, LINE user id, Apple relay email, provider display name, or any other third-party identifier as its durable customer identity.

Provider identities are bindings to one AFTERTRACE user.

## Provider-neutral identity shape

Conceptual identity record:

- `user_id` — internal AFTERTRACE user reference;
- `provider` — `GOOGLE | LINE | APPLE`;
- `subject` / provider user id;
- optional email/display-name snapshot;
- created/updated timestamps.

`provider + subject` is unique.

Do not silently merge accounts merely because two providers expose the same email address. Explicit account-linking requires a separately accepted, authenticated linking flow.

## Public Account ID / 帳號 ID

Every AFTERTRACE account has a separate customer-facing support identifier.

Requirements:

- immutable after account creation;
- globally unique;
- opaque/non-sequential;
- distinct from the internal database primary key;
- safe to show in the authenticated product UI and to provide to support;
- usable for exact Admin lookup.

Example presentation only:

`AT-7K4M2P`

The exact generation alphabet/length may change before launch, but it must provide sufficient collision resistance and must not leak database sequence information.

## Web / PWA authenticated header

The authenticated top-right account area contains:

- notification bell and unread count;
- user display name;
- `帳號 ID` using the public account id;
- one-tap copy action for the account id.

Copy success should have lightweight visible confirmation such as `已複製`.

On narrow PWA layouts, the account details may live inside the account/profile popover, but they must remain easy to find and copy.

## Support lookup

Admin user search must support exact lookup by public account id.

This is the preferred support identifier when a customer contacts AFTERTRACE. Support must not require the customer to provide Google email, LINE id, Apple id or another third-party identifier merely to locate the account.

LINE OA remains a support channel, but LINE identity is not required for support lookup because the public account id is provider-neutral.

## Apple privacy behavior

Apple users may use privacy-preserving/relay email behavior. AFTERTRACE must therefore treat provider email as profile/contact metadata rather than the durable account identity.

The public account id remains stable regardless of provider email changes or privacy mode.

## Account linking

Initial product may allow users to keep independent accounts per login identity until a safe linking UX is implemented.

When linking is implemented:

- user must already be authenticated;
- the second provider must complete its own authentication challenge;
- conflicting provider subjects cannot be reassigned silently;
- account data merging requires an explicit policy and must not occur merely from matching email;
- unlinking must never leave an account with no usable authentication method unless another recovery method exists.

GitHub Actions must not be used as validation unless explicitly requested by the user.
