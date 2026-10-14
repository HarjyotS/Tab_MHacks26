# Higgsfield credit ledger — gen-2 promo ("Table for Ten Kiens")

Workspace: starter plan. Phase budget: **cast portraits ≤ 32 credits**.

Balance before cast phase (2026-10-04): **270 credits**

Identity refs (uploaded once, reused by UUID; crops in `gen2/ref-crops/`):
- kien-front-face.jpg `0d598291-69fd-4796-a718-a18a9b5e4259`
- kien-front-bust.jpg `3a69a6ae-a884-429d-80bb-becc9159655b`
- kien-side-face.jpg `3205267a-9a83-4968-8517-6eec3fe6e8be`
- kien-34-face.jpg (from freeze-bet.jpg) `d64ce1b0-b064-46f1-b2d5-d14832e8b8c3`

Uploads and `generate cost` checks are free.

| date | asset | model | credits | job id | result |
|---|---|---|---|---|---|
| 2026-10-04 | cast/real (hero portrait, 2k 1:1, 4 crop refs) | nano_banana_pro | 2 | 9340d221-15e0-4dea-bc7f-e1499ebd1ffa | kept: strong likeness (4.5/5); hoodie shows CAROLINA lettering |
| 2026-10-04 | cast/wizard (gate) | nano_banana_pro | 2 | 11731d3d-c055-4bec-83d9-0227b5e15465 | kept: strong likeness (4.5/5); scarf plum/mustard reads Gryffindor-ish, tiny robe emblem cut off at bottom-right edge |
| 2026-10-04 | cast/captain (gate) | nano_banana_pro | 2 | 220c1a45-3de0-4823-a8b9-b914213e9907 | kept: good likeness (4/5), snarl shifts face slightly; hook, eyepatch, hoop all read |
| 2026-10-04 | cast/farmer | nano_banana_pro | 2 | c5bb1493-cc94-438a-8360-0147fb64621a | kept: 4/5; wide-brim straw hat (per SCRIPT); sack has legible "50 LBS RICE" text despite no-text prompt |
| 2026-10-04 | cast/fluencer | nano_banana_pro | 2 | 59b94aae-f4f5-497c-b81e-c7eae3b96de1 | kept: 4/5; ring-light catchlights faint |
| 2026-10-04 | cast/gainz | nano_banana_pro | 2 | 38f12b31-05f6-4855-9323-48179af64585 | 3.5/5; arms not comically big → retake |
| 2026-10-04 | cast/grandpa | nano_banana_pro | 2 | 8284a793-ad9f-4350-b91c-94005cc43e7a | 2.5/5; convincing aging, reads as a generic old man → retake |
| 2026-10-04 | cast/space | nano_banana_pro | 2 | 4425d327-8c6c-4de9-9efe-b91737d14548 | kept: 4/5; glare blob over one eye |
| 2026-10-04 | cast/holmes | nano_banana_pro | 2 | 8212a719-88c8-4a91-b89c-dfa2143dadbb | 3/5; face reads older/longer → retake |
| 2026-10-04 | (ceo submit rejected: 4-concurrent-job limit) | nano_banana_pro | 0 | — | not charged (balance confirmed 252 after 9 jobs) |
| 2026-10-04 | cast/ceo | nano_banana_pro | 2 | 25a20174-a011-479e-8546-c3abb7033259 | kept: 3.5/5; sunglasses hide eyes |
| 2026-10-04 | cast/baby | nano_banana_pro | 2 | cd341c84-0d81-4453-8e4d-1271f6145a7e | 3/5; eyes rounder than Kien's, bare-arm bib → retake |
| 2026-10-04 | cast/waiter | nano_banana_pro | 2 | e8925615-48ab-43a6-819c-edb6bad413f2 | kept: 4/5 |
| 2026-10-04 | cast/grandpa retake (+ real.png as 1st ref `23b2a341-2a38-48ef-85f6-49088ff8a208`) | nano_banana_pro | 2 | 499b11f3-a7b1-48f8-80c6-6f1c0041993f | kept as primary: 3/5, nose/lips closer to Kien, eyes visible; v1 (shoutier) → cast/spares/grandpa-v1.png |
| 2026-10-04 | cast/holmes retake (+ real.png ref) | nano_banana_pro | 2 | 3fdcf144-0d91-4c65-b4ee-52b962123914 | kept as primary: 4/5, younger, clearly Kien; v1 → spares |
| 2026-10-04 | cast/baby retake (+ real.png ref) | nano_banana_pro | 2 | 1633c3a9-61c9-4440-9956-936ba82fd277 | kept as primary: 4/5, yellow onesie fixes bare arms; v1 → spares |
| 2026-10-04 | cast/gainz retake (+ real.png ref) | nano_banana_pro | 2 | 6e711222-96dd-47f2-9749-90dc53af5510 | kept as primary: 4/5, absurd muscle-suit arms; small "K" mark on shaker; v1 → spares |

**Cast phase total: 32 credits** (16 jobs × 2: 12 first-pass portraits + 4 retakes). Balance after: **238 credits** (270 → 238, matches `higgsfield account status`).

Settings for every job: `nano_banana_pro`, 1:1, 2k (1k costs the same 2 cr). First pass used the 4 crop refs; retakes put `cast/real.png` (`23b2a341-2a38-48ef-85f6-49088ff8a208`) first, then the 4 crops. Prompts: `gen2/prompts/cast-<slug>.txt`. Rejected v1 takes: `public/gen2/cast/spares/`.

## Phase A: scene stills (budget ≤ 30 credits incl. retakes; H01 dropped)

Balance before Phase A (2026-10-04): **238 credits**

Extra refs uploaded for Phase A (free): lettering-free crops, so group shots can't copy the CAROLINA print or the sack text:
- real.png top 2048×1580 (CAROLINA cut off) `5a18b65e-62ce-4f6a-bf7f-5da16121d528`
- farmer.png top 2048×1200 ("50 LBS RICE" cut off) `93f39020-4198-48cd-becd-1b5f954017b3`

Group-shot ref order (13): real crop, baby, grandpa, space, gainz, farmer crop, captain, wizard, fluencer, holmes, ceo (final portrait job ids above; §2 clockwise seating), then front + side face crops.

| date | asset | model | credits | job id | result | running total |
|---|---|---|---|---|---|---|
| 2026-10-04 | H02 overhead master take 1 (16:9 2k, 13 refs) | nano_banana_pro | 2 | b9287e1d-05dc-40c1-b9c3-2d453ea1dd2b | rejected → `stills/spares/H02-take1.png`: 11 diners, plain hoodie, great room; but the baby is a literal infant, and the astronaut has a US flag patch and a lettered chest patch | 2 |
| 2026-10-04 | H02 retake 1: edit pass on take 1 (+ baby, wizard, ceo portraits, face crops) | nano_banana_pro | 2 | 0e22e242-089a-43aa-8e26-e404665b874f | kept as `stills/H02.png` (approved at gate): adult baby in bonnet + high chair, plain white spacesuit, CEO sunglasses + phone at each ear; wizard still maroon/gold (not fixed) | 4 |
| 2026-10-04 | H03 bill-drop medium (H02, real crop, ceo, baby, grandpa, face crops) | nano_banana_pro | 2 | b367d740-f0ad-4829-a5f5-36497825876a | kept (no budget to retake): copied H02's overhead framing instead of eye level; real Kien laughing head-back with chopsticks, CEO left, baby + grandpa right; no clear empty patch | 6 |
| 2026-10-04 | H04 Kien CU take 1 (real crop, face crops, H02) | nano_banana_pro | 2 | 554ffc59-3221-4414-b0e6-4641833607b4 | rejected → spares: face reads older with acne scars, not Kien; folder already open | 8 |
| 2026-10-04 | H06 waiter (waiter portrait, face crops, H02) | nano_banana_pro | 2 | c9336f79-035f-477a-9c95-4f085aba4661 | kept: 3.5–4/5 vs waiter portrait; blank badge; tiny gibberish brand + keypad digits on terminal; grey-shirt customer at frame left | 10 |
| 2026-10-04 | H10 alone take 1 (real crop, face crops, H02) | nano_banana_pro | 2 | d10d493b-634a-4417-bb3f-04723efb49ad | rejected → spares: copied H02's frame, food untouched, not late-night | 12 |
| 2026-10-04 | H05 receipt POV plate (H02 ref, quality medium, 2k) | gpt_image_2_5 | 1 | 6f7b22b5-f6ae-49f9-8aec-a64569b3f92b | kept: blank flat receipt strip down center, plain blue sleeves, 2688×1520 | 13 |
| 2026-10-04 | H07 eruption OTS (H02, real crop, face crops, 6 portraits) | nano_banana_pro | 2 | c5584de2-51f0-4835-81a4-de7c2a577e13 | kept: true reverse angle, all 10 in seat order pointing; baby reads young | 15 |
| 2026-10-04 | (H08 at 4k rejected: "Pro or Ultimate plan required") | nano_banana_pro | 0 | — | not charged (balance confirmed); ran at 2k instead | 15 |
| 2026-10-04 | H11 banquet hall (H02, face crops) | nano_banana_pro | 2 | 47c76d0b-72bf-462e-b15a-399144530c7b | kept: H02 table at center-bottom, ~9 tables of costumes; some non-Kien diners; high-angle not ceiling | 17 |
| 2026-10-04 | H08 reaction sheet, 2k (H02, face crops, 6 portraits) | nano_banana_pro | 2 | 94e84ac2-86fa-48f1-aa2a-e081079234e2 | kept: 6 cells ~880×680 px; astronaut cell has a small US flag patch (lower-right, crop it out) | 19 |
| 2026-10-04 | H09 tap take 1 (front crop, real crop, side, H06, H02) | nano_banana_pro | 2 | ca458e88-a2ff-4a07-b0e5-7e9ecb074386 | superseded → spares: good likeness but happy smile, and a 2nd light-blue-hoodie man in background | 21 |
| 2026-10-04 | H04 retake 1 (front crop first, stronger ID block) | nano_banana_pro | 2 | 1c83b85d-b188-4bdf-b4bd-229cf27a609f | kept: 4/5 likeness, closed folder, mild suspicion | 23 |
| 2026-10-04 | H10 retake 1 (front crop first, "don't copy H02 framing") | nano_banana_pro | 2 | 8e12d721-a426-412d-8cad-8a2bd0392652 | kept: eye-level, late night, stacked chairs, mopper, empty high chair; food still mostly whole | 25 |
| 2026-10-04 | H12 busted (front crop, real crop, side, H10 retake) | nano_banana_pro | 2 | 8cc5438b-b310-4b30-bad3-7eeba149d1a0 | kept: 3.5/5, sheepish wide-eyed grin to lens; matches H10 | 27 |
| 2026-10-04 | H09 retake 1: edit pass on take 1 (+ fluencer portrait, face crops) | nano_banana_pro | 2 | eb6f2d51-5b53-4926-af80-f58cf3b6e1aa | kept: duplicate hoodie man → influencer; tighter forced smile (eyes not fully dead); small glyph on terminal icon | 29 |

**Phase A total: 29 credits** (≤ 30 budget; 14 charged jobs: 13 × nano_banana_pro 2 cr + 1 × gpt_image_2_5 1 cr; one free rejection). Balance after: **209 credits** (238 → 209, matches `higgsfield account status`). Retakes used: H02 ×1, H04 ×1, H10 ×1, H09 ×1. Rejected takes: `public/gen2/stills/spares/`. Prompts: `gen2/prompts/Hxx.txt` (final), `Hxx-take1.txt` for regenerated shots (H04, H10), `Hxx-edit.txt` for edit passes on top of `Hxx.txt` (H02, H09).

Notes: the edit's CLI call for H02 returned "no response received" but the job was created; check `higgsfield generate list` before re-submitting after a network error. With H02 as a ref, wide prompts copy its overhead framing unless told not to (H03, H10 take 1). 4k needs a Pro plan.

## Phase B: motion (budget ≤ 60 credits incl. retakes; B8/M3w skipped)

Balance before Phase B (2026-10-04): **209 credits**. Start frames passed by job id (H02 `0e22e242…`, H03 `b367d740…`, H04 retake `1c83b85d…`, H06 `c9336f79…`, H07 `c5584de2…`, H10 retake `8e12d721…`, H11 `47c76d0b…`). Kling `pro` needs a Pro/Ultimate plan, so M1 and M6 ran in `std` (7.5 cr each instead of 8.75).

| date | asset | model | credits | job id | result | running total |
|---|---|---|---|---|---|---|
| 2026-10-04 | B1 M7 exhale (H10, std 3 s, sound off) | kling3_0 | 4.5 | b372fb3a-13ce-48e2-90a0-211c61398084 | kept | 4.5 |
| 2026-10-04 | B2 M2 waiter (H06, 4 s, generate_audio) | veo3_1_lite | 6 | 3ece393c-99ab-458c-a7cc-cca49b7d3b4e | kept | 10.5 |
| 2026-10-04 | B3 M4 opens (H04, std 4 s, sound off) | kling3_0 | 6 | 19685ab4-11a6-4c02-8264-7492d98c256a | kept | 16.5 |
| 2026-10-04 | B4 M3 bill drop (H03, std 4 s, sound off) | kling3_0 | 6 | a4f7be98-a7fe-41ab-ad14-df921fadc221 | kept | 22.5 |
| 2026-10-04 | B5 M5 eruption take 1 (H07, 4 s, generate_audio) | veo3_1_lite | 6 | f8ebc37d-ae6a-45a3-b5bf-02588e643aae | rejected → `clips/spares/M5-take1.mp4`: foreground real Kien turns to camera and shouts from 1.1 s; table mostly cheers instead of pointing | 28.5 |
| 2026-10-04 | (M1 + M6 in `pro` rejected: "Pro or Ultimate plan required") | kling3_0 | 0 | — | not charged (balance confirmed); ran in std | 28.5 |
| 2026-10-04 | B6 M1 open (H02, std 5 s, sound off) | kling3_0 | 7.5 | 882386d2-87cf-4196-875b-06679b762286 | kept | 36 |
| 2026-10-04 | B7 M6 growth take 1 (H02 → H11, std 5 s) | kling3_0 | 7.5 | f586a187-b38d-4a82-90c5-5297df3f39c4 | rejected → `clips/spares/M6-take1.mp4`: a gold signboard with fake Chinese characters appears above the dragon panel 1.5–3.8 s | 43.5 |
| 2026-10-04 | B5 M5 retake (foreground told to stay still; everyone points) | veo3_1_lite | 6 | aaf0a532-5533-4fd1-a057-3eb40e202f12 | kept | 49.5 |
| 2026-10-04 | B7 M6 retake ("no signboards, plaques, characters") | kling3_0 | 7.5 | 12e1e3e3-6d09-4923-beb0-fb96e249e366 | kept | 57 |

**Phase B total: 57 credits** (≤ 60). Balance after: **152 credits** (209 → 152, matches `higgsfield account status`). Prompts: `gen2/prompts/Mx.txt` (final), `M5-take1.txt`, `M6-take1.txt`.

### Phase B clips (`public/gen2/clips/`)

| clip | res | fps | dur (s) | audio | use in → out (s) | notes |
|---|---|---|---|---|---|---|
| M1 open | 1284×716 | 24 | 5.04 | no | 0.0 → 5.04 | laughing, chopsticks reach in from ~3.4, gym bro flexes, waiter passes; slow push-in; faces stable |
| M2 waiter | 1280×720 | 24 | 4.01 | yes (AAC 48k st) | 0.0 → 4.0 | voiced bursts 0.29–0.65 / 1.3–1.9 / 3.0–3.4 match "Sorry. / Group's too big. / One card." (needs a human listen); terminal pushed out 2.7–3.4; tiny gibberish text on terminal |
| M3 bill drop | 1284×716 | 24 | 4.04 | no | 0.0 → 3.6 | waiter steps in behind Kien, folder lands ~2.3–2.8, nobody reacts; waiter lingers after |
| M4 opens | 1284×716 | 24 | 4.04 | no | 0.0 → 4.0 | opens 0.3–1.9, eyes widen 2.7–3.5; face stable; small gold gibberish emblem on folder cover from ~2.0 (blur in edit); waiter's arm enters right edge ~3.3 |
| M5 eruption | 1280×720 | 24 | 4.01 | yes (AAC 48k st) | 0.0 → 3.3 | all point + shout; voiced shouting 0.05–3.2 (words unverified); foreground stays back-to-camera; grandpa's mustache/hair turn black from ~0.3; baby reads toddler-ish |
| M6 growth | 1284×716 | 24 | 5.04 | no | 0.0 → 5.04 | H02 → H11 reveal; dragon wall morphs to stage ~0.9–1.7; background diners ghost in ~1.8–2.7; ends on H11; no text |
| M7 exhale | 1284×716 | 24 | 3.04 | no | 0.0 → 3.04 | lowers phone ~0.6, exhale ~1.0–2.0, leans back + smile 2.0–3.0; mopper keeps moving |
