# @tab/gate: the classifier gate

Implements `classify()` from SPEC 6.3 for the backend.

```ts
import { jevClassifier, stubClassifier } from '@tab/gate';

const classify = process.env.TYPESAFE_API_KEY
  ? jevClassifier({ apiKey: process.env.TYPESAFE_API_KEY })
  : stubClassifier;

const { intent, confidence } = await classify({ message, context, members, open_items });
```

- **`jevClassifier`** asks TypeSafe's Jev one choice question over the 13 intents in SPEC 6.1. Each option is written as a rule (SPEC 6.5). The state it sends is labeled data: chat type, members, the sender's open items, recent messages, and the new message. `confidence` is Jev's probability for the chosen intent, which is what the 0.85 and 0.50 thresholds in SPEC 6.4 expect. Reactions, system events, and bare photos never reach Jev.
- **`stubClassifier`** is conservative keyword rules, for working offline or when Jev is down.

## Fixtures

`fixtures/messages.json` (repo root) holds the 18 fixtures from SPEC 6.6, each with the context it needs. Run them after every change to the rules:

```sh
npm run fixtures -- jev    # needs TYPESAFE_API_KEY
npm run fixtures -- stub
```

Last run (2026-10-03): **Jev passes 18/18**. Everything is above 0.85 except "pizza was $48 lol" at about 0.89, and the prompt injection comes back `ignore` at 0.98. The stub passes 17/18.

Like the seed scripts, this reads `.env` from the package folder; use `DOTENV_CONFIG_PATH=$PWD/.env` from the repo root.
