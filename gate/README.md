# @tab/gate: the classifier gate

Implements `classify()` from SPEC 6.3 for the backend.

```ts
import { jevClassifier, stubClassifier } from '@tab/gate';

const classify = process.env.TYPESAFE_API_KEY
  ? jevClassifier({ apiKey: process.env.TYPESAFE_API_KEY })
  : stubClassifier;

const { intent, confidence } = await classify({ message, context, members, open_items });
```

- **`jevClassifier`** asks TypeSafe's Jev one choice question over the 14 intents in SPEC 6.1. Each option is written as a rule (SPEC 6.5). The state it sends is labeled data: chat type, members, the sender's open items, recent messages, and the new message. `confidence` is Jev's probability for the chosen intent, which is what the 0.85 and 0.50 thresholds in SPEC 6.4 expect. Reactions, system events, and bare photos never reach Jev.
- **`stubClassifier`** is conservative keyword rules, for working offline or when Jev is down.
- **`withPrefilter(classify)`** answers `{ intent: "ignore", confidence: 1, prefiltered: true }` without calling `classify` when `mightBeMoney(input)` is false, so "lol" and "who's driving" never cost a Jev call. It passes amounts, money and purchase words, Tab's commands, photos, DMs, replies to Tab, unnamed senders (name prompt), `tab_question_open`, and anything while the sender has an item list, a proposed split, or a settle request open. When unsure it passes. The backend puts it in front of Jev unless `GATE_PREFILTER` is `off|false|0|no`; `gate/test/prefilter.test.ts` checks that no money fixture is ever skipped.

## Input conventions

- Put Tab's own recent messages in `context` with `sender_phone: "tab"`, and list `{ phone: "tab", name: "Tab" }` in `members`. Otherwise those lines render as "member ending tab", and Jev can't see what Tab just asked.
- `open_items` drives the "Settle request open for the sender: yes/no" line. An approval only counts when a finalized expense has the sender's share `locked`, so keep it accurate.

## Fixtures

`fixtures/messages.json` (repo root) holds the 18 fixtures from SPEC 6.6, each with the context it needs. Run them after every change to the rules:

```sh
npm run fixtures -- jev    # needs TYPESAFE_API_KEY
npm run fixtures -- stub
```

`fixtures/messages-extended.json` adds 75 realistic cases (including inline replies and `settle_up`): varied phrasings for every intent, money talk that isn't an expense, injection attempts, and agreement words with no settle request open. A third argument repeats the run, and the summary counts **wrong and confident enough to act**, the failure that matters:

```sh
npm run fixtures -- jev messages-extended 3
```

Last run (2026-10-03, 2 runs each): **spec fixtures 36/36, extended 150/150, and 0 wrong-and-confident results.** Median latency is about 125 ms, p95 about 200 ms.

Like the seed scripts, this reads `.env` from the package folder; use `DOTENV_CONFIG_PATH=$PWD/.env` from the repo root.
