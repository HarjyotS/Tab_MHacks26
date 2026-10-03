# Tab build plan — MHacks 2026

Written Sat Oct 3, ~4 PM. Hacking ends **Sun Oct 4, 12:00 PM** (Devpost hard deadline). Judging 12:30–2:30 PM at the Duderstadt Center, 3-minute slots, whole team present.

## Decisions (changes from SPEC.md)

| Decision                     | Was                                     | Now                                                                                                                                              |
| ---------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| iMessage client              | Photon Spectrum, managed cloud provider | **Photon Spectrum local** (`@spectrum-ts/imessage-local`) on Harjyot's Mac. Try to upgrade to Spectrum Cloud via the Photon sponsor (see below). |
| LLM | Grok extraction, Jev classifier | Grok extraction, receipt vision, and **Grok Voice STT**. Classifier: a Grok stub behind the §6.3 interface now; Harjyot swaps in Jev once the client is stable. |
| SpaceXAI "Make it Legendary" | Optional                                | **Target**: requires building in **Cursor** + using Grok Voice or Imagine                                                                        |
| Spacetime                    | Core backend                            | Unchanged, still the core                                                                                                                        |

### Photon local gaps (from Photon's docs)

| Capability                                 | Cloud           | Local                                                     |
| ------------------------------------------ | --------------- | --------------------------------------------------------- |
| Text, attachments, contact cards           | Yes             | Yes                                                       |
| Reactions, replies, edits, unsend, effects | Yes             | **No**                                                    |
| Typing indicator                           | Yes             | No-op                                                     |
| Membership and group events                | Dedicated lines | **No**                                                    |
| Sending to a group                         | Anytime         | **Only if the group was received in the current session** |

Spec features this breaks, and the fix:

| Spec feature                                          | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **👍 on the settle request moves money (§6.2, §7.6)** | 1st choice: **get Spectrum Cloud credentials from Photon's sponsor table/Discord tonight**. It's a one-package swap (`imessage-local` → `imessage`). 2nd: Harjyot adds a small **chat.db tapback reader** next to Photon on the same Mac: poll `message` rows with `associated_message_type` 2000–2005, strip `p:0/` from `associated_message_guid` for `reply_to_id`, and ingest them as `kind: reaction`. 3rd: text-only approvals ("yes"), which already exist per §6.2. |
| `sent_photon_id` for tapback matching                 | Check whether local `send` returns an id. If not, the chat.db reader looks up Tab's newest `is_from_me = 1` row in that chat with matching text.                                                                                                                                                                                                                                                                                                                            |
| Tab's own tapbacks (§13)                              | Not sendable locally. Like → no message (the proposal itself confirms). Question → just send the clarifying question.                                                                                                                                                                                                                                                                                                                                                       |
| Typing indicator (§7.4)                               | Dropped                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Member list (§7.2)                                    | Members appear as they speak, or read `chat_handle_join` from chat.db                                                                                                                                                                                                                                                                                                                                                                                                       |
| Proactive group posts after a restart                 | After every client restart, a teammate texts the demo group before Tab needs to post. Add it to the demo checklist.                                                                                                                                                                                                                                                                                                                                                         |

## Prize targets

| Prize                                    | What we must show                                                                         | Owner               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------- |
| Grand Prize ($5,000) + FinTech ($2,500)  | The whole product                                                                         | All                 |
| Best Use of Spacetime ($1,000)           | Every component talks through SpacetimeDB; split math in `recompute_expense`; ledger live | Kian                |
| Photon: Agents in iMessage ($700 / $300) | Spectrum connects the agent to iMessage (local counts; cloud shows off reactions)         | Harjyot             |
| Capital One Nessie                       | Per-member accounts, real Nessie transfers on 👍                                          | Kian                |
| SpaceXAI                                 | Built in Cursor (everyone, all night); voice memo → Grok Voice STT → expense              | Joe                 |
| Notability                               | Whiteboard/architecture in Notability Pro; 2+ screenshots on Devpost; tag it              | Anyone, by Sun 9 AM |
| MLH .Tech domain                         | Ledger hosted on a .tech domain                                                           | Anyone              |
| Judged by an LLM                         | Clear, structured, specific Devpost write-up (no tricks)                                  | Joe                 |

Still open: ask in Discord how many sponsor tracks one project can enter.

## Team

| Area                                                                            | Owner       |
| ------------------------------------------------------------------------------- | ----------- |
| Integrations (`client/`): Photon client, outbox loop, image hosting, contact card, **Nessie worker**, swapping in Jev | **Harjyot** |
| Brain: classifier stub, Grok extraction, intent handlers, expense state machine, scheduler, message templates | Joe |
| Data and ledger: SpacetimeDB module, `recompute_expense` with the test vectors, web ledger | Kian |

## Client (SPEC §10, adjusted for local mode)

Everything in SPEC §10 still applies except the items in the gaps table above. Harjyot's Mac runs the client, so it must stay awake (`caffeinate -dimsu`) and plugged in all night, with Full Disk Access granted to the process. Images and audio arrive as attachments: convert HEIC → JPEG with `sips` and CAF → WAV with `afconvert` before handing them to the backend.

## Timeline and checklist

### Phase 0 — Spike and contract (4:00 → 6:00 PM)

- [ ] Everyone installs Cursor and works in it from now on (SpaceXAI).
- [ ] **Joe or Harjyot: go to Photon's sponsor table/Discord now and ask for Spectrum Cloud credentials.** That fixes tapbacks for free and keeps us strong for the Photon prize.
- [ ] **Harjyot's client spike:** with Photon local, receive a group text and a DM, send one of each, and send an image and a .vcf. Check whether `send` returns a message id. Then tap 👍 on Tab's message and confirm it does **not** arrive through Photon. If cloud credentials aren't coming, start the chat.db tapback reader.
- [ ] Check SpacetimeDB module language support (TypeScript module vs Rust) and the TS client SDK; pick one.
- [ ] Get API keys: `XAI_API_KEY`, `NESSIE_API_KEY`. Confirm the Grok structured-output model, the vision model, and the Voice STT endpoint against docs.x.ai.
- [ ] Repo scaffold per SPEC §21, `.env.example`, `.gitignore`, `fixtures/`.
- [ ] Update SPEC.md: §2.1 prizes (Grok/SpaceXAI), §3 client owner = Harjyot, §3 Nessie owner = Harjyot, §10 local-mode gaps, §13 tapbacks. Announce in team chat (contract change).
- [ ] **M0:** module deployed with all §5 tables and reducers (stubs OK); each person can write and read fake rows.

### Phase 1 — Echo loop (6:00 → 8:30 PM)

- [ ] Kian: `ingest_message` (upsert + auto-create group/members), `mark_outbox`, `enqueue_outbox`, `set_message_result`.
- [ ] Harjyot: Photon inbound → `ingest_message`; outbox subscriber → Photon send → `mark_outbox` with the sent id. Max 3 retries.
- [ ] Joe: backend processing loop (§11.1) with a keyword-stub `classify` and a handler that echoes.
- [ ] **M1:** text in the group → row in `messages` → outbox row → reply appears in iMessage. Tapback on Tab's reply arrives with the correct `reply_to_id`.
- [ ] Note: Duderstadt doors lock at 8 PM.

### Phase 2 — Money core (8:30 PM → 1:00 AM)

- [ ] Kian: `recompute_expense` implementing §8, with **all 8 test vectors from §8.2 as unit tests, written first**.
- [ ] Joe: Grok `classify` (structured output over the §6.1 labels) replacing the stub; run all 18 fixtures from §6.6 (`fixtures/messages.json`) as a test.
- [ ] Joe: Grok `ExpenseExtraction` + grounding check (§9.1); text-expense flow §7.3; split proposal; objection window; finalize; settle request. Templates for every number (P6).
- [ ] Joe: onboarding §7.2 (intro, name prompt, contact card .vcf via file send, `name_reply`).
- [ ] Joe: config file §11.3 with `DEMO_MODE`; scheduler loop §11.2.
- [ ] Harjyot: Nessie worker §12.2 (account creation, seeding, idempotent transfers); `create_transfer`, `update_transfer`, `set_nessie_ids`.
- [ ] **M2:** "got pizza for everyone, $48" → proposal → "not even, John only had a diet coke" → updated split → finalized in DEMO_MODE.
- [ ] **M3:** 👍 on the settle request → transfer → Nessie done → share paid → receipt DM.

### Phase 3 — Receipts, ledger, voice (1:00 → 6:00 AM)

- [ ] Joe: Grok vision `ReceiptExtraction` + math check §7.4 + lopsided check; itemizing, claims (`ClaimResolution`), DM follow-ups §7.5. Test on 4 real receipts (one crumpled, one with a handwritten tip).
- [ ] Kian: web ledger §12.3: live balances, expense drill-down, money-flow graph, transfer animation. Projector-friendly.
- [ ] Joe: **voice memo expenses (SpaceXAI):** audio attachment → `afconvert` → Grok Voice STT → transcript into the normal text-expense path. Store the transcript as the message `text`.
- [ ] Corrections §7.7 and balance/breakdown queries §7.8.
- [ ] **M4:** receipt → item list → judge claims "1 and 4" → teammate gets a DM, replies "2" → finalize.
- [ ] **M5:** ledger updates live during the chat.
- [ ] Anyone: register the .tech domain and point it at the ledger.

### Phase 4 — Freeze and demo (6:00 AM → 12:00 PM)

- [ ] **8:00 AM feature freeze.** Bug fixes only after this.
- [ ] Record the backup video of the full flow as soon as M4 works, and again after the freeze.
- [ ] Cut the demo script (§16.2) to **~2:15** so there's room for questions in the 3-minute slot.
- [ ] Rehearse twice with the real phones and ledger on the projector.
- [ ] Interview notes: whatever was logged in `docs/interviews.md` (goal: 15). Pull 1–2 quotes and numbers for the pitch.
- [ ] Notability screenshots (2+).
- [ ] Devpost: problem, how it works, architecture (Spacetime as core), Grok usage (classify, extract, vision, voice), Nessie, "built in Cursor", Notability, table number, **all teammates added**, repo link, video. Write it clearly for both humans and the LLM judge.
- [ ] **Submit by 11:30 AM.** Hard deadline is 12:00.

## Risks

| Risk                                                     | Mitigation                                                                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| No Photon Cloud credentials and the tapback reader slips | Text approvals ("yes", §6.2) already work. Demo with "yes" replies, and show 👍 in the backup video only if the reader works. |
| Group posts fail after a client restart (session-bound)  | A teammate texts the group after every restart. It's on the demo checklist.                                                   |
| Local `send` returns no message id                       | Look up Tab's newest sent message in chat.db, matched on chat + text + time. The outbox sends one message at a time per chat. |
| DMs from Tab land in Unknown Senders                     | Contact card at onboarding; group-mention fallback (§7.5). Test on a phone that has never texted Tab.                         |
| Mac sleeps or Messages quits overnight                   | `caffeinate -dimsu`; keep it plugged in.                                                                                      |
| Running out of time                                      | Cut order: voice memos → corrections/queries → itemizing DM follow-ups → money-flow graph. Never cut M1–M3.                   |
