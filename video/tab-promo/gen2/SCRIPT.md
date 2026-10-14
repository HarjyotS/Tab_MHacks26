# Tab, gen 2: "The Kiens"

Status: script and shot sheet for review. Nothing has been generated yet. The only Higgsfield calls made were read-only `generate cost` checks (balance: 270 credits).

Two cuts come from one set of footage. **SHORT** runs 50.0 s (48.2 s without the button) and leads with comedy. **FULL** runs 80.0 s and adds the product and the growth beat. Both are 30 fps, 1920×1080, edited in Remotion.

---

## 1. Logline, why it's funny, what it sells

**Logline.** Eleven friends go to dinner, and all eleven are Kien. Ten of them are cartoon versions of Kien: a pirate, a wizard, a rice farmer, a grandpa, a baby in a high chair, and so on. The eleventh is the real Kien in his blue hoodie, and he's the one with a credit card. The bill is $1,188.00 and the waiter allows one card. Ten Kiens yell "just pay, i'll get you back!" Real Kien pays, and the group chat falls apart. Then he adds Tab. One message and ten 👍 taps later, he has his money back.

**Why it's funny**
- **Premise.** We had one actor and 170 credits, so everyone is Kien, and we lean into it. It's an honest hackathon budget joke. It's also a fair point about friend groups: they're all the same guy saying "i'll get you back." The waiter is Kien too. When he says "sorry, group's too big," he's talking to one guy.
- **Specific jokes, not generic ones.** "can i pay in doubloons" / "can i pay in rice" / "can i pay in exposure" / kien: "no." Grandpa signs his texts. The astronaut texts "i'll just text you later," and Kien answers "you are texting me." That line calls back gen 1's taco clip.
- **Callbacks that pay off.** A deadpan narrator says "kien would not see this money again." Later she says "kien saw this money again." The wizard's "how much do i owe again?" gets buried in the flood, and Tab answers it right away later. The last laugh lands on Kien himself, who still owes Sam $6.50 for gen 1's tacos.
- **Timing.** The music cuts out for the punchlines: the receipt, the waiter, the freeze-frame, the dead stare. The drop hits on the cut to the group chat, the loudest moment in the film.

**Growth theme ("build something that grows").** More friends means more mess over who owes whom. Act II shows the mess growing with eleven people. Act IV pulls back to a banquet hall of about 100 Kiens, and the narrator says: "tab grows with your group, so money never gets between friends." The tagline ties it off: **friendships compound. debts shouldn't.**

**Money never gets between friends.** In the flood, Kien has to ask "can you guys send the money" himself, and nobody pays him. Once Tab joins, Tab does the asking. One caption says it outright: *"tab asks for the money, so kien doesn't have to."*

**Product accuracy.** Every Tab message below is real template copy from `backend/src/copy/templates.ts`, including `compose()` lowercasing everything. Every flow follows the SPEC:
- A receipt gets an even proposal, because no line item is over 1.5× the per-person share (`LOPSIDED_FACTOR`).
- "settle up" triggers the settle request (ledger mode is the default).
- A typed "yes" never pays; Tab points the person to 👍.
- Each person who taps 👍 gets their own DM confirmation.
- Non-money talk never reaches the AI.

---

## 2. Cast

Every Kien is the same face (refs: `public/gen2/ref/IMG_0198.jpg` front, `IMG_0199.jpg` side). Chat names are what real Kien saved in his contacts. Tab writes member names exactly as saved (since #37: only its own copy goes lowercase), so GRANDPA KIEN stays in caps inside Tab's messages too. Avatars come from the 12 approved single portraits (`public/gen2/cast/<id>.png`, 512² crops in `public/gen2/cast/<id>-avatar.jpg`, contact sheet `gen2/cast-contact.jpg`) and are passed to `ContactPhoto img=`. These portraits replace H01.

| id | Character | Costume (prompt shorthand) | Chat display name | Avatar crop shows | The joke | Delivery |
|---|---|---|---|---|---|---|
| `real` | **Kien** (real, phone owner) | plain light Carolina-blue hoodie (no logo), khakis | **kien** (blue bubbles, no avatar: it's his phone) | n/a (credits use a crop of IMG_0198) | The only normal one. Freeze tag: "kien (has a credit card)". | Real Kien: tired, hopeful, then dead inside |
| `wizard` | Wizard | round wire glasses, black robe, plum-and-mustard striped scarf, wand behind ear, white owl on shoulder | wizard kien 🧙 | glasses, scarf, owl wing | Asks "how much do i owe again?" right after the receipt is posted, and again later. Wizard cut: "…that's not my owl." | Earnest, slightly lost |
| `captain` | Pirate captain | tricorn, eyepatch, white shirt, red sash, gold hoop, hook hand | cap'n kien 🏴‍☠️ | tricorn and eyepatch | "can i pay in doubloons". Leaves the chat; Kien adds him right back. | Pirate growl |
| `farmer` | Super rice farmer | wide-brim woven straw hat, denim overalls, rice stalk in teeth, hugs a 50 lb rice sack; tower of rice bowls | farmer kien 🌾 | straw hat, rice stalk | "can i pay in rice". The receipt says 47 STEAMED RICE. | Sincere, mouth full |
| `fluencer` | Influencer | pastel oversized hoodie, bucket hat, ring light on table, selfie stick | kienfluencer 📸 | bucket hat, ring-light catchlight | "can i pay in exposure". The receipt has an OUTLET FEE (RING LIGHT). | Vocal fry |
| `gainz` | Gym bro | neon stringer tank, headband, giant shaker, flexing | kien gainz 💪 | headband, traps | "thanks king 🙏", then "gimme 3 secs i'll venmo u", then 3 days later "bro venmo's being weird". The receipt has CORKAGE: OWN SHAKER. | Hype bro |
| `grandpa` | Grandpa | aged to 80: white hair, bushy mustache, cardigan, suspenders, glasses chain, flip phone | GRANDPA KIEN 👴 (saved in caps) | white mustache, glasses | Signs his texts. Types "YES - GRANDPA" instead of tapping. His DM arrives in max text size. | Shouty, reads his own signature aloud |
| `space` | Astronaut | white spacesuit (no flags or logos), clear bubble helmet on, dumpling stuck to the glass | space kien 🚀 | helmet with face inside | "signal's bad up here / i'll just text you later". Later: "anyone else think the waiter looked exactly like kien" (privacy beat). | Radio-filtered |
| `holmes` | Detective | tan trench coat, deerstalker, giant magnifying glass, magnified eye | kienlock holmes 🔍 | deerstalker, magnified eye | "who got the extra dumplings" / "one of you is lying" (they're all him). The receipt has XIAO LONG BAO - EXTRA??. | Noir whisper |
| `ceo` | CEO | navy three-piece suit, slicked hair, sunglasses indoors, earbuds, phone at each ear | kien ceo 💼 | sunglasses, earbud | "i'll get you back in like a week 🤝". The receipt has an A5 WAGYU ADD-ON. | Fast, distracted |
| `baby` | Baby | adult in a frilly bonnet and plain bib, pacifier clip, sippy cup, giant wooden high chair | baby kien 🍼 | bonnet, pacifier | "i'm literally a baby". **Pays first.** | Baby talk in Kien's voice |
| `waiter` | Kevin, the waiter | black vest, white shirt, slicked side part, pencil mustache, blank gold badge, card terminal | n/a | n/a | He's also Kien. "sorry. group's too big. one card." Tag: "kevin (also kien)". | Polite monotone |
| `Tab` | Tab | n/a | Tab (gray bubbles, orange "T" `ContactPhoto`) | n/a | The only adult in the chat | n/a (text only) |

**Seating** (for every multi-Kien prompt). Go clockwise from the far side of the table, facing camera:

real Kien (far side, center) → baby (high chair) → grandpa → astronaut → gym bro → farmer → captain (near side, back to camera, tricorn visible) → wizard (owl) → influencer (ring light) → detective → CEO (next to real Kien).

**Group chat:** "the kiens 🥟". Header avatars (first 5): wizard, captain, farmer, grandpa, baby. After Tab joins, Tab's T goes first.

---

## 3. Layout zones (audit-safe) and the iMessage build

**Phone POV: real Kien's iPhone, iOS dark mode.** His messages are blue and on the right, with no name or avatar. Everyone else, including Tab, is gray on the left. The sender's name sits above the first bubble of a run, and their contact photo sits at the bottom of the run with the tail. Use `IPhone`, `IThread`, `IBubble`, `Typing`, `IBanner` and `ContactPhoto` from `src/imessage.tsx`.

**Zones on the 1920×1080 frame.** Nothing may overlap. Readable text must be ≥30 px, captions ≥56 px.

| Scene type | Zone | Box (x, y) | Holds |
|---|---|---|---|
| Live action | full bleed | 0–1920, 0–1080 | video or still |
| | tags | y 40–900 | freeze-frame name tags (34–40 px pills); they must not overlap each other |
| | **caption band** | y 930–1060, centered pill | `Caption` 62 px, one line, max ≈ 48 chars |
| Chat | **phone** | x 180–740, y 40–1040 (560×1000) | `IPhone`; thread viewport is ≈ 492×620 |
| | **R-top stage** | x 860–1800, y 60–800 | portrait cards (≈ 520×640, name label 40 px under the photo), notification banners, waiter card |
| | **R-bottom caption** | x 860–1800, y 840–1000 | side caption, 60 px, max 2 lines (≤ 52 chars) |
| | backdrop | full | blurred, darkened H02 (Act II) or H10 (Act III) |
| Receipt macro | paper | x 510–1410 (900 wide) | DOM receipt, mono 34 px (40 chars/line), head-on (Q6) |
| End card | centered column | n/a | tagline 96 px, wordmark, descriptor 44 px, feature row 34 px |

**Thread capacity.** At `size={34}` a bubble fits about 21 chars per line. Plan for about 4–5 short messages visible at once. Every flood line below fits in 1–2 lines. Tab's long messages, the intro and the settle request, scroll inside the thread. Show the top first, then scroll so the bottom and the tapback are visible. Use `size={36}` for the Tab beats.

**Component asks** (small additions to `imessage.tsx` / `components.tsx`):
1. **Gray tapback badge with a count**, for reactions from *other people* on a received message. The current blue badge on received messages means "I reacted." Use it on Tab's settle request: 👍, then 👍 2, …, then 👍 10. Kien never taps it, since Tab ignores the payer's own 👍.
2. **Centered system and timestamp rows** (30 px, `#98989f`): "cap'n kien left the conversation.", "You added cap'n kien to the conversation.", "You added Tab to the conversation.", "Mon 9:41 AM", "Today 10:52 PM".
3. **Unread badge next to the back chevron** in the header: "‹ 99+" (30 px).
4. **Thread `scrollY` prop**, to pan through the settle request.
5. **`SideCaption`** (`data-box="caption:…"`) for R-bottom, and **`PortraitCard`** (`data-box="portrait:…"`) for R-top.
6. **Phone-owner header on banners:** a 34 px label above each `IBanner`, e.g. "baby kien's phone". Back cards in the notification stack are blank slivers with `data-overlay`. Add a **max-text-size variant** for grandpa (body 64 px).
7. **`Receipt`** DOM component (§4), used three ways: macro scroll, composited on the H05 plate (`data-texture` except the restaurant name), and exported as `public/gen2/img/receipt-photo.png` for the chat photo bubble. **The chat photo is a frame export of the same composite, so it is identical by construction.**
8. **`Tag`** pills for freeze frames (`data-box="tag:…"`), positioned from head coordinates measured on the generated frame.

---

## 4. The receipt (our designed graphic)

Use 34 px monospace (e.g. JetBrains Mono, or Courier Prime for thermal-printer feel) on warm off-white thermal paper with a faint print fade. It's 40 chars per line, 900 px wide, about 2,300 px tall. The CJK line needs a Noto Sans TC fallback. **Have a native speaker check 大家庭海鮮酒家 ("big family seafood restaurant"), or drop the line.**

```
    BIG HAPPY FAMILY SEAFOOD PALACE
             大家庭海鮮酒家
  2026 WASHTENAW AVE · ANN ARBOR, MI
            (734) 555-0188
----------------------------------------
TABLE 11     GUESTS 11     SERVER: KEVIN
CHK #4471             10/02/26   9:47 PM
----------------------------------------
1  PEKING DUCK (WHOLE)             68.00
1  PEKING DUCK #2 (FOR TABLE)      68.00
2  LIVE LOBSTER (MKT)             108.00
1  WHOLE STEAMED FISH (MKT)        40.41
3  XIAO LONG BAO (8PC)             41.85
1  XIAO LONG BAO - EXTRA??         13.95
2  PORK & CHIVE DUMPLING           23.90
47 STEAMED RICE                   117.50
1  YANG CHOW FRIED RICE            16.95
1  HONEY WALNUT SHRIMP             24.95
1  SALT & PEPPER SQUID             19.95
1  SIZZLING PEPPER BEEF            26.95
1  A5 WAGYU ADD-ON (4OZ)           89.00
1  GENERAL TSO'S CHICKEN           17.95
1  MAPO TOFU                       15.95
1  BEEF CHOW FUN                   17.95
1  GAI LAN W/ OYSTER SAUCE         14.95
1  CRAB RANGOON (24PC)             21.95
11 TARO MILK TEA                   71.50
4  MANGO PUDDING                   27.80
1  SESAME BALLS                     9.95
1  CHEF'S SPECIAL "DON'T ASK"      38.00
1  CORKAGE: OWN SHAKER             15.00
1  KIDS NUGGETS                     8.95
1  APPLE JUICE (SIPPY CUP)          3.50
1  HOT WATER + STRAW                0.00
1  FORK                             0.00
1  BIRTHDAY SONG (NO BDAY)          0.00
1  PLATE (BROKEN)                  12.00
1  BIRD SEED (OWL)                  3.00
1  OUTLET FEE (RING LIGHT)          5.00
11 FORTUNE COOKIES                  0.00
----------------------------------------
SUBTOTAL                          942.86
SALES TAX 6%                       56.57
AUTO-GRATUITY 20% (PARTY 8+)      188.57
========================================
TOTAL                          $1,188.00
========================================
   SORRY! NO SPLIT CHECKS, PARTIES 8+
   ONE CARD PER TABLE · THANK YOU!

   YOUR FORTUNE: A FRIEND WILL SAY
   "I'LL GET YOU BACK." HE WILL NOT.
         COME AGAIN (SMALLER)
```

**Math (verified by script):**
- The 32 lines sum to the subtotal: $942.86.
- Tax: 6% (Michigan) = 5,657.16¢ → $56.57.
- Gratuity: 20% = 18,857.2¢ → $188.57.
- Total: **$1,188.00 = 11 × $108.00 exactly.**

**How it maps to Tab:**
- SPEC 8.1 even mode gives each person raw = total / 11 = 10,800¢. There are no leftover pennies, so no rounding.
- The largest line is $117.50, below the lopsided limit of 1.5 × $108 = $162. So Tab proposes an even split instead of itemizing, which matches the product.
- Real Kien paid. Each of the 10 others owes him **$108.00**, $1,080.00 in total. Kien's own $108.00 generates no transfer.

Jokes are planted for each character: wagyu (CEO), corkage (gym), nuggets and sippy cup (baby), hot water + straw (astronaut), fork (grandpa), broken plate (hook), bird seed (owl), outlet fee (ring light), extra dumplings (detective), 47 rice (farmer). "No split checks, parties 8+" sits right under the total, so the waiter's line has been set up before he says it.

---

## 5. Beat sheets

Times are seconds / frames at 30 fps. "VO" means a voice line from §7. Captions are lowercase. **Music** is "Cat Walk" by Arulo (Mixkit), `cat-walk.mp3`. It's 130.0 BPM, beat 0.4616 s, bar 1.8462 s, t0 0.1638 s. Source bars, measured by per-bar RMS:
- bars 0–7: quiet intro
- bar 16 (29.703 s): drop 1
- bars 32–46: breakdown
- bar 48 (88.782 s): drop 2 (the RMS jump is at bar 48, not 46)

There's no music in Act I. The restaurant runs on ambience, so the smash into drop 1 hits harder.

### 5a. FULL (80.0 s)

**Music edit (FULL):**
- clip A: source bar 16 → 24, at film 26.600–41.370 (f798–1241), hard stop.
- clip B: bar 32 → 44, at film 45.970–68.124 (f1379–2044).
- clip C: bar 47 → 52, at film 68.124–77.355 (f2044–2321). Drop 2 lands at **69.970 (f2099)**, then a hard stop on the bar 52 downbeat.
- VO ducks the music by 8 dB.

| # | Time (s) | Frames | Shot / asset | Picture | Dialogue / VO / SFX | Caption / on-screen | Music |
|---|---|---|---|---|---|---|---|
| F01 | 0.00–3.20 | 0–96 | **M1** overhead (Kling) | Diagonal overhead of the round table: eleven Kiens laughing, chopsticks crossing, lazy susan turning, waiters passing. Slow push. | Ambience bed X1 at full; laughter swell X2 | band: "friday night. dinner with the boys." (0.4–3.0) | none |
| F02 | 3.20–5.80 | 96–174 | freeze of M1 at f96 | Freeze, 40% desaturation. Tags pop on each head, accelerating (3.35→4.45): "kien", "kien", "kien", "kien, 81" (grandpa), "kien", "kien", "kien", "kien", "kien", "kien, 1" (baby). Last, in orange, after a beat (4.70): **"kien (has a credit card)"** on real Kien. | click-camera on the freeze; soft paper-tap per tag, two alternating samples, volume 0.4→0.2; ambience low-passed | tags only | none |
| F03 | 5.80–9.00 | 174–270 | **M3** bill drop (Kling) | Table-level medium. A waiter's arm sets a black check folder by real Kien's elbow and leaves. Nobody looks. Remotion push 1.00→1.12 toward the folder. | Ambience slowly low-passes and ducks to near silence by 8.6; clock-tick at 8.40 and 8.90 | none | none |
| F04 | 9.00–10.80 | 270–324 | **M4** Kien opens (Kling, first 1.8 s) | CU: he opens the folder and his smile dies. | paper-page-turn (folder) | none | none |
| F05 | 10.80–15.40 | 324–462 | H05 plate + `Receipt`, then macro scroll | 10.80–11.50 POV plate with the composited receipt; the restaurant name is readable. 11.50–14.00 head-on macro scroll: the first three lines read slowly (both Peking ducks), then a hard accelerate through the middle (R2), with paper apparently running off the folder; it decelerates into the totals. 14.00–15.40: punch-in on **TOTAL $1,188.00**, holding 1.2 s with "SORRY! NO SPLIT CHECKS, PARTIES 8+" visible beneath. Slam 1 of 3. | X3 paper unspool (11.5–14.0); bass-hit-short at 0.35 on the total; then silence | none | none |
| F06 | 15.40–17.00 | 462–510 | **M4** tail | Kien lifts his eyes off-camera right, hopeful. | VO K1 "can we split this… eleven ways?"; ambience back at 60% | none | none |
| F07 | 17.00–20.20 | 510–606 | **M2** waiter (Veo) | MCU of Kevin, who is Kien: deadpan, holding out the terminal. | VO W1 (Veo's native line, voice-changed to Kien) "sorry. group's too big. one card." | tag at 17.40: "kevin (also kien)" | none |
| F08 | 20.20–23.00 | 606–690 | **M5** eruption (Veo) 20.20–21.60, then **H08** cuts | The whole table spins and points: "JUST PAY!" Then punch-in stills, accelerating, each snap-zoomed 1.00→1.08: grandpa waving a checkbook (21.60–22.00), baby aiming a pacifier (22.00–22.35), captain raising his hook (22.35–22.65), gym bro holding up three fingers (22.65–23.00). | VO E1 ensemble ×6 "just pay! i'll get you back!" + E6 "let's just split—" cut off; E2 "I'LL WRITE YOU A CHECK!"; E3 "[babbles] venmo!"; E4 "ye'll get it back!"; E5 "three seconds bro!" | none | none |
| F09 | 23.00–23.80 | 690–714 | **H09** tap | MCU: Kien's card on the terminal, with a dead-eyed polite smile. | X4 contactless beep at 23.20 | none | none |
| F10 | 23.80–26.60 | 714–798 | freeze of H09 | Freeze → black and white, push 1.00→1.06. Slam 2 of 3. | Room sound cuts dead; click-camera; **VO N1** (Lulu, deadpan) "kien… would not see this money again." (24.1–26.2) | band: "kien would not see this money again." (24.1–26.5) | none |
| F11 | 26.60–41.37 | 798–1241 | **chat: the flood** (§5c) | Smash to Kien's phone (left). The receipt photo lands on the downbeat, then messages accelerate. R-top: a portrait card of each voiced sender. Ends as an avalanche: four typing bubbles, "‹ 99+". | Character VO lines (§7); soft incoming pop (two samples alternating, volume stepping down) | R-bottom: "3 days later" (35.83–37.22) | **A: drop 1 on 26.60** |
| F12 | 41.37–44.57 | 1241–1337 | **H10** alone | Hard cut. Kien alone at the wrecked table, phone glow, slow push. | Music stops dead. X8 empty-room tone + distant mop; phone-buzz ×2 (41.6, 42.3); **VO K2** "[exhales] wow. way too much going on." (42.7–44.4) | band: "wow. way too much going on." | stop |
| F13 | 44.57–45.97 | 1337–1379 | chat | Back on the phone. System row: **"You added Tab to the conversation."** The four typing bubbles vanish one by one. The group goes quiet when the adult arrives. | silence, one soft pop | none | silence |
| F14 | 45.97–48.97 | 1379–1469 | chat | **Tab:** "hey i'm tab 👋 / i keep the group's tab so nobody has to do the math / just talk like normal ("got groceries 40") or drop a receipt pic. you can kick me out whenever" | soft pop | R-bottom: "meet tab. it lives in your group chat." | **B enters 45.97** (breakdown) |
| F15 | 48.97–52.77 | 1469–1583 | chat | kien: [the same receipt photo] (+0.0). Tab adds 👍 to it (+0.5). **Tab** (+1.0): "big happy family seafood palace $1,188.00 split 11 ways, so $108.00 each / lmk if it wasn't even or someone skipped". kien (+3.0): "settle up" | pops | R-bottom: "drop the receipt. tab does the math." | B |
| F16 | 52.77–56.37 | 1583–1691 | chat | Timestamp row "Today 10:52 PM". **Tab:** "cool, here's what's owed to kien for big happy family seafood palace: / wizard kien 🧙 $108.00, cap'n kien 🏴‍☠️ $108.00, farmer kien 🌾 $108.00, kienfluencer 📸 $108.00, kien gainz 💪 $108.00, GRANDPA KIEN 👴 $108.00, space kien 🚀 $108.00, kienlock holmes 🔍 $108.00, kien ceo 💼 $108.00, baby kien 🍼 $108.00 / tap 👍 on this to pay your part, or reply if something's off". Thread pans top → bottom (+0.6→+1.6). | pop | R-bottom: "tab asks for the money, so kien doesn't have to." | B |
| F17 | 56.37–58.97 | 1691–1769 | chat + R-top wizard card | wizard kien (+0.2): "how much do i owe again?". **Tab** (+1.0): "you owe kien $108.00" | VO C8 (wizard, reused from the flood) | R-bottom: "ask it anything." | B |
| F18 | 58.97–61.17 | 1769–1835 | chat + R-top **waiter card** (H06 crop, label "kevin") | space kien (+0.1): "anyone else think the waiter looked exactly like kien". Tab says nothing. | X6 crickets (+0.8, low) | R-bottom (+0.7): "not about money? tab never sees it." | B |
| F19 | 61.17–66.57 | 1835–1997 | chat + R-top banner stack | 👍 storm on the settle request, gray badge counting up (sub-beats below). Each 👍 drops a DM banner in R-top on that person's phone. | Soft tap per 👍, two samples, volume 0.4→0.2, accelerating | R-bottom (+1.0→end): "one 👍 each. tab confirms in a dm." | B |
| F20a | 66.57–67.57 | 1997–2027 | chat | **Tab:** "everyone's square on big happy family seafood palace 🎉" | pop | none | B |
| F20b | 67.57–69.97 | 2027–2099 | **M7** exhale (Kling) | Same frame as F12. He lowers the phone, exhales, leans back, smiles. | **VO N2** "kien saw this money again." (67.9–69.5) | band: "kien saw this money again." | **C enters 68.124** (bar 47 build) |
| F21 | 69.97–74.37 | 2099–2231 | **M6** growth pull-back (Kling pro, start H02 → end H11) | Crane up and out from the table to a banquet hall of about 100 Kiens. Chip top-right (y 60–160): `DigitRoll` "11 → 100 friends". | **VO N3** "tab grows with your group… so money never gets between friends." | band: "tab grows with your group." (70.1–72.2), then "so money never gets between friends." (72.2–74.3) | **drop 2 at 69.97** |
| F22 | 74.37–77.36 | 2231–2321 | end card on the blurred H11 | Tagline lands (74.4), slam 3 of 3: **"friendships compound. debts shouldn't."** Then (75.8) Tab mark and wordmark, "the friend in your group chat who keeps the tab.", feature row "text it · snap the receipt · 👍 to settle · live ledger", "built at mhacks 2026". Hold ≥1.5 s. | impact-cine-big at 0.4 on the tagline | as described | C, hard stop at 77.355 (bar 52) |
| F23 | 77.36–79.96 | 2321–2399 | **button**: M7 last frame → **H12** | 77.4: an iOS banner drops at the top (y 40–330). **"taco crew 🌮"**, body "Tab: hey kien, you owe sam $6.50 / no rush, just tap 👍 on the settle msg when you can". 78.9: cut to H12, Kien busted, eyes to the lens. 79.96: black. | phone-buzz at 77.4; **VO B1** "[gulps]" at 79.1 | banner only | silence |

**F19 sub-beats** (offsets from 61.17; badge count on the left, R-top banner on the right). Every banner reads: title "Tab", body "done, you paid kien $108.00 for big happy family seafood palace through capital one nessie / you're all square", app "Messages".

| +s | Phone (left) | R-top |
|---|---|---|
| 0.00 | baby kien 👍 → badge 👍 | header **"baby kien's phone"** + banner (hold 1.0 s) |
| 1.00, 1.30, 1.55, 1.75, 1.92, 2.06, 2.18 | 👍 from wizard, farmer, kienfluencer, gainz, space, holmes, ceo → 👍 8 | Header and banner swap on each tap; older banners collapse into blank stack slivers |
| 2.40 | **GRANDPA KIEN:** "YES / - GRANDPA" | holds |
| 3.10 | **Tab:** "just tap 👍 on the settle msg to pay your part" | holds |
| 3.70 | grandpa 👍 → 👍 9 | **"grandpa kien's phone (text size: max)"** with the same banner at 64 px body. Hold 1.0 s. |
| 4.70 | cap'n kien 👍 → **👍 10** | "cap'n kien's phone" banner |

**Wizard cut (FULL).** Swap F03 for **M3w**: the owl drops the folder (Veo audio: wing flaps and a thud). Insert **F03w** (1.2 s) after it: a push-in on the H01 wizard cell, VO O1 "…that's not my owl." To stay at 80 s, trim F05 to 4.0 s and F08 to 2.2 s. Re-time everything after F03, but the music anchors (26.6, 45.97, 68.124) must not move, so take the slack from F02 if needed.

### 5b. SHORT (50.0 s; 48.2 s without the button)

**Music edit (SHORT):**
- clip A: bar 16 → 21, at film 20.800–30.031 (f624–901).
- clip B: bar 32 → 36, at film 33.431–40.816 (f1003–1224).
- clip C: bar 47 → 51, at film 40.816–48.201. Drop 2 lands at **42.662 (f1280)**, then a hard stop at 48.201 (f1446).

| # | Time (s) | Frames | Asset | Picture / action | Audio | Caption | Music |
|---|---|---|---|---|---|---|---|
| S01 | 0.00–2.80 | 0–84 | M1 | Overhead party | X1, X2 | band: "friday night. dinner with the boys." | none |
| S02 | 2.80–4.40 | 84–132 | M1 freeze | Ten "kien" tags in 0.6 s, then the orange "kien (has a credit card)" held 0.9 s | click, tag taps | tags | none |
| S03 | 4.40–6.80 | 132–204 | M3 (or M3w) | Bill drop, unnoticed, push-in | Ambience fades, tick | none | none |
| S04 | 6.80–8.00 | 204–240 | M4 | Opens, smile dies | page turn | none | none |
| S05 | 8.00–11.60 | 240–348 | Receipt | Plate 0.5 s, then scroll, then TOTAL held 1.0 s (slam 1) | X3, bass hit | none | none |
| S06 | 11.60–12.90 | 348–387 | M4 tail | Looks up | VO K1 | none | none |
| S07 | 12.90–15.60 | 387–468 | M2 | Waiter | VO W1 | tag "kevin (also kien)" | none |
| S08 | 15.60–17.60 | 468–528 | M5 + 2 H08 cuts (grandpa, baby) | Eruption | E1 ensemble, E2, E3 | none | none |
| S09 | 17.60–18.20 | 528–546 | H09 | Tap | X4 beep | none | none |
| S10 | 18.20–20.80 | 546–624 | H09 freeze (slam 2) | Black-and-white freeze | VO N1 | band: "kien would not see this money again." | none |
| S11 | 20.80–30.03 | 624–901 | chat flood (§5c, SHORT list) | Phone left, portraits R-top | character VO, pops | R-bottom "3 days later" (26.80–27.95) | **A: drop on 20.80** |
| S12 | 30.03–32.43 | 901–973 | H10 | Dead stare | music stops; buzz ×2; VO K2 | band: "wow. way too much going on." | stop |
| S13 | 32.43–33.43 | 973–1003 | chat | "You added Tab to the conversation."; typing bubbles vanish | silence | none | silence |
| S14 | 33.43–36.43 | 1003–1093 | chat | Tab intro (+0.0, held 1.2 s), then kien's receipt photo (+1.2), Tab 👍 on it (+1.5), Tab proposal "…split 11 ways, so $108.00 each…" (+1.8) | pops | R-bottom: "drop the receipt. tab does the math." | **B 33.43** |
| S15 | 36.43–40.66 | 1093–1220 | chat + banners | kien "settle up" (+0.0). Tab settle request (+0.4), pan to its bottom (+0.6→1.2). 👍 storm: baby first (+1.4, "baby kien's phone" banner held 0.9 s), seven more taps (+2.3→3.1), grandpa last (+3.3) with the max-text banner held to the end. | taps | R-bottom: "one 👍 each. tab confirms in a dm." | B |
| S16 | 40.66–42.66 | 1220–1280 | M7 | Exhale | VO N2 | band: "kien saw this money again." | **C 40.816** |
| S17a | 42.66–45.06 | 1280–1352 | M6 (last 2.4 s) | Banquet reveal | none | band: "tab grows with your group." | **drop 2 at 42.66** |
| S17b | 45.06–48.20 | 1352–1446 | end card | Tagline (slam 3), then wordmark, held ≥1.5 s | impact | "friendships compound. debts shouldn't." | stop 48.20 |
| S18 | 48.20–50.00 | 1446–1500 | button (optional) | "taco crew 🌮" banner (1.1 s), then H12 (0.7 s) | buzz, [gulps] | banner | silence |

### 5c. The group chat flood (exact messages)

Sender names are as they appear in iOS: real Kien is blue, everyone else gray. Times are film seconds, set on beats (0.4616 s) so they ride the music. The first ten messages sit about 0.9 s apart, so the rule-of-three and the text-you-later joke are readable. After the "3 days later" break, the cadence speeds up into an avalanche, which is the point (R2 acceleration).

**FULL (F11, 26.60–41.37)**

| t (s) | f | Sender | Message | R-top / audio |
|---|---|---|---|---|
| 26.60 | 798 | kien (blue) | [receipt photo: `receipt-photo.png`, same composite as F05] | lands on the drop |
| 27.52 | 826 | kien (blue) | it's $108 each 🙏 | none |
| 28.45 | 853 | kien gainz 💪 | thanks king 🙏 | none |
| 29.37 | 881 | wizard kien 🧙 | how much do i owe again? | VO C8 |
| 30.29 | 909 | cap'n kien 🏴‍☠️ | can i pay in doubloons | card: captain · VO C1 |
| 31.22 | 936 | farmer kien 🌾 | can i pay in rice | card: farmer · VO C2 |
| 32.14 | 964 | kienfluencer 📸 | can i pay in exposure | card: fluencer · VO C3 |
| 32.83 | 985 | kien (blue) | no. | card clears |
| 33.52 | 1006 | space kien 🚀 | signal's bad up here | card: space · VO C4 (both lines) |
| 33.98 | 1020 | space kien 🚀 | i'll just text you later | (gen-1 callback) |
| 34.68 | 1040 | kien (blue) | you are texting me | none |
| 35.37 | 1061 | kien gainz 💪 | gimme 3 secs i'll venmo u | card: gainz |
| 35.83 | 1075 | (timestamp row) | Mon 9:41 AM | R-bottom "3 days later" (to 37.22) |
| 36.75 | 1103 | kien gainz 💪 | bro venmo's being weird | none |
| 37.22 | 1116 | (system) | cap'n kien left the conversation. | none |
| 37.68 | 1130 | (system) | You added cap'n kien to the conversation. | none |
| 38.14 | 1144 | kien (blue) | can you guys send the money | none |
| 38.60 | 1158 | kien ceo 💼 | i'll get you back in like a week 🤝 | portrait shuffle starts, accelerating (R2) |
| 38.83 | 1165 | kienlock holmes 🔍 | who got the extra dumplings | none |
| 39.06 | 1172 | kienlock holmes 🔍 | one of you is lying | VO C7 |
| 39.29 | 1179 | GRANDPA KIEN 👴 | HOW DO I SEND MONEY ON THE FACEBOOK<br>- GRANDPA | VO C5 |
| 39.52 | 1186 | baby kien 🍼 | i'm literally a baby | VO C6 |
| 39.75 | 1193 | wizard kien 🧙 | wait how much do i owe again | none |
| 39.98–41.37 | 1199–1241 | (typing) | 4 `Typing` bubbles stacked (captain, grandpa, gainz, ceo); header "‹ 12" rolls to "‹ 99+" | portraits blur-swap |
| 41.37 | 1241 | none | hard cut to F12 | music stops dead |

**SHORT (S11, 20.80–30.03)** uses the same lines on a tighter grid. Rule-of-three and text-you-later stay at readable spacing.

| t | Sender | Message |
|---|---|---|
| 20.80 | kien | [receipt photo] |
| 21.72 | kien gainz 💪 | thanks king 🙏 |
| 22.42 | wizard kien 🧙 | how much do i owe again? |
| 23.11 | cap'n kien 🏴‍☠️ | can i pay in doubloons (card + VO) |
| 23.80 | farmer kien 🌾 | can i pay in rice (card + VO) |
| 24.49 | kienfluencer 📸 | can i pay in exposure (card + VO) |
| 24.95 | kien | no. |
| 25.42 | space kien 🚀 | i'll just text you later (card + VO) |
| 26.11 | kien | you are texting me |
| 26.57 | kien gainz 💪 | gimme 3 secs i'll venmo u |
| 26.80 | (timestamp) | Mon 9:41 AM, plus R-bottom "3 days later" to 27.95 |
| 27.49 | kien gainz 💪 | bro venmo's being weird |
| 27.95 | (system) | cap'n kien left the conversation. |
| 28.18 | (system) | You added cap'n kien to the conversation. |
| 28.42 | kien | can you guys send the money |
| 28.65 | GRANDPA KIEN 👴 | HOW DO I SEND MONEY ON THE FACEBOOK / - GRANDPA (VO) |
| 28.88–30.03 | (typing ×4, "‹ 99+") | avalanche, then hard cut |

### 5d. Tab's messages (verbatim, real templates)

| Beat | Template | Exact text |
|---|---|---|
| Intro | `onboardingIntro` v2 | hey i'm tab 👋<br>i keep the group's tab so nobody has to do the math<br>just talk like normal ("got groceries 40") or drop a receipt pic. you can kick me out whenever |
| Like on receipt | SPEC 7.3 step 5 | 👍 tapback on kien's photo (gray badge: someone else reacted to *his* message) |
| Proposal | `splitProposal` | big happy family seafood palace $1,188.00 split 11 ways, so $108.00 each<br>lmk if it wasn't even or someone skipped |
| Settle request | `settleRequest` (one payee, one expense, so the description is included) | cool, here's what's owed to kien for big happy family seafood palace:<br>wizard kien 🧙 $108.00, cap'n kien 🏴‍☠️ $108.00, farmer kien 🌾 $108.00, kienfluencer 📸 $108.00, kien gainz 💪 $108.00, GRANDPA KIEN 👴 $108.00, space kien 🚀 $108.00, kienlock holmes 🔍 $108.00, kien ceo 💼 $108.00, baby kien 🍼 $108.00<br>tap 👍 on this to pay your part, or reply if something's off |
| Balance question | `personalBalanceReply` | you owe kien $108.00 |
| Typed "YES" | `tapToPay` (P7: typed yes never pays) | just tap 👍 on the settle msg to pay your part |
| Per-payer DM ×10 | `paymentConfirmation` | done, you paid kien $108.00 for big happy family seafood palace through capital one nessie<br>you're all square |
| Group close | `allSquare` v1 | everyone's square on big happy family seafood palace 🎉 |
| Button (taco crew) | `approvalFollowup` step 1 | hey kien, you owe sam $6.50<br>no rush, just tap 👍 on the settle msg when you can |

Notes: the privacy-gated line gets **no reply**. Optionally, add a Grok wit line after "everyone's square" (a real feature: ≤80 chars, no numbers, may name the payer), e.g. "kien can finally afford dessert". Leave it out unless we want one more laugh.

---

## 6. Taglines (ranked)

| Rank | Tagline | Wit | Growth | Clarity | Note |
|---|---|---|---|---|---|
| **1** | **friendships compound. debts shouldn't.** | high | high | med-high | "Compound" is both a growth word and a money word. Five words. |
| 2 | more friends. same tab. | med | high | high | Has the product name. Matches the banquet shot. Best social-post line. |
| 3 | the bigger the table, the smaller the drama. | med | high | high | Literal to our film, but longer |
| 4 | split the bill, not the friendship. | low (familiar) | low | very high | Safe, but heard before |
| 5 | every group has a kien. now kien has tab. | high in context | low | med | Needs the film. Great caption for the post. |
| 6 | grow your circle, not your tab. | med | high | med | The "tab" pun fights "tab grows with your group" |
| 7 | let tab do the asking. | low | none | high | The clearest version of the value prop |
| 8 | keep the friends. lose the "i'll get you back." | med | low | high | Too long for the end card |
| 9 | you bring the friends. tab brings the math. | med | med | high | Fine, generic |
| 10 | more friends, zero awkward. | low | med | med | Weak verb |
| 11 | tab grows with your group. | low | high | high | Gen-1 line. Used as a caption instead. |
| 12 | your group grows. your tab doesn't. | med | high | med | Same pun clash as #6 |
| 13 | no more "i'll get you back." | med | none | high | A problem statement, not a tagline |
| 14 | one tab for the whole table. | low | med | high | Flat |

**Pick: "friendships compound. debts shouldn't."**
- It's the wittiest line that also *is* the theme: "build something that grows," inverted for money.
- Judges get it in one read: friendships should grow, debts should stay small.
- The film has already explained the mechanism plainly. The F21 caption and VO say "tab grows with your group… so money never gets between friends," so the tagline doesn't need to explain anything (C2).
- The descriptor right under the wordmark, "the friend in your group chat who keeps the tab.", plus the feature row, covers the product-name requirement.
- Use #2 and #5 as post copy, so the end card doesn't repeat the captions (P4).

---

## 7. Higgsfield shot sheet

**Strategy.** Generate every still first (≈27 credits), then hold a team review. Generate motion only after the stills pass, cheapest and lowest-risk first. Kling 3.0 is the default for multi-face motion because it holds a start frame best. Veo 3.1 Lite is used only where native audio pays off: the waiter's dialogue, the crowd shout, and the owl. Reaction quick-cuts are stills from one grid with Remotion punch-ins: hacky look, nearly free.

**Files.** Stills go to `public/gen2/stills/Hxx.png`, clips to `public/gen2/clips/Mx.mp4`, prompts to `gen2/prompts/<id>.txt`.

Command form (not run):
`higgsfield generate create <model> --prompt "$(cat gen2/prompts/H02.txt)" --aspect_ratio 16:9 --resolution 2k --image public/gen2/ref/IMG_0198.jpg --image public/gen2/ref/IMG_0199.jpg --image public/gen2/stills/H01.png --wait`

**Style block (append to every live-action prompt, "STYLE").**
> Photorealistic cinematic film still, ARRI Alexa 35, Kodak Vision3 500T grade, warm tungsten practicals, light haze, natural skin texture. Setting: a huge, loud, packed Cantonese seafood banquet restaurant at night: red lacquer columns, a gold carved dragon-and-phoenix wall panel, rows of red paper lanterns, glowing live-seafood tanks along the back wall, round tables with white tablecloths and glass lazy susans, waiters in black vests. No text, no signage lettering, no logos, no watermark.

**Identity block ("ID")**
> Every man in this image is the SAME young man from the reference photos: identical face, short black hair with short sides, light mustache and chin stubble, slim build, early twenties. Keep the face identical across every copy.

### Phase A: stills (gate after H01 and after H02)

**H01 · cast sheet** — **DROPPED**: the 12 single portraits replaced it (32 cr, see CREDITS.md). Kept below for reference only.
- Model and size: `nano_banana_pro` · 16:9 · **4k** · **4 cr** (verified)
- Refs: IMG_0198, IMG_0199
- **Prompt:**
  > A clean 5-column by 2-row contact sheet of ten separate waist-up portrait photographs, equal cells, thin white gutters, no text or labels anywhere. Every cell shows the SAME young man from the reference photos (identical face, short black hair with short sides, light mustache and stubble, slim, early twenties) dressed as a different, cartoonishly exaggerated character, grinning into the lens. Identical lighting in every cell: warm tungsten key from upper left, red-lantern bokeh of a busy Cantonese banquet restaurant, 85mm, f/2, photoreal, fine film grain.
  >
  > Top row, left to right:
  > (1) WIZARD: round thin wire-rim glasses, long black robe, plum-and-mustard striped knit scarf, wooden wand tucked behind one ear, a snowy white owl on his shoulder.
  > (2) PIRATE CAPTAIN: black tricorn hat, eyepatch, loose white shirt, red sash, gold hoop earring, a metal hook for a left hand.
  > (3) RICE FARMER: wide-brim woven straw hat, denim overalls over a white tank top, a rice stalk between his teeth, hugging a giant 50-lb sack of jasmine rice like a baby.
  > (4) INFLUENCER: oversized pastel hoodie, bucket hat, a ring light reflected as perfect circles in his eyes, phone on a selfie stick, exaggerated pout.
  > (5) GYM BRO: neon-green stringer tank top, terry headband, flexing one huge bicep, a giant protein shaker in the other hand.
  >
  > Bottom row, left to right:
  > (6) GRANDPA: the same man aged to 80, white hair, bushy white mustache, beige cardigan, suspenders, reading glasses on a chain, squinting at a flip phone held at arm's length.
  > (7) ASTRONAUT: bulky white spacesuit with no flags or logos, clear glass bubble helmet on with his face clearly visible inside, a dumpling squished against the outside of the glass.
  > (8) DETECTIVE: tan trench coat, deerstalker hat, a big magnifying glass held up to one eye, which is hugely magnified.
  > (9) CEO: slim navy three-piece suit, slicked-back hair, sunglasses indoors, white earbuds, a phone pressed to each ear.
  > (10) BABY: the adult man in an oversized frilly baby bonnet and a plain white bib, pacifier on a clip, sippy cup, sitting in a giant wooden high chair.
  >
  > The face must be unmistakably the same person in all ten cells.
- **Gate:** at least 8 of 10 faces read as Kien, and every costume reads at avatar size.
- **Fallback:**
  - Re-roll once, adding "the face in every cell is an exact copy of reference 1".
  - If it still fails, render ten single cells with `nano_banana_2_lite` (1 cr each, 3:4, same refs, one costume per prompt) = 10 cr.

**H02 · overhead master** (start frame for M1 and M6; first frame of F01/F02)
- Model and size: `nano_banana_pro` · 16:9 · 2k · **2 cr**
- Refs: IMG_0198, IMG_0199, H01
- **Prompt:**
  > High overhead shot looking down at about 60 degrees from above one side of a large round banquet table; the camera is rotated so the table sits on a diagonal from lower-left to upper-right.
  >
  > Eleven copies of the same man (ID) sit around it, laughing, mid-conversation, reaching across with chopsticks, each in his costume from the cast-sheet reference. Clockwise from the far side facing camera:
  > - the REAL one in a plain light Carolina-blue hoodie with no logo (far side, center, face clearly visible, the only normally dressed person)
  > - the BABY in a giant high chair
  > - GRANDPA with a flip phone
  > - the ASTRONAUT with the glass bubble helmet on
  > - the GYM BRO flexing
  > - the RICE FARMER behind a precarious tower of small white rice bowls
  > - the PIRATE CAPTAIN (near side, seen from behind and the side, tricorn prominent)
  > - the WIZARD with a white owl on his shoulder
  > - the INFLUENCER with a small ring light clamped to the table edge lighting his face
  > - the DETECTIVE holding a magnifying glass over a dumpling
  > - the CEO with a phone at each ear (next to the real one)
  >
  > On the glass lazy susan: two whole Peking ducks, two red lobsters, a whole steamed fish, stacks of bamboo dumpling steamers, taro milk teas, teapots. Around them, ordinary diners out of focus and waiters with trays. 24mm lens, deep focus on the table. STYLE.
- **Gate:** about 11 people, real Kien's face clear at the top, costumes legible, readable diagonal composition. Leave clear headroom above the heads for the F02 tags.
- **Fallback:** up to 2 re-rolls. If the head count is off, accept 9–10 (fast shot); if real Kien's face is wrong, run a `nano_banana_pro` edit pass (input H02 plus refs, "replace the face of the man in the light-blue hoodie with the reference face") for 2 cr.

**H03 · bill-drop medium** (start frame for M3 and M3w)
- Model and size: `nano_banana_pro` · 16:9 · 2k · **2 cr**
- Refs: IMG_0198, IMG_0199, H01, H02
- **Prompt:**
  > Eye-level medium-wide shot across the round banquet table, with the same restaurant and same people as the reference images.
  > - Center: the REAL one in the plain light Carolina-blue hoodie, laughing hard with his head tilted back, chopsticks raised.
  > - Frame left of him: the CEO with a phone at each ear.
  > - Frame right of him: the BABY in the giant wooden high chair waving a sippy cup, then GRANDPA squinting at his flip phone.
  > - Foreground: out-of-focus shoulders framing the shot, the PIRATE's tricorn at frame left and the WIZARD's white owl at frame right.
  > - On the tablecloth directly in front of the real one, slightly to frame left: an EMPTY clear patch of white tablecloth with nothing on it.
  > - Half-carved Peking duck, lobster shells and dumpling steamers elsewhere.
  >
  > 40mm, f/2.8. ID. STYLE.
- **Fallback:** re-roll once. If the empty patch is missing, inpaint it with a 2 cr edit.

**H04 · Kien opens the bill, CU** (start frame for M4)
- Model and size: `nano_banana_pro` · 16:9 · 2k · **2 cr**
- Refs: IMG_0198, IMG_0199, H02
- **Prompt:**
  > Tight medium close-up of the REAL one (reference photos, plain light Carolina-blue hoodie) seated at the banquet table, holding a closed black leather restaurant check presenter upright in both hands at chest height, thumbs on the edge about to open it; the last of a laugh is fading into mild suspicion. Behind him, soft bokeh of costumed copies of him still partying: a tricorn hat, a glass astronaut helmet catching light, the circle of a ring light, red lanterns. Warm key from frame right, 85mm, f/1.8. STYLE.
- **Fallback:** re-roll once. Otherwise use it as a still with a push-in, and VO carries the beat.

**H05 · receipt POV plate** (no face, so the cheap model)
- Model and size: `gpt_image_2_5` · 16:9 · 2k · quality medium · **1 cr** (verified)
- Refs: none
- **Prompt:**
  > First-person point-of-view photo looking straight down at a restaurant table: two hands in light-blue hoodie sleeves hold open a black leather check presenter. Inside is a long white thermal-paper receipt that is COMPLETELY BLANK (no printing, no text, no numbers, no logo). It is so long it runs out of the folder and off the bottom edge of the frame. Around the folder on a white tablecloth: bamboo dumpling steamers, a carved Peking duck platter, chopsticks on a porcelain rest, a soy sauce dish, a teacup. Warm tungsten restaurant light, shallow depth of field at the edges, photoreal smartphone-photo look. The receipt paper must be pure blank white.
- **Use:** composite the `Receipt` onto the paper, head-on. Export that composite as `receipt-photo.png` for the chat.
- **Fallback:** any printing on the paper doesn't matter, because our layer is opaque. If the framing is bad, re-roll (1 cr).

**H06 · waiter Kevin** (start frame for M2)
- Model and size: `nano_banana_pro` · 16:9 · 2k · **2 cr**
- Refs: IMG_0198, IMG_0199
- **Prompt:**
  > Medium close-up of a Cantonese restaurant waiter who is the SAME young man from the reference photos: black vest over a crisp white long-sleeve shirt, hair slicked flat with a neat side part, a thin pencil mustache, a small plain gold name badge with nothing written on it, holding a black handheld card terminal at chest height. He looks slightly off-camera to frame left at a seated customer with a perfectly deadpan, politely unmoved expression. Background out of focus: red lanterns, a glowing live-lobster tank, a waiter passing with a tray. 85mm, f/2. STYLE.
- **Fallback:** re-roll once.

**H07 · eruption OTS** (start frame for M5)
- Model and size: `nano_banana_pro` · 16:9 · 2k · **2 cr**
- Refs: IMG_0198, IMG_0199, H01, H02
- **Prompt:**
  > Over-the-shoulder shot from behind the REAL one: the back of his head and the shoulder of his plain light Carolina-blue hoodie, soft and dark in the frame-left foreground. Across the round table, facing camera, are the costumed copies of him (ID, cast-sheet costumes), left to right: CEO (phone at each ear), DETECTIVE (magnifying glass), INFLUENCER (ring light glow), WIZARD (white owl), PIRATE CAPTAIN (tricorn, hook), RICE FARMER (straw hat, rice sack), GYM BRO (neon tank, shaker), GRANDPA (cardigan, flip phone), and the BABY in a giant high chair at frame right. All of them have just whipped around toward camera at the same instant, mouths opening, eyebrows up, hands starting to rise, about to point at him. Dishes and the lazy susan between them. 35mm, f/2.8. STYLE.
- **Fallback:** re-roll once. If it fails, the beat becomes H08 quick-cuts only.

**H08 · reaction sheet** (six quick-cut punch-ins)
- Model and size: `nano_banana_pro` · 16:9 · **4k** · **4 cr**
- Refs: IMG_0198, IMG_0199, H01
- **Prompt:**
  > A 3-column by 2-row contact sheet of six separate medium close-up photographs, equal cells, thin white gutters, no text. Each cell is one costumed copy of the same young man (reference photos and cast sheet) shouting straight into the lens mid-word, dramatic and hilarious, with identical warm tungsten lighting and red-lantern bokeh, 50mm.
  >
  > Top row: (1) GRANDPA furiously waving a paper checkbook and pen; (2) the BABY in his giant high chair aiming a pacifier at the lens like a weapon; (3) the PIRATE CAPTAIN raising his hook and a goblet, one eye squinting.
  > Bottom row: (4) the GYM BRO holding up three fingers, veins popping; (5) the CEO raising one finger ("one second") with a phone pressed to his ear; (6) the ASTRONAUT giving a big thumbs-up, face visible inside the glass bubble helmet, a dumpling stuck to the glass.
  >
  > STYLE.
- **Fallback:** use the H01 cells with snap zooms instead (free).

**H09 · the tap** (F09, and the F10 freeze)
- Model and size: `nano_banana_pro` · 16:9 · 2k · **2 cr**
- Refs: IMG_0198, IMG_0199, H06
- **Prompt:**
  > Medium close-up of the REAL one (reference photos, plain light Carolina-blue hoodie) at the banquet table, holding a plain dark credit card (no logos, no numbers) flat against a black handheld card terminal that the waiter's hand (black vest sleeve, white cuff) holds out from frame right. His face: a strained, polite, defeated smile, eyes completely dead. Behind him, out of focus, costumed copies of him cheering with raised teacups (tricorn hat, glass helmet, white owl). The terminal screen shows only a simple glowing contactless symbol. 50mm, f/2. STYLE.
- **Fallback:** re-roll once.

**H10 · alone at the wreckage** (F12; start frame for M7)
- Model and size: `nano_banana_pro` · 16:9 · 2k · **2 cr**
- Refs: IMG_0198, IMG_0199, H02
- **Prompt:**
  > Wide medium shot, very late at night, in the same banquet restaurant, now almost empty and half-lit: most lanterns off, chairs stacked upside-down on the other tables, a staff member mopping far in the background. The REAL one (reference photos, plain light Carolina-blue hoodie) sits ALONE at the big round table among ten empty chairs pushed back at odd angles and an empty giant wooden high chair. The glass lazy susan is pure wreckage: duck carcasses, red lobster shells, a leaning tower of empty rice bowls, crumpled napkins, tipped-over milk tea cups, one lonely dumpling. He stares dead-eyed at his phone, its cold blue-white glow lighting his face from below. Melancholy and funny. 35mm, f/2.8. STYLE (late-night variant: low light, most practicals off).
- **Fallback:** re-roll once.

**H11 · banquet hall of ~100 Kiens** (end frame for M6; end-card backdrop)
- Model and size: `nano_banana_pro` · 16:9 · 2k · **2 cr**
- Refs: IMG_0198, H01, H02
- **Prompt:**
  > Extreme high-angle wide shot from near the ceiling of an enormous Cantonese wedding-style banquet hall at night. Ten round banquet tables with white tablecloths and glass lazy susans are arranged in a grid, and every seat is filled with about a hundred copies of the same young man from the references, each in a different wild costume: pirates, wizards with owls, astronauts in glass helmets, cowboys, knights in armor, chefs, firefighters, grandpas, babies in giant high chairs, gym bros, CEOs, ballerinas, clowns, scuba divers. All are laughing, eating and toasting. Giant crystal chandeliers hang in the top of frame; red-and-gold walls, lanterns, a small stage with red curtains. The table at the center-bottom of frame is the original table from the reference image, with the same eleven people and the real one in the light-blue hoodie on its far side. 18mm, deep focus, haze. STYLE.
- **Fallback:** re-roll once. Faces at this distance only need to read as "the same guy, many costumes."

**H12 · busted** (F23 button)
- Model and size: `nano_banana_pro` · 16:9 · 2k · **2 cr**. Fallback model: `nano_banana_2_lite`, 1 cr.
- Refs: IMG_0198, IMG_0199, H10
- **Prompt:**
  > Close-up of the REAL one (reference photos, plain light Carolina-blue hoodie) leaning back relaxed at the late-night, empty banquet table (same setting as the reference), phone in one hand. He freezes mid-smile as he reads it: eyebrows shooting up, eyes wide, a guilty sideways glance straight into the camera lens. Busted. Phone glow on his face, dim lanterns behind. 50mm, f/2. STYLE (late-night).
- **Fallback:** if cut, end SHORT/FULL on the banner over M7's last frame.

### Phase B: motion (only after every still passes)

Kling `std` outputs 720p (per gen-1 job params). `pro` is expected to be 1080p; verify that on the first pro job. Remotion adds light grain so 720p and 1080p clips match.

| Order | id | Start → end | Model / settings | Dur | Cr (verified) | Prompt | Fallback |
|---|---|---|---|---|---|---|---|
| B1 | **M7** exhale | H10 | `kling3_0` std, sound off | 3 s | **4.5** | Static camera. He slowly lowers the phone, lets out a long relieved exhale, his shoulders drop, he leans back in the chair and a small satisfied smile spreads across his face. The background stays still except the distant mopping. Natural motion, face unchanged. | H10 still, crossfading to a 2 cr "relieved" edit of H10 |
| B2 | **M2** waiter | H06 | `veo3_1_lite`, generate_audio true, 16:9 | 4 s | **6** | Static camera. The waiter looks at the seated customer off-camera left and says, flatly and politely, in an even monotone with no smile: "Sorry. Group's too big. One card." He gives a tiny shrug on "one card" and holds the terminal out slightly. Busy restaurant ambience behind him. Photoreal, accurate lip sync. | Re-roll once. Otherwise H06 still with the VO and a slow push (the deadpan still works). |
| B3 | **M4** opens | H04 | `kling3_0` std, sound off | 4 s | **6** | He opens the black check presenter toward himself and reads. His smile dies; his eyes widen and travel down the page, and further down. He swallows, then slowly lifts his eyes to someone standing off-camera right with a small, hopeful look. The inside of the folder faces him; we never see the paper. Static camera, shallow depth of field, face unchanged. | H04 still plus push; split F04/F06 into two punch-ins |
| B4 | **M3** bill drop | H03 | `kling3_0` std, sound off | 4 s | **6** | Static camera. Everyone keeps laughing, eating and talking; nobody looks down. A waiter's arm in a black vest sleeve with a white shirt cuff enters from frame right, sets a black leather check presenter on the empty patch of tablecloth in front of the man in the light-blue hoodie, and withdraws out of frame. Nobody notices. Natural motion, faces unchanged. | Two-still cut: H03, then a 2 cr edit of H03 with the folder, plus a whoosh |
| B5 | **M5** eruption | H07 | `veo3_1_lite`, generate_audio true | 4 s | **6** | Static camera. All the costumed men across the table point straight at the camera and shout at once, overlapping: "Just pay! I'll get you back!" Grandpa waves a paper checkbook, the baby bangs his sippy cup on the high-chair tray, the gym bro holds up three fingers, the pirate raises his hook. Loud, chaotic, joyful. Restaurant ambience. | H07 still plus H08 quick-cuts (the hacky cut is funny anyway) |
| B6 | **M1** open | H02 | `kling3_0` **pro**, sound off | 5 s | **8.75** | Locked-off high overhead camera with a very slow push-in. Everyone at the round table laughs, talks over each other and reaches across with chopsticks; the glass lazy susan slowly rotates; the gym bro flexes; the astronaut bonks a dumpling against his helmet glass; the influencer's ring light glows; waiters with trays walk past in the background. Lively and natural, no camera shake, all faces stay unchanged. | H02 still with slow push plus ambience (free) |
| B7 | **M6** growth | H02 → H11 | `kling3_0` **pro**, sound off, start + end | 5 s | **8.75** | One smooth, continuous crane move: the camera rises straight up and pulls back from above the round table while the costumed men keep laughing and eating, and the frame widens to reveal that the table is one of many in a gigantic banquet hall full of costumed copies of the same man; chandeliers slide into the top of frame. Steady, no cuts, no shake. | Remotion scale-out from the H11 center-table crop to the full frame (free) |
| B8 | **M3w** owl (wizard cut, optional) | H03 | `veo3_1_lite`, generate_audio true | 4 s | **6** | Static camera. Everyone keeps laughing; nobody looks up. A snowy white owl swoops down from the top of frame, drops a black leather check presenter onto the empty patch of tablecloth in front of the man in the light-blue hoodie with a soft thud, and flies out of frame right. Nobody reacts at all. Restaurant ambience, wing flaps, a soft thud. | Skip the wizard cut |

### Credit ledger

| Item | Model | Credits |
|---|---|---|
| H01 cast sheet (4k) | nano_banana_pro | 4.00 |
| H02 overhead master | nano_banana_pro | 2.00 |
| H03 bill-drop medium | nano_banana_pro | 2.00 |
| H04 Kien CU | nano_banana_pro | 2.00 |
| H05 receipt POV plate | gpt_image_2_5 (medium, 2k) | 1.00 |
| H06 waiter | nano_banana_pro | 2.00 |
| H07 eruption OTS | nano_banana_pro | 2.00 |
| H08 reaction sheet (4k) | nano_banana_pro | 4.00 |
| H09 tap | nano_banana_pro | 2.00 |
| H10 alone | nano_banana_pro | 2.00 |
| H11 banquet hall | nano_banana_pro | 2.00 |
| H12 busted | nano_banana_pro | 2.00 |
| **Stills subtotal** | | **27.00** |
| M7 exhale | kling3_0 std 3 s | 4.50 |
| M2 waiter | veo3_1_lite 4 s | 6.00 |
| M4 opens | kling3_0 std 4 s | 6.00 |
| M3 bill drop | kling3_0 std 4 s | 6.00 |
| M5 eruption | veo3_1_lite 4 s | 6.00 |
| M1 open | kling3_0 pro 5 s | 8.75 |
| M6 growth | kling3_0 pro 5 s start+end | 8.75 |
| **Motion subtotal** | | **46.00** |
| M3w owl (wizard cut) | veo3_1_lite 4 s | 6.00 |
| **First pass, everything** | | **79.00** |
| Re-roll reserve, stills: H01 ×1 (4), H02 ×2 (4), H07, H10, H11, one spare (8) | | 16.00 |
| Re-roll reserve, motion: M1 ×1, M6 ×1, M2 ×1, one of M3/M4/M5 ×1 | | 29.50 |
| **Planned ceiling** | | **124.50 ≤ 170** |
| Unallocated inside the 170 cap | | 45.50 |
| Untouched reserve (270 − 170) | | 100.00 |

**Stop-loss rules**
- No asset gets more than 2 re-rolls; after that, use its fallback.
- If stills spend passes 40 credits, stop and review.
- If total spend passes 140, no new motion; use the remaining fallbacks.
- Optional, only if headroom remains after Phase B: M4 in pro (+1), and an M1 take with `sound on` for native ambience (+1.25).

---

## 8. ElevenLabs line list

**Voice plan.** All the Kiens share **one voice**, because they're all Kien. Hearing the pirate and the baby come out of the same throat is half the joke. In order of preference:
1. **Real Kien records every Kien line** (phone, quiet room, about 10 minutes). It's free, it's authentic, and the "it's all Kien" joke lands hardest.
2. **ElevenLabs Instant Voice Clone of Kien.** Requires his explicit consent. Train on about 2 minutes of clean speech that includes some loud, energetic lines, because a calm-only sample won't shout. Then run `eleven_v3` with tags.
3. **One stock young-male voice** for every Kien (e.g. "Liam"; check the ID with `GET /v1/voices`). The joke still works.

**Waiter:** keep Veo's native take from M2 for lip-sync timing, then run it through ElevenLabs **Voice Changer** (speech-to-speech) into the Kien voice, so Kevin sounds like Kien too.

**Narrator:** Lulu (`itMkRQx56fOF4CJe1D0C`), deadpan, documentary style.

**Settings:**
- `eleven_v3`, `mp3_44100_128`.
- Stability **Creative** for the characters, **Natural** for Kien's own lines and the narrator. Robust ignores tags.
- 1–2 tags per line. Caps add emphasis; an ellipsis adds a pause.
- Accent tags use the documented `[strong X accent]` form. Character tags like `[raspy old man voice]` are experimental: generate 3 takes and pick the best. Apply the radio filter for the astronaut in Remotion or a DAW.

| id | Speaker / voice | Text with tags | Target | Used in |
|---|---|---|---|---|
| N1 | Narrator · Lulu · Natural | [flatly] Kien... would not see this money again. | 2.1 s | F10, S10 |
| N2 | Narrator · Lulu · Natural | [warmly] Kien saw this money again. | 1.6 s | F20b, S16 |
| N3 | Narrator · Lulu · Natural | Tab grows with your group... so money never gets between friends. | 3.8 s | F21 |
| K1 | Kien (real) · Natural | [hopeful] Can we split this... eleven ways? | 1.4 s | F06, S06 |
| K2 | Kien · Natural | [exhales] Wow. [deadpan] Way too much going on. | 1.8 s | F12, S12 |
| W1 | Waiter · Veo native → Voice Changer (Kien) | Sorry. Group's too big. One card. | 2.4 s | F07, S07 |
| E1 | Ensemble · Kien voice · Creative · **6 takes**, layered ±40 ms and panned | [shouting] Just pay! I'll get you back! | 1.2 s each | F08, S08 |
| E2 | Grandpa · Creative | [raspy old man voice] [shouting] I'LL WRITE YOU A CHECK! | 1.0 s | F08, S08 |
| E3 | Baby · Creative | [babbling] Ba-ba-ba... VENMO! | 0.9 s | F08, S08 |
| E4 | Captain · Creative | [strong pirate accent] Ye'll get it back, matey! | 1.0 s | F08 |
| E5 | Gym bro · Creative | [excited] Three seconds, bro! | 0.8 s | F08 |
| E6 | Detective · Creative | [shouting] Let's just split it, let's— | 0.8 s, cut off by E1 | F08 |
| C1 | Captain · Creative | [strong pirate accent] Can I pay in doubloons? | 1.3 s | F11, S11 |
| C2 | Farmer · Creative | [earnest] Can I pay in rice? | 1.0 s | F11, S11 |
| C3 | Influencer · Creative | [sarcastic] Can I pay in... exposure? | 1.3 s | F11, S11 |
| C4 | Astronaut · Creative, radio filter in post | Signal's bad up here... I'll just text you later. | 2.0 s (SHORT: second sentence only, 1.2 s) | F11, S11 |
| C5 | Grandpa · Creative | [raspy old man voice] HOW DO I SEND MONEY ON THE FACEBOOK. [pause] Grandpa. | 2.4 s | F11, S11 |
| C6 | Baby · Creative | [babyish] I'm literally a baby. | 1.0 s | F11 |
| C7 | Detective · Creative | [whispers] One of you is lying. | 1.1 s | F11 |
| C8 | Wizard · Creative | [curious] How much do I owe again? | 1.1 s | F11 (29.37) and again in F17 |
| O1 | Wizard · Natural | [deadpan] ...that's not my owl. | 1.2 s | Wizard cut only |
| B1 | Kien · Natural | [gulps] | 0.5 s | F23, S18 |

**Sound effects** (ElevenLabs Sound Effects, text-to-sound; generate 2 variants of each):

| id | Prompt | Length |
|---|---|---|
| X1 | dense ambience of a packed Cantonese banquet restaurant: overlapping chatter and laughter, porcelain clinks, chopsticks, a lazy susan turning, distant kitchen clatter (loopable) | 22 s |
| X2 | a big table of friends bursting into loud laughter | 3 s |
| X3 | a long thermal receipt paper unspooling and unspooling | 3 s |
| X4 | contactless card terminal approval beep, close | 1 s |
| X6 | crickets, quiet, comedic pause | 2 s |
| X8 | empty restaurant late at night: room tone, a distant mop bucket squeak | 5 s |

**Library SFX:** `click-camera`, `clock-tick-single`, `paper-page-turn`, `bass-hit-short`, `impact-cine-big`, and `phone-buzz` (already in `public/audio/sfx`).

**Message pops:** two soft, real-sounding samples alternating, with volume stepping down (S2). No synth bleeps (S1).

---

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| **Face consistency** across 11 copies and across shots | H01 is generated first and gated. Every face prompt carries IMG_0198/0199 plus H01, and later shots also carry H02/H10 for location. Kling holds start frames best, so it gets the multi-face motion. Clips stay 3–5 s with subtle action, and we cut before faces morph. The edit pass (2 cr) fixes a single wrong face. The joke survives "close enough": costumes carry character, the face carries "same guy." |
| **AI weirdness** (hands with chopsticks, extra fingers, owl anatomy, head count, gibberish signage) | Every prompt says "no text, no lettering." Faces are framed so hands are small or busy. Quick cuts hide flaws. The head count isn't checkable at this speed. Freeze-frames get picked by hand from the cleanest frame. Readable text (receipt, chat, tags, captions) is always our DOM, never AI. |
| **Veo lip-sync / dialogue miss** (M2) | It's tested early (B2). Fallback: still plus VO, where the deadpan works without moving lips. Voice Changer keeps Veo's timing. |
| **Credit overrun** | Stills come before motion, with gates after H01 and H02. Each asset has a fallback that costs nothing or 2 cr. Stop-loss at 40 (stills) and 140 (total). The planned ceiling is 124.5, under the 170 cap, and the 100 reserve is never touched. |
| **Readability and layout audit** | Fixed zones (§3). Flood lines are ≤ 2 bubble lines; long Tab messages scroll inside the thread; captions are ≤ 2 lines in R-bottom and ≤ 1 line in the band. Tags are placed from measured head coordinates. Banner back-cards are blank `data-overlay` slivers; the receipt plate is `data-texture` (the macro scroll is the readable version). Run `src/audit.tsx` on both cuts before review. |
| **Pacing too fast** (R3) | The fast avalanche is deliberate (the mess is the point), but every key joke gets ≥0.9 s at readable cadence. TOTAL, the narrator freeze, the tagline and the wordmark all hold ≥1 s. If review says "too fast," cut flood lines, not hold frames. |
| **Product accuracy** | All Tab copy is verbatim from `templates.ts`, and every flow is checked against SPEC and the tests: even split (lopsided limit $162 > $117.50), "settle up" in ledger mode, typed YES → tapToPay, a 👍 from each payer → that payer's own DM, payer's own 👍 ignored, privacy gate silent, "through capital one nessie" (Nessie is the Capital One sandbox; gen 1 uses the same wording). The receipt math is script-checked. |
| **Legal / IP** | Wizard is a parody: no names from the books, no scar, no house crest, plum-and-mustard scarf. Astronaut has no NASA logos or flags. Kien's hoodie is plain Carolina blue, because the UNC logo is a trademark and AI shouldn't render it. The restaurant is fictional (search the name before posting); the phone is 555-01xx. The iMessage look has no Apple logos; Venmo and Facebook appear only as spoken words. Music: "Cat Walk", Arulo, Mixkit License. |
| **Consent and likeness** | Kien appears ~110 times and may be voice-cloned. Get his explicit OK on the cast sheet, each costume, and any clone **before** generating. Default to him recording his own lines. |
| **Cultural sensitivity** | Big Asian restaurant, Asian lead, eleven costumes: the comedy has to come from the costumes and money, never ethnicity. The farmer wears a wide-brim straw hat, **not** a conical hat. No accents for any Asian character. No gong or "oriental" stinger; the restaurant runs on real ambience. All food on the receipt is real. Have the team (including Kien) sign off on the farmer and the Chinese line on the receipt. |
| **Music anchors drift during edits** | Like gen 1, build cut times from the bar grid in a `timeline.ts`, not hand frames. Any shot change gets a full SFX re-pin (S3). |
