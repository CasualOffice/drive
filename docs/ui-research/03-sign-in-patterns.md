# 03 — Premium Sign-In Surface Patterns (2026)

> Research brief. The first surface a user sees in Doc-Hub. This brief replaces §13 of [`../ux/02-surface.md`](../ux/02-surface.md), keeping every other surface intact.

**Methodology.** `WebSearch` only — `WebFetch` was permission-denied on most hosts and the live sign-in pages are JS-rendered, so raw markup didn't surface. Visual specifics reconstructed from secondary sources are tagged `[unverified]`. Synthesis rests on OWASP, web.dev, MDN, NN/g material that did return clean snippets, plus the tokens in [`../research/04-polish-principles.md`](../research/04-polish-principles.md).

---

## TL;DR

- **Reference set converges on a centred card, ~360–440 px, on a near-blank canvas.** Split-screen is a marketing tactic, not a polish tactic. Linear, Stripe, GitHub, 1Password, Things Cloud, Vercel, Notion all centre.
- **Email-first / password-second multi-step exists to support SSO routing.** It does not speed up password users — it slows them and is the leading cause of password-manager autofill breakage ([Smashing][smashing-2step], [Evert Pot][evert-multi]). With one tenant, Doc-Hub ships a single-page form.
- **Microcopy splits two ways:** Apple-style "Sign in to continue." (calm, instructional) or Linear-style "Welcome back" (warm, personal). Pick one and hold it everywhere.
- **Gold-standard error is generic.** "That username or password is incorrect." inline below the inputs, `aria-invalid` + `aria-describedby`, optional 1-cycle shake gated on `prefers-reduced-motion` ([WP Trac][wp-shake], [WCAG 2.3.3][wcag-233]).
- **Autocomplete is non-negotiable:** `autocomplete="username"` on the identifier, `autocomplete="current-password"` on the secret, both inside a real `<form>` with a submit button ([web.dev][webdev-signin], [MDN][mdn-pw]).
- **Doc-Hub v0:** username + password, single page, centred card, Apple-leaning copy ("Sign in to continue."), generic error with shake, caps-lock icon hint (no toast), passkey hook reserved for Phase 3.

---

## Reference sign-ins

Compact per-surface notes — fields, layout, motion, copy, errors, focus, autofill. `[unverified]` flags items reconstructed from secondary sources.

### 1. Linear — `linear.app/login`

Email-first → magic link or 6-digit code; passkeys added May 2024 ([login methods][linear-login], [passkeys changelog][linear-passkey]). Centred ~400 px card on dark canvas, glyph-only brand. Button: **"Continue with email"** (the form doesn't yet know which path). Anti-enumeration: "we sent a code if the email exists" `[unverified]`. Email autofocused; code input accepts pasted whole code. No password, no eye toggle, no caps-lock concern.

### 2. Vercel — `vercel.com/login`

Single page; OAuth stack (**Continue with GitHub / GitLab / Bitbucket / Google / SAML SSO**) plus email for magic link ([login][vercel-login], [faster login changelog][vercel-google]). Centred ~360–400 px card on dark canvas `[unverified]`, triangle glyph only. Button verb: **"Continue with <Provider>"**. No password → no eye, no caps-lock. Errors return as a banner above the card `[unverified]`. The pattern Doc-Hub inherits when Phase 3 adds OIDC.

### 3. Stripe — `dashboard.stripe.com/login`

Email + password one page → mandatory 2FA on a second page (TOTP, SMS, security key, passkey) ([2FA topic][stripe-2fa], [enable 2FA][stripe-enable]). Centred card, near-white canvas, **wordmark** (not just glyph) above the card — the brand-forward outlier. Button: **"Continue"**. Inline generic error under password. Eye toggle on password `[unverified]`. "Forgot your password?" inline. Clean `autocomplete` pair.

### 4. Notion — `notion.so/login`

Email-first → magic code, password (if set), or OAuth (Google, Apple, SAML). Centred ~440 px card on cream canvas; SSO buttons stacked above email; **"Continue with email"** below `[unverified]`. Eye toggle on the password step `[unverified]`. A known autofill friction point per [Evert Pot][evert-multi].

### 5. 1Password — web hub

Account address + email + **Secret Key** (34 chars) + master password + optional 2FA ([Secret Key][op-secret], [CLI sign-in][op-cli]). Multi-stage by design — the Secret Key field is the visual centre, monospace, paste-affordance prominent (user pastes from Emergency Kit PDF). Glyph + wordmark — the brand *is* the trust artefact. Notably **errors are specific** ("Secret Key is incorrect") — an intentional anti-enumeration exception because the key's entropy makes the leak gain-free. **No "Forgot" link** for the master password. Eye toggle on master password. Proves multi-stage feels premium *only when the security model demands it* — Doc-Hub's doesn't.

### 6. GitHub — `github.com/login`

The dominant reference. "Username or email" + "Password" + remember-me + optional passkey button ([login][gh-login], [passkey docs][gh-passkey]). Centred ~308 px card, near-white canvas, **Octocat above the card**, heading **"Sign in to GitHub"** inside. Button: **"Sign in"**. Stacked footer card: "New to GitHub? Create an account." — the GitHub signature. Error: full-page reload with flash banner, **"Incorrect username or password."** Username preserved; password cleared. Server-rendered — the URL flip *is* the loading state. "Forgot password?" inline beside the label. Textbook autocomplete inside a real `<form action="/session" method="post">` with hidden CSRF; works with every password manager, screen reader, JS disabled. **Unsexy and unimpeachable.**

### 7. Figma — `figma.com/login`

Email + password one page; OAuth (Google, SAML SSO) stacked above ([login help][fig-login], [auth methods][fig-acct]). Centred card on near-white canvas, "F" glyph above `[unverified]`. Heading and button: **"Log in"**. Inline generic error under the failed field. Eye toggle present `[unverified]`. "Forgot password?" inline, "Create account" below.

### 8. Raycast — sync sign-in

OAuth-only: three buttons (**Continue with Google / GitHub / Apple**) ([account management][raycast-acc], [direct sign-in][raycast-direct]). Centred narrow card on charcoal, wordmark + tagline above. No inputs. First button focused. Proves a sign-in surface *can* be three buttons — but only when the product owns no credentials. Doc-Hub does. What we steal is the canvas restraint.

### 9. Things Cloud — Cultured Code

No public web sign-in; native macOS/iOS sheet only ([Cultured Code login][things-login]). ~420 px sheet, two stacked inputs, primary **Continue**, "Reset password" link beneath. Native SF Pro. Inline error in red border + helper line — **no shake**, macOS sheets are quiet. macOS-native caps-lock glyph appears automatically. Native Keychain autofill. *One sheet, two fields, one button, one link* — Doc-Hub should match that density.

---

## Synthesis

**Field strategy.** Three patterns: (1) identifier-first routed (Linear, Notion, Stripe-effectively) — required when multiple methods per account; (2) single-page credentials (GitHub, Figma, Things Cloud) — right when one method dominates; (3) OAuth-only (Raycast). Pattern 1 is overrepresented in design write-ups because enterprise SaaS needs it, but **for most users it's a regression** — breaks autofill (password managers expect both fields on one DOM), adds a round-trip, adds microcopy. Smashing says use it only when SSO routing demands it ([Smashing][smashing-2step]); Evert Pot shows you can salvage autofill with a hidden `autocomplete="username"` input on the password page, but that's undoing damage you caused ([Evert Pot][evert-multi]). **Doc-Hub = pattern 2.** Phase 3 keeps the password form and adds a "Continue with <Provider>" block above it — still pattern 2.

**Layout — centred vs split.** Centred wins for polish. Split-screen with marketing art ([Eleken][eleken], [Stylosheet][stylo]) is a marketing-funnel tactic for public SaaS landings where login *is* the landing page. Doc-Hub is self-hosted — the user already chose to install. Centred focuses attention, works narrow without breakpoints, matches every canonical reference here.

**Error UX (wrong credentials).** Generic copy ("That username or password is incorrect.") — specific leaks which usernames exist ([Control Gap][control-gap], [OWASP testing guide][owasp-enum]). Inline under the password (or above the button) — eye is already there. 1 px `--danger` border on *both* inputs + helper line. 1-cycle horizontal shake (~8 px, 250 ms), gated on `prefers-reduced-motion: no-preference` — WordPress core's filed bug gives the canonical pattern ([WP Trac][wp-shake], [WCAG 2.3.3][wcag-233]). ARIA: `aria-invalid="true"` + `aria-describedby` + `role="alert"` ([MDN][mdn-invalid], [WebAIM][webaim-forms]). Server: always Argon2id-verify (dummy hash on miss) for wall-time parity ([Stytch][stytch-enum]).

**Motion.** Polished references animate: card mount (200 ms fade + 4 px translate-Y), button label ↔ spinner (120 ms cross-fade), error shake (1 cycle ~250 ms). They don't animate focus rings, inputs themselves, or hover beyond standard tint. No rotation, no bounce, no parallax. **Polish is selective motion.**

**Microcopy.** Two voices: Apple/calm ("Sign in to <Product>." — Things Cloud, Stripe, GitHub) or Linear/warm ("Welcome back" — risky cold). Survey: "Log in" beats "Sign in" 56/44 in raw use ([Reproof][reproof-copy]), but **consistency inside one product matters more** — pair Log in/Log out, Sign in/Sign out.

**A11y baseline.** Real `<form>` with `action`/`method` (submits on Enter; password managers expect it). `<input autocomplete="username">` and `<input type="password" autocomplete="current-password">`, stable `id`/`name` ([web.dev][webdev-signin]). Visible `<label for="…">`. `aria-invalid` + `aria-describedby` + `role="alert"` on errors. `:focus-visible` for the ring. Tab order = visual reading order.

**Anti-enumeration.** Identical response — copy, status, and (within reason) timing — for "user doesn't exist", "wrong password", "wrong code" ([Control Gap][control-gap], [Akimbo][akimbo-enum]). Rate-limit per-IP and per-account. Reset endpoints always respond "If an account exists, we sent instructions" — never confirm registration. 1Password is the only documented exception (Secret Key entropy makes the leak gain-free).

---

## Doc-Hub-specific recommendation

**Field set: username + password.** `DOCHUB_ADMIN_USER` is an arbitrary string — `<input type="text" autocomplete="username">` covers an email value *and* "admin"/"sachin"/whatever. Password not magic link: magic links need SMTP, a regression from the env-seeded model in [`../research/02-auth.md`](../research/02-auth.md). Phase 3 migration: OIDC adds a "Continue with <IdP>" block *above* the username field; password form stays for the env-seeded admin. No URL change.

**Layout: centred 360 px card** on `--bg-canvas`. No split, no marketing art, no animated background — this is an entry checkpoint, not a landing.

**Single-page form.** No SSO routing to make = no email-first. One form, two inputs, one button.

**Error treatment (wrong credentials).** Copy: **"That username or password is incorrect."** 1 px `--danger` border on both inputs; helper line in `--danger` `--text-xs` below password. 1-cycle shake of the card, 8 px amplitude, 250 ms, `cubic-bezier(0.36, 0.07, 0.19, 0.97)`, wrapped in `@media (prefers-reduced-motion: no-preference)`. Server: always Argon2id-verify (dummy hash on miss). Lockout after 5 failures: **"Too many attempts. Try again in {{n}} seconds."** Inputs `readonly`, live countdown, button `aria-disabled`.

**Loading.** `[ Sign in ]` → `[ ⟳ Signing in… ]` (16 px spinner inline-left). Button `aria-disabled="true"` (NOT DOM `disabled` — preserves Tab order, per [NN/g][nng-buttons] and [UX Movement][uxmov-loading]). Inputs `readonly` (not disabled — preserves autofill values). Success → 200 ms card fade + redirect. Error → 250 ms shake + revert label + clear password + refocus password. Minimum 300 ms loading state to prevent flicker.

**Caps lock.** No toast. Lucide `arrow-up-square` 16 px, `--warning`, inside the password input right-anchored 12 px, `aria-label="Caps Lock is on"` + hover tooltip. Detect via `KeyboardEvent.getModifierState('CapsLock')`. Matches native macOS.

**Focus + autofill.** `autoFocus` on username on cold mount only. Real `<form action="/api/login" method="post">`. Username: `type="text" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" required`. Password: `type="password" autocomplete="current-password" required`. Hidden CSRF input per [`../research/02-auth.md`](../research/02-auth.md) §3.

**Brand presence.** Lucide `shield-check` 28 px `--accent` above the card; wordmark **"Doc-Hub"** in `--font-display`, `--text-xl`, `--weight-semibold` centred below the glyph. No tagline. `DOCHUB_BRAND_NAME` and optional `DOCHUB_BRAND_GLYPH_URL` overrides deferred to a later config pass.

### Microcopy — final v0 strings

| Slot | Copy |
|---|---|
| Page title (`<title>`) | `Sign in · Doc-Hub` |
| Brand wordmark | `Doc-Hub` |
| Heading under wordmark | `Sign in to continue.` |
| Username label | `Username` |
| Password label | `Password` |
| Submit button (idle) | `Sign in` |
| Submit button (loading) | `Signing in…` |
| Wrong credentials | `That username or password is incorrect.` |
| Rate-limited | `Too many attempts. Try again in {{n}} seconds.` |
| Server error (5xx) | `Something went wrong. Try again.` |
| Caps-lock tooltip | `Caps Lock is on.` |

**Deliberately omitted:** "Forgot password?" (v0 admin recovers via env rotation; no email flow). "Sign up" (single-tenant). "Remember me" (the `__Host-dh_sid` cookie persists across sessions by default; offering an opt-out would imply we *might* use a session-only cookie, which we don't).

---

## Complete surface spec

Replaces §13 of [`../ux/02-surface.md`](../ux/02-surface.md).

### ASCII layout

```
                (canvas: --bg-canvas, full viewport)


                                🛡              ← Lucide shield-check, 28px, --accent,
                                                 24px above the card

                          Doc-Hub          ← --font-display, --text-xl,
                                                 --weight-semibold, --fg-default,
                                                 16px below glyph

               ╭───────────────────────────────╮
               │                               │
               │  Sign in to continue.         │  ← --text-md, --fg-muted, left
               │                               │
               │  Username                     │  ← --text-sm, --weight-medium
               │  ┌─────────────────────────┐  │
               │  │                         │  │  ← 40px tall, --radius-md
               │  └─────────────────────────┘  │
               │                               │
               │  Password                     │
               │  ┌─────────────────────────┐  │
               │  │                    [⇪]  │  │  ← caps-lock glyph slot (right)
               │  └─────────────────────────┘  │
               │                               │
               │  ┌─────────────────────────┐  │
               │  │        Sign in          │  │  ← full-width primary
               │  └─────────────────────────┘  │
               │                               │
               ╰───────────────────────────────╯
                                                  (no Forgot/Sign-up links in v0)
```

### Component inventory

| Element | Token / library | Notes |
|---|---|---|
| Page | `<main>` on `--bg-canvas` / `--bg-canvas-dark` | min-height 100vh; centres card; honours `prefers-color-scheme` |
| Brand glyph | Lucide `shield-check`, 28 px, `--accent` | overridable later via `DOCHUB_BRAND_GLYPH_URL` |
| Wordmark | `--font-display`, `--text-xl`, `--weight-semibold`, `--fg-default` | overridable via `DOCHUB_BRAND_NAME` |
| Card | `--bg-default`, `--radius-xl`, `--shadow-md`, hairline `--border-default` | 360 px wide, `--space-6` padding |
| Subhead | `--text-md`, `--fg-muted` | bottom margin `--space-5` |
| Label | `--text-sm`, `--weight-medium`, `--fg-default`, sentence case | bottom margin `--space-1` |
| Input | `--bg-default`, hairline `--border-default`, `--radius-md`, `--shadow-inner-input`, `--text-base`, 40 px tall, 12 px horizontal padding | focus → `--focus-ring`; readonly → 0.7 opacity |
| Caps-lock glyph | Lucide `arrow-up-square` 16 px `--warning`, abs-right 12 px inside password input | `aria-label`, hover tooltip |
| Primary button | `--accent` bg, `--fg-onAccent`, `--radius-md`, `--text-base`, `--weight-medium`, 40 px, full-width | hover `--accent-hover`; active 1 px translate-Y |
| Error helper | `--text-xs`, `--danger`, below password input | `role="alert"`, `id="signin-error"` |

### State matrix

| State | Card | Inputs | Button | Notes |
|---|---|---|---|---|
| Mount | 200 ms fade + 4 px translate-Y | username autofocused | idle | once per session |
| Typing | — | `--border-strong` on focus; caps-lock glyph if relevant | — | — |
| Loading | unchanged | both `readonly`, opacity 0.7 | spinner + "Signing in…", `aria-disabled` | min 300 ms |
| Success | 200 ms fade out + redirect | — | — | redirect is the confirmation, no toast |
| Wrong credentials | 1-cycle shake (250 ms, ±8 px; gated on `prefers-reduced-motion`) | both `aria-invalid="true"`, 1 px `--danger` border | revert label, focus regained on password (cleared) | inline error: "That username or password is incorrect." |
| Rate-limited | no shake | both `readonly` until countdown ends | `aria-disabled`, label: "Try again in {{n}}s" | live region announces countdown every 10 s |
| Server 5xx | no shake | both restored | revert label | inline error: "Something went wrong. Try again." |
| Reduced motion | mount: opacity only, no translate | — | spinner replaces label without cross-fade | shake replaced with 120 ms opacity flash of helper |

### Animation timing

| Animation | Duration | Curve | Property |
|---|---|---|---|
| Card mount | 200 ms | `--ease-out` `cubic-bezier(0.32, 0.72, 0, 1)` | opacity + translateY |
| Button label ↔ spinner | 120 ms | `--ease-out` | opacity cross-fade |
| Shake on error | 250 ms | `cubic-bezier(0.36, 0.07, 0.19, 0.97)` | translateX, keyframes 0/-8/8/-6/6/-3/3/0 px; 1 cycle |
| Caps-lock glyph fade-in | 120 ms | `--ease-out` | opacity |
| Input border colour | 80 ms | `--ease-out` | border-color |
| Success card fade-out | 200 ms | `--ease-in` | opacity (then redirect) |

### Keyboard

| Key | Behaviour |
|---|---|
| Tab | username → password → submit |
| Shift-Tab | reverse |
| Enter | submit (native form behaviour) |
| Esc | no-op (this is the root surface) |

### Markup skeleton

```html
<main class="signin-page">
  <header class="brand">
    <svg class="brand-glyph" aria-hidden="true">…shield-check…</svg>
    <h1 class="brand-wordmark">Doc-Hub</h1>
  </header>

  <form class="signin-card"
        action="/api/login"
        method="post"
        novalidate
        aria-describedby="signin-error">
    <p class="signin-sub">Sign in to continue.</p>

    <input type="hidden" name="_csrf" value="…">

    <label for="username">Username</label>
    <input id="username" name="username" type="text"
           autocomplete="username"
           autocapitalize="off" autocorrect="off" spellcheck="false"
           required autofocus>

    <label for="password">Password</label>
    <div class="password-wrap">
      <input id="password" name="password" type="password"
             autocomplete="current-password" required
             aria-describedby="signin-error">
      <span class="caps-lock-hint" role="status"
            aria-label="Caps Lock is on" hidden>↑</span>
    </div>

    <p id="signin-error" class="signin-error" role="alert" hidden></p>

    <button type="submit" class="signin-submit">
      <span class="spinner" aria-hidden="true" hidden></span>
      <span class="label">Sign in</span>
    </button>
  </form>
</main>
```

### Server contract (anti-enumeration)

- POST `/api/login` returns 200 with `{ "error": "invalid_credentials" }` on logical failure; 200 + `Set-Cookie: __Host-dh_sid=…` on success. Same wall-time floor (~80 ms) regardless of path.
- After 5 failures in 60 s from one IP: 429 with `{ "error": "rate_limited", "retry_after": 60 }`. `tower_governor` per [`../research/02-auth.md`](../research/02-auth.md) §3.
- "Username does not exist" is never exposed as a distinct path.

### Deliberately deferred

Eye toggle on password (v1 — password manager covers it). Passkey/WebAuthn (Phase 3 — form already accepts `autocomplete="username webauthn"` later). "Continue with <IdP>" block (Phase 3 with OIDC — adds *above* the username field with separator "or sign in with username"; form unchanged). Forgot-password / magic-link reset (Phase 3 — needs SMTP). Sign-up (Phase 3 — single-tenant). Marketing background / hero art (out of scope — the polish bar in [`../research/04-polish-principles.md`](../research/04-polish-principles.md) §1 is "the absence of noise", and the sign-in is the loudest place to honour it).

---

## Sources

Reference surfaces: [Linear login][linear-login] · [Linear passkeys][linear-passkey] · [Vercel login][vercel-login] · [Vercel faster login][vercel-google] · [Stripe 2FA][stripe-2fa] · [Stripe enable 2FA][stripe-enable] · [Stripe login][stripe-login] · [Notion login][notion-login] · [1Password Secret Key][op-secret] · [1Password Secret Key (about)][op-secret-about] · [1Password CLI sign-in][op-cli] · [GitHub login][gh-login] · [GitHub passkey][gh-passkey] · [Figma login help][fig-login] · [Figma auth][fig-acct] · [Raycast account][raycast-acc] · [Raycast direct sign-in][raycast-direct] · [Cultured Code login][things-login].

Pattern, UX, a11y: [Smashing — 2-page login pattern][smashing-2step] · [Smart Interface Design — 2-page pattern][smart-2step] · [Evert Pot — multi-step login + password managers][evert-multi] · [web.dev sign-in form best practices][webdev-signin] · [MDN input password][mdn-pw] · [MDN autocomplete][mdn-autocomplete] · [MDN aria-invalid][mdn-invalid] · [WebAIM forms][webaim-forms] · [WCAG 2.3.3][wcag-233] · [WordPress core — reduced-motion shake bug][wp-shake] · [NN/g button states][nng-buttons] · [UX Movement button loading][uxmov-loading] · [Kenan Yusuf — password visibility][kyusuf-pw] · [Sajid Hasan — password eye dilemma][sajid-pw] · [Reproof — Log in vs Sign in survey][reproof-copy] · [Eleken — 50+ login examples][eleken] · [Stylosheet — split-screen login][stylo] · [Muzli — login screens 2026][muzli] · [Authgear — login/signup UX 2025][authgear] · [Corbado — WebAuthn autocomplete][corbado-webauthn] · [Mojoauth — passkeys handbook][mojo-passkeys].

Anti-enum, security: [Control Gap — username enumeration][control-gap] · [OWASP testing — account enumeration][owasp-enum] · [Akimbo Core — preventing enumeration][akimbo-enum] · [Stytch — preventing enumeration][stytch-enum] · [OWASP Authentication Cheat Sheet][owasp-auth] · [OWASP Password Storage Cheat Sheet][owasp-pw].

Caps lock / shake refs: [SitePoint — caps-lock warnings][sitepoint-caps] · [KeePassXC PR #3646][keepass-caps] · [W3Schools — detect Caps Lock][w3s-caps].

[linear-login]: https://linear.app/docs/login-methods
[linear-passkey]: https://linear.app/changelog/2024-05-30-passkeys-a-fast-and-secure-way-to-log-in-to-linear
[vercel-login]: https://vercel.com/login
[vercel-google]: https://vercel.com/changelog/faster-login-flow-and-new-google-sign-in-support
[stripe-2fa]: https://support.stripe.com/topics/two-step-authentication
[stripe-enable]: https://support.stripe.com/questions/enable-two-step-authentication
[stripe-login]: https://dashboard.stripe.com/login
[notion-login]: https://www.notion.so/login
[op-secret]: https://support.1password.com/secret-key/
[op-secret-about]: https://support.1password.com/secret-key-security/
[op-cli]: https://developer.1password.com/docs/cli/sign-in-manually/
[gh-login]: https://github.com/login
[gh-passkey]: https://docs.github.com/en/authentication/authenticating-with-a-passkey/signing-in-with-a-passkey
[fig-login]: https://help.figma.com/hc/en-us/articles/360041064554-Log-in-or-add-accounts
[fig-acct]: https://help.figma.com/hc/en-us/articles/360039820114-Manage-email-address-or-password
[raycast-acc]: https://manual.raycast.com/account-management
[raycast-direct]: https://www.raycast.com/direct_sign_in
[things-login]: https://culturedcode.com/things/support/articles/2997514/
[smashing-2step]: https://www.smashingmagazine.com/2024/06/2-page-login-pattern-how-fix-it/
[smart-2step]: https://smart-interface-design-patterns.com/articles/2-page-login-pattern/
[evert-multi]: https://evertpot.com/multi-step-login-forms-for-password-managers/
[webdev-signin]: https://web.dev/articles/sign-in-form-best-practices
[mdn-pw]: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/password
[mdn-autocomplete]: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/autocomplete
[mdn-invalid]: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-invalid
[webaim-forms]: https://webaim.org/techniques/forms/controls
[wcag-233]: https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html
[wp-shake]: https://core.trac.wordpress.org/ticket/49723
[nng-buttons]: https://www.nngroup.com/articles/button-states-communicate-interaction/
[uxmov-loading]: https://uxmovement.com/buttons/when-you-need-to-show-a-buttons-loading-state/
[kyusuf-pw]: https://kyusuf.com/post/password-visibility-toggles
[sajid-pw]: https://blog.sajidhasan.com/password-eye-dilemma
[reproof-copy]: https://www.reproof.app/blog/ux-copy-survey
[eleken]: https://www.eleken.co/blog-posts/login-page-examples
[stylo]: https://www.stylosheet.com/split-screen-login-ui/
[muzli]: https://muz.li/inspiration/login-screen/
[authgear]: https://www.authgear.com/post/login-signup-ux-guide/
[corbado-webauthn]: https://www.corbado.com/blog/webauthn-autocomplete
[mojo-passkeys]: https://mojoauth.com/white-papers/passkeys-passwordless-authentication-handbook/
[control-gap]: https://www.controlgap.com/blog/how-to-protect-against-username-enumeration-from-forms
[owasp-enum]: https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/03-Identity_Management_Testing/04-Testing_for_Account_Enumeration_and_Guessable_User_Account
[akimbo-enum]: https://akimbocore.com/article/preventing-username-enumeration/
[stytch-enum]: https://stytch.com/blog/prevent-enumeration-attacks/
[owasp-auth]: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
[owasp-pw]: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
[sitepoint-caps]: https://www.sitepoint.com/better-passwords-3-caps-lock-warnings/
[keepass-caps]: https://github.com/keepassxreboot/keepassxc/pull/3646
[w3s-caps]: https://www.w3schools.com/howto/howto_js_detect_capslock.asp
