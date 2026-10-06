# addtab.app

The marketing site and waitlist for Tab, the iMessage group-chat bot that keeps the tab. Built from the design
reference in `../landing/` (`Main.dc.html`), which stays untouched.

- **Next.js 16** (App Router, TypeScript, Turbopack), deployed on **Vercel**.
- **GSAP + ScrollTrigger + SplitText** (via `@gsap/react`'s `useGSAP`) for the scroll-driven Vegas story, the
  "pay for dinner" strike-through and section headings.
- **Motion** for the bubble wall (spring pops, drag with momentum), the two-endings toggle and the three looping phones.
- **Lenis** smooth scrolling on mouse and trackpad only, driven by GSAP's ticker.
- **Waitlist**: a server action writing to **AWS DynamoDB**, optional **Cloudflare Turnstile**, phone numbers
  normalized to E.164 with `libphonenumber-js`. After signing up, people see their real spot and an invite link
  (`/i/<code>`) that moves them up (see [Referrals](#referrals)).
- **PostHog** analytics, only when a key is set.

## Run it locally

```bash
cd site
npm install
npm run dev            # http://localhost:3000
```

With no env vars at all, `next dev` uses the dev fallbacks, and the server logs a loud warning for each:

- sign-ups go to an **in-memory list** (lost on restart),
- Turnstile uses Cloudflare's documented always-pass test keys (`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`),
- IPs are hashed with a fixed dev secret.

Invite links are built from `NEXT_PUBLIC_SITE_URL`, so to click through them locally run
`NEXT_PUBLIC_SITE_URL=http://localhost:3000 npm run dev`.

To try the production build locally with the same fallbacks:

```bash
WAITLIST_DEV_FALLBACK=1 npm run build
WAITLIST_DEV_FALLBACK=1 npm start
```

`WAITLIST_DEV_FALLBACK` is ignored when `VERCEL_ENV=production`, so it can't leak into the live site.

Other scripts: `npm run typecheck`, `npm run waitlist:export` (below), `npm run assets:frame` (rebuilds
`public/phone-frame.webp` from the design's 3x bezel PNG).

## Environment variables

Every variable is listed in `.env.example`.

| Variable | Needed | What it does |
| --- | --- | --- |
| `AWS_REGION` | Production | Region of the waitlist table (`us-east-1`). |
| `AWS_ACCESS_KEY_ID` | Production | IAM user key for the site (see the policy below). |
| `AWS_SECRET_ACCESS_KEY` | Production | Its secret. |
| `WAITLIST_TABLE` | Optional | Table name, default `tab-waitlist`. |
| `IP_HASH_SECRET` | Production | Secret for HMAC-SHA256 of the visitor IP. Only the hash is stored. `openssl rand -hex 32`. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Optional | Turnstile site key. Inlined at build time, so redeploy after changing it. |
| `TURNSTILE_SECRET_KEY` | Optional | Turnstile secret, verified server-side on every sign-up. |
| `NEXT_PUBLIC_POSTHOG_KEY` | Optional | PostHog project key. Empty means posthog-js is never downloaded. |
| `NEXT_PUBLIC_POSTHOG_HOST` | Optional | Default `https://us.i.posthog.com`. |
| `TAB_SIGNUP_WEBHOOK_URL` | Optional | Where new sign-ups are POSTed (contract below). Unset means a logged no-op. |
| `TAB_SIGNUP_WEBHOOK_SECRET` | With the URL | HMAC key for signing that webhook. |
| `NEXT_PUBLIC_SITE_URL` | Optional | Canonical URL and the base of invite links, default `https://addtab.app`. |
| `WAITLIST_DEV_FALLBACK` | Local only | `1` allows the dev fallbacks under `next start`. |

**Never failing silently.** The Vercel production build stops with a clear error if `AWS_REGION`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` or `IP_HASH_SECRET` is missing (`next.config.ts`). Anywhere outside
local dev, a missing value makes the action refuse sign-ups ("Sign-ups are down for a minute") and log
`[waitlist] Misconfigured: missing ...`. Turnstile is optional for now: without both keys the action accepts
sign-ups without a bot check and logs a warning.

Vercel may inject placeholder `AWS_*` values into functions. They are not real credentials, so the site passes
the keys you set explicitly, and an auth failure shows up as `[waitlist] Sign-up failed` in the function logs.

## The waitlist table (DynamoDB)

The table already exists and is managed outside this code: **`tab-waitlist`** in `us-east-1`, partition key
**`phone`** (String, E.164), on-demand billing, point-in-time recovery and deletion protection on. The site never
creates or changes it.

Each sign-up is one item, written with `PutCommand` and `ConditionExpression: attribute_not_exists(phone)`, so a
number that is already on the list is never overwritten. That case shows "You're already on the list."

| Attribute | Example | Notes |
| --- | --- | --- |
| `phone` | `+14155552671` | Partition key, E.164. |
| `id` | `1ff32e26-...` | UUID for this sign-up. |
| `status` | `pending_confirmation` | Until Tab confirms by text. |
| `consent_text` | `Text me when Tab is ready. I agree that Tab may text this number...` | The exact wording shown (`src/lib/waitlist/consent.ts`). |
| `consent_version` | `2026-10-06.v1` | Bump it whenever the wording changes. |
| `consent_at` | ISO 8601 | When they agreed. |
| `ip_hash` | hex | HMAC-SHA256 of the IP with `IP_HASH_SECRET`. |
| `user_agent`, `referrer` | | Optional. |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` | | From the landing URL, optional. |
| `signup_location` | `hero` or `footer` | Which form was used. |
| `created_at`, `updated_at` | ISO 8601 | |
| `notified_at` | ISO 8601 | Set once the signup webhook accepts the item. |
| `ref_code` | `s2dq8nb3` | This person's invite code: 8 chars from `23456789abcdefghjkmnpqrstuvwxyz` (no 0/o/1/i/l). Unique (checked on the index, retried on a clash). Rows from before referrals get one lazily the next time they're looked up (a conditional update, only if absent). |
| `referred_by` | `8ps8xth4` | The `ref_code` whose invite link brought them. Only set when it belongs to a real row with a different phone number. |
| `referral_count` | `2` | Friends who joined with their link. Starts at 0, incremented with `ADD referral_count :one`. Missing on older rows means 0. |

**Index.** Invite codes are looked up through the GSI **`by_ref_code`** (hash key `ref_code`, String, `KEYS_ONLY`),
also managed outside this code. Until it exists, sign-ups still work: codes are issued unchecked (with a warning),
invite links show no banner, and nobody gets credit.

Minimal IAM policy for the site's key:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:GetItem", "dynamodb:Scan"],
      "Resource": "arn:aws:dynamodb:us-east-1:<ACCOUNT_ID>:table/tab-waitlist"
    },
    {
      "Effect": "Allow",
      "Action": ["dynamodb:Query"],
      "Resource": "arn:aws:dynamodb:us-east-1:<ACCOUNT_ID>:table/tab-waitlist/index/by_ref_code"
    }
  ]
}
```

`Scan` is for the position ranking (it reads only `phone`, `created_at` and `referral_count`); `GetItem` is for
giving older rows their invite code.

**Rate limiting.** Sign-up attempts are limited to 8 per hashed IP per hour by an in-memory counter
(`src/lib/waitlist/rate-limit.ts`). Each serverless instance keeps its own counts, so this slows casual abuse
rather than enforcing a global cap. The conditional write keeps duplicates out regardless, and Turnstile (once
its keys are set) is the real bot defense. If abuse shows up, move the counter to a shared store.

### Exporting the list

```bash
# put AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY in site/.env.local (gitignored), then:
npm run waitlist:export > waitlist.csv
```

`scripts/export-waitlist.ts` scans the table (read-only) and prints CSV with `phone, created_at, status,
utm_source, ref_code, referred_by, referral_count`, oldest first. Values that start with `=`, `+`, `-` or `@` (other than phone numbers) are prefixed
with `'` so a spreadsheet won't run them as formulas. It runs on Node's built-in TypeScript support (Node 22.18+).

## Referrals

Every number shown is real: the position is a rank over the actual rows, the total is the real row count, and
there is no simulated counter, starting offset or padding. The settings live in
`src/lib/waitlist/referral-config.ts`: `SPOTS_PER_REFERRAL = 5`, `BETA_GROUP_LIMIT = 20`, and `SHOW_TOTAL_FROM = 25`
(the "N people are waiting" line only shows from 25 sign-ups, so a tiny list doesn't look empty).

**Position** (`src/lib/waitlist/position.ts`): scan `phone, created_at, referral_count`, sort by `created_at` to get
each row's join order (1-based), subtract `referral_count x SPOTS_PER_REFERRAL`, clamp at 1, then rank by that score
with ties going to whoever joined first. Positions run 1..total with no gaps. Example: 13 people have joined and A
was 13th. Two friends join with A's link, so A's score is 13 - 2 x 5 = 3. The 3rd person to join also has score 3
but joined earlier, so A is **#4** of 15.

The scan result is cached in memory for 30 seconds per server instance (dropped on that instance after any
sign-up, and refreshed whenever the person being shown isn't in it yet). This is fine at this scale; **past a few
thousand rows, move it to a counter or a sorted index** instead of scanning on every sign-up.

**Crediting** (`src/lib/waitlist/signup.ts`): a sign-up is credited when its code (the invite page's hidden form
field, or else the `tab_ref` cookie) belongs to a real row with a different phone number, and the sign-up is
new. Duplicates and self-referrals never count. A duplicate sign-up shows the same result card for the existing
row.

**Pages**

- `/i/<code>`: the landing page with "A friend invited you to Tab" on top. Both forms carry the code in a hidden
  field, and a first-party `tab_ref` cookie (30 days, `SameSite=Lax`) keeps the credit if the visitor browses
  around first. An unknown code renders the normal page with no banner and no error. The page only learns whether
  a code is real; the referrer's phone number never leaves the server. `noindex`, canonical `/`, title "You're
  invited to Tab", and its own preview image (`src/app/i/[code]/opengraph-image.tsx`, the same for every code).
- `/w/<code>`: check your spot later. The same result card, found by the code, without the phone number. Note
  the invite code is in every link a person shares, so anyone holding an invite can see that person's position and
  friend count (never their number).

**Sharing.** "Share your invite" uses the native share sheet on touch devices with the Web Share API; otherwise (or
if that is cancelled) a custom sheet opens with the link, Copy, Messages, WhatsApp, X and Email.

## Signup webhook (double opt-in through Tab)

Nothing is texted at sign-up today. Tab's own line will text everyone still `pending_confirmation` once it is
live. The waitlist calls a single hook, `notifyWaitlistSignup(row)` in `src/lib/waitlist/notify.ts`, after the
response is sent (Next's `after()`), so it never slows the form down:

- `TAB_SIGNUP_WEBHOOK_URL` unset: it logs `notifyWaitlistSignup: no TAB_SIGNUP_WEBHOOK_URL, skipping` and returns.
- Set (with `TAB_SIGNUP_WEBHOOK_SECRET`): it POSTs the new sign-up as JSON, with a 5 second timeout, and on a
  2xx sets `notified_at`. Failures are logged and never undo the sign-up. A URL without a secret is refused.

Request:

```http
POST <TAB_SIGNUP_WEBHOOK_URL>
Content-Type: application/json
User-Agent: tab-site-waitlist/1
X-Tab-Event-Id: <signup id>
X-Tab-Timestamp: <unix seconds>
X-Tab-Signature: v1=<hex HMAC-SHA256(TAB_SIGNUP_WEBHOOK_SECRET, "<timestamp>.<raw body>")>

{
  "type": "waitlist.signup",
  "id": "1ff32e26-0d3c-4f49-ba16-088fa93d9025",
  "created_at": "2026-10-06T07:30:00.000Z",
  "data": {
    "id": "1ff32e26-0d3c-4f49-ba16-088fa93d9025",
    "phone_e164": "+14155552671",
    "status": "pending_confirmation",
    "consent_text": "Text me when Tab is ready. I agree that Tab may text this number about the beta and its launch, usually just a few messages. Message and data rates may apply. Reply STOP anytime to opt out. ",
    "consent_version": "2026-10-06.v1",
    "consent_at": "2026-10-06T07:30:00.000Z",
    "signup_location": "hero"
  }
}
```

The receiver should check the signature over the raw body, reject timestamps more than 5 minutes off, treat
`X-Tab-Event-Id` as an idempotency key, and answer 2xx quickly. Then Tab texts the number from its own line
("You're on the list. Reply YES to confirm.") and moves the item to `confirmed` (or `opted_out` on STOP).

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

export function verifyTabSignature(rawBody: string, timestamp: string, header: string, secret: string) {
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false
  const expected = 'v1=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  return expected.length === header.length && timingSafeEqual(Buffer.from(expected), Buffer.from(header))
}
```

## Deploying to Vercel at addtab.app

1. In Vercel, **Add New Project** and import this repo. Set **Root Directory** to `site`. The framework is detected
   as Next.js; leave the build command (`next build`) and output settings at their defaults.
2. Under **Settings > Environment Variables**, add the production values above (at least `AWS_REGION`,
   `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `IP_HASH_SECRET`; plus Turnstile and PostHog when you have
   them). Mark the secrets as Sensitive.
3. Deploy. A production build with required values missing fails on purpose, naming what's missing.
4. Under **Settings > Domains**, add `addtab.app` (and `www.addtab.app` redirecting to it). Vercel shows the exact
   DNS records to create at the registrar (an `A` record for the apex and a `CNAME` for `www`).
5. In Cloudflare Turnstile, add `addtab.app` to the widget's hostnames.
6. Check `https://addtab.app/opengraph-image` and paste the link into an iMessage to see the preview. Do the same
   with an invite link (`https://addtab.app/i/<code>`, preview at `/i/<code>/opengraph-image`).
7. Make sure the `by_ref_code` index is `ACTIVE` and the site's IAM key has the policy above before deploying.

## How the page is put together

- `src/app/page.tsx` is a server component. Every section is server-rendered in its **finished state**, so the
  page is complete with JavaScript off and is exactly what reduced-motion visitors see: the whole Vegas chat with
  the receipt settled, every dinner step crossed out, both endings available through a native radio toggle,
  the full conversations in all three phones.
- Animation is progressive enhancement. GSAP enhancers (`src/components/enhancers/`) and the Motion islands
  (`src/components/live/`) live in lazy chunks that start loading on the visitor's first touch, scroll or key
  press, once the section is near. Lenis never loads on touch-first devices or with reduced motion.
- Only `transform` and `opacity` animate. The phone mockup is drawn at full size and scaled with a transform; its
  bezel is a CSS 3-slice `border-image`, so the pinned phone can be shortened on small screens.
- **Vegas story** (`enhancers/VegasTimeline.tsx`): one ScrollTrigger timeline with `scrub`, pinned with
  `gsap.matchMedia` timelines for phones (shorter scroll, compact receipt, 100svh stage) and desktop.
- Analytics events (no form contents or phone numbers ever): `$pageview`, `scroll_depth` (25/50/75/100),
  `section_viewed`, `waitlist_form_started`, `waitlist_submitted`, `waitlist_succeeded` (with `duplicate` and
  `referred`), `waitlist_failed` (with a reason code), `waitlist_position_shown` (with a `position_bucket` like
  `11-25`, never the exact spot), `invite_share_clicked` (with `method`: `native`, `copy`, `sms`, `whatsapp`, `x`,
  `email`; `native` is sent once the native share completes), `invite_page_viewed` (with `valid`).
- SEO: metadata and Open Graph/Twitter image (`opengraph-image.tsx`, generated with `next/og` from the hero),
  `robots.txt`, `sitemap.xml`, and JSON-LD for `SoftwareApplication` and `FAQPage` (built from `src/content/faq.ts`,
  the same data the FAQ renders).

## Placeholders still to fill

- The demo conversations, names and amounts are the design's illustrative copy.
