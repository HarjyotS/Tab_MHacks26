# addtab.app

The marketing site and waitlist for Tab, the iMessage group-chat bot that keeps the tab. Built from the design
reference in `../landing/` (`Main.dc.html`), which stays untouched.

- **Next.js 16** (App Router, TypeScript, Turbopack), deployed on **Vercel**.
- **GSAP + ScrollTrigger + SplitText** (via `@gsap/react`'s `useGSAP`) for the scroll-driven Vegas story, the
  "pay for dinner" strike-through and section headings.
- **Motion** for the bubble wall (spring pops, drag with momentum), the two-endings toggle and the three looping phones.
- **Lenis** smooth scrolling on mouse and trackpad only, driven by GSAP's ticker.
- **Waitlist**: a server action writing to **AWS DynamoDB**, optional **Cloudflare Turnstile**, phone numbers
  normalized to E.164 with `libphonenumber-js`.
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
| `NEXT_PUBLIC_SITE_URL` | Optional | Canonical URL, default `https://addtab.app`. |
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

Minimal IAM policy for the site's key (add `dynamodb:Scan` only on the separate key you use for exports):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:PutItem", "dynamodb:UpdateItem"],
      "Resource": "arn:aws:dynamodb:us-east-1:<ACCOUNT_ID>:table/tab-waitlist"
    }
  ]
}
```

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
utm_source`, oldest first. Values that start with `=`, `+`, `-` or `@` (other than phone numbers) are prefixed
with `'` so a spreadsheet won't run them as formulas. It runs on Node's built-in TypeScript support (Node 22.18+).

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
    "consent_text": "Text me when Tab is ready. I agree that Tab may text this number about the beta and its launch, usually just a few messages. Message and data rates may apply. Reply STOP anytime to opt out. See our Privacy Policy and Terms.",
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
6. Check `https://addtab.app/opengraph-image` and paste the link into an iMessage to see the preview.

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
- Analytics events (no form contents ever): `$pageview`, `scroll_depth` (25/50/75/100), `section_viewed`,
  `waitlist_form_started`, `waitlist_submitted`, `waitlist_succeeded`, `waitlist_failed` (with a reason code).
- SEO: metadata and Open Graph/Twitter image (`opengraph-image.tsx`, generated with `next/og` from the hero),
  `robots.txt`, `sitemap.xml`, and JSON-LD for `SoftwareApplication` and `FAQPage` (built from `src/content/faq.ts`,
  the same data the FAQ renders).
- `/privacy` and `/terms` are full plain-English drafts marked "Draft for lawyer review". They are `noindex` and
  left out of the sitemap until the reviewed text replaces them.

## Placeholders still to fill

- `[COMPANY LEGAL NAME AND ADDRESS, to be added]` in the Privacy Policy and Terms.
- `[STATE]` (governing law) and the liability wording note in the Terms.
- The demo conversations, names and amounts are the design's illustrative copy.
