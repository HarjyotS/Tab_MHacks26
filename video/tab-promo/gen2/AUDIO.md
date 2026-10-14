# Gen 2 audio: voice lines, SFX, music

Everything lives in `public/gen2/audio/{vo,sfx,bgm}/`. Gen 1 files (`public/audio/**`) were not touched.

## Voices

| Role | Voice | ID | Model / stability |
|---|---|---|---|
| Narrator (N1–N3) | Lulu (professional) | `itMkRQx56fOF4CJe1D0C` | `eleven_v3`, 0.5 Natural |
| **Every Kien** (K1, K2, E1–E6, C1–C8, O1) | **Liam, "Energetic, Social Media Creator"** (premade, young American male) | **`TX3LPaxmHKxFdv7VOQHJ`** | `eleven_v3`. Characters use 0.0 Creative. K1, K2 and O1 use 0.5 Natural |
| B1 gulp | ElevenLabs Sound Effects (`eleven_text_to_sound_v2`) | n/a | see "Problems" |

- No voice clone and no Voice Changer were used. W1 was skipped because it comes from Veo's native audio.
- Audio tags are exactly as written in SCRIPT.md §8. B1 is the only exception (see Problems).

## Processing (same targets as gen 1)

1. **Trim:** `silenceremove` at −45 dB on both ends, keeping 40 ms of pad.
2. **Loudness:** target −16 LUFS integrated, TP −1.5, LRA 11.
   - Pass 1 is a `loudnorm` measurement.
   - When the linear second pass landed within 0.5 LU of target, it was kept as is. That was 9 VO files and all SFX.
   - Short or peaky lines either made `loudnorm` switch to dynamic mode or landed off target. For those, the pass-1 gain was applied linearly and fed into `alimiter=limit=0.89:level=0:latency=1`, then corrected against an `ebur128` re-measure.
   - Result: every VO file is at −16.2 to −16.6 LUFS with true peak ≤ −1.2 dBTP.
3. **Encoding:** VO is mono, 44.1 kHz, 192 kbps MP3 (same as gen 1 VO). `E1-ensemble` and the SFX are stereo.
4. **`C4-radio`:**
   - Filter: highpass 300 Hz ×2, lowpass 3400 Hz ×2, +6 dB into `asoftclip=atan`, then `acrusher` (8-bit, log, mix 0.15).
   - A 70 ms filtered squelch and 30 ms of gap sit at the head, then the file is normalized.
5. **`E1-ensemble`:** all 6 takes, each level-matched first.
   - Every take is cut at its word gaps (taken from STT timestamps) into "Just" / "pay!" / "I'll get you back".
   - Each piece is anchored to a common time (Just 0.10 s, pay! 0.58 s, I'll 1.33 s), plus per-take offsets of 0, ±20 and ±40 ms.
   - Takes are panned −0.8 … +0.8 (constant power), then the mix is normalized.
   - Phrase-aligned layering beats plain onset offsets here. The takes' natural timing differs by up to 0.3 s, so plain layering smeared "pay" into mush (STT heard "Just, hey").
6. **Selection:**
   - Takes were picked by trimmed duration against the Target column, rejecting long internal silence.
   - Words were checked with STT (`scribe_v1`).
   - For the experimental character lines, a pitch/voicing proxy also counted: highest pitch for the baby, lowest voicing (most rasp) for the grandpa.

## VO files

STT column = `scribe_v1` transcript of the **final processed file**. TP = true peak.

| id | Voice / model | STT of final file | Dur (s) | LUFS | TP (dBTP) | Take chosen | Target (s) |
|---|---|---|---|---|---|---|---|
| N1 | Lulu · v3 · 0.5 | "Kien¹ would not see this money again" | 2.59 | −16.6 | −1.8 | t1 of 4 | 2.1 |
| N2 | Lulu · v3 · 0.5 | "Kien¹ saw this money again" | 1.85 | −16.2 | −2.8 | t2 of 2 | 1.6 |
| N3 | Lulu · v3 · 0.5 | "Tab grows with your group, so money never gets between friends" | 4.49 | −16.5 | −1.2 | t1 of 2 | 3.8 |
| K1 | Liam · v3 · 0.5 | "Can we split this 11 ways?" | 3.24 | −16.3 | −1.3 | t1 of 2 | 1.4 |
| K2 | Liam · v3 · 0.5 | "[sighs] Wow. Way too much going on" | 3.19 | −16.5 | −1.2 | t2 of 2 | 1.8 |
| K2-tight | same take, pause after "Wow" cut 0.63 s | "[sighs] Wow. Way too much going on" | 2.56 | −16.5 | −1.2 | t2 | 1.8 |
| B1 | SFX gulp (sound-generation) | "[gulp]" | 0.91 | −16.3 | −2.0 | SFX v1 of 2 (TTS t1, t2 rejected) | 0.5 |
| E1-ensemble | Liam · v3 · 0.0 · 6 takes | "Just pay! I'll get you back" | 2.51 | −16.2 | −5.0 | all 6 (t1–t6) | 1.2 |
| E2 | Liam · v3 · 0.0 | "I'll write you a check" | 2.14 | −16.2 | −2.5 | t2 of 3 (raspiest) | 1.0 |
| E3 | Liam · v3 · 0.0 | "Ba, ba, ba. Venmo" | 2.22 | −16.3 | −1.3 | t1 of 3 (highest pitch, exact words) | 0.9 |
| E4 | Liam · v3 · 0.0 | "You'll get it back, matey" (pirate "ye'll") | 1.99 | −16.4 | −1.2 | t2 of 2 | 1.0 |
| E5 | Liam · v3 · 0.0 | "Three seconds, bro?" | 1.41 | −16.2 | −2.8 | t1 of 2 | 0.8 |
| E6 | Liam · v3 · 0.0 | "Let's just split it. Let's" | 1.85 | −16.2 | −2.8 | t1 of 2 (no mid-line gap) | 0.8 |
| C1 | Liam · v3 · 0.0 | "Can I pay in doubloons?" | 1.41 | −16.5 | −1.2 | t1 of 2 | 1.3 |
| C2 | Liam · v3 · 0.0 | "Can I pay in rice?" | 1.31 | −16.4 | −1.8 | t2 of 2 | 1.0 |
| C3 | Liam · v3 · 0.0 | "Can I pay in exposure?" | 2.59 | −16.3 | −1.2 | t2 of 2 | 1.3 |
| C4 | Liam · v3 · 0.0 (clean) | "Signal's bad up here. I'll just text you later" | 3.00 | −16.5 | −1.2 | t1 of 3 | 2.0 |
| C4-tight | same take, pause cut 0.42 s | same | 2.59 | −16.4 | −1.2 | t1 | 2.0 |
| C4-radio | same take + radio chain | same | 3.11 | −16.4 | −1.2 | t1 | 2.0 |
| C4-tight-radio | tight + radio chain | same | 2.69 | −16.4 | −1.3 | t1 | 2.0 |
| C5 | Liam · v3 · 0.0 | "How do I send money on the Facebook? Grandpa" | 4.78 | −16.3 | −1.2 | t3 of 3 (raspiest, shortest) | 2.4 |
| C5-tight | same take, [pause] cut from 1.6 to 0.5 s | "How do I send money on the Facebook, Grandpa?" | 3.68 | −16.3 | −1.2 | t3 | 2.4 |
| C6 | Liam · v3 · 0.0 | "I'm literally a baby" | 2.04 | −16.2 | −2.7 | t3 of 3 (highest pitch, shortest) | 1.0 |
| C7 | Liam · v3 · 0.0 | "One of you is lying" (whispered) | 1.67 | −16.3 | −1.2 | t1 of 2 | 1.1 |
| C8 | Liam · v3 · 0.0 | "How much do I owe again?" | 1.46 | −16.3 | −1.3 | t1 of 2 | 1.1 |
| O1 | Liam · v3 · 0.5 | "That's not my owl" | 1.33 | −16.4 | −1.3 | t2 of 2 | 1.2 |

¹ STT can't know the spelling, so it wrote the name phonetically. All 4 N1 takes came back as "Keane" (sounds like "keen"). Both N2 takes came back as a two-syllable "kee-an". The narrator may be saying the name two different ways in the callback pair. **Listen to N1 against N2 before locking.** For a fix, see "Problems".

**Cue points for the editor:**
- **C4, SHORT cut (second sentence only):**
  - `C4.mp3`: startFrom 2.00 s, which leaves 1.00 s.
  - `C4-radio.mp3`: 2.10 s.
  - `C4-tight.mp3`: 1.58 s.
  - `C4-tight-radio.mp3`: 1.68 s.
- **E1-ensemble:** "Just" at 0.10 s, "pay!" at 0.58 s, "I'll get you back" from 1.33 s to the end at 2.51 s. "JUST PAY!" is done by about 1.15 s.
- **C5:** "Grandpa" starts at 4.26 s in `C5.mp3` and at 3.16 s in `C5-tight.mp3`.

## SFX and music

| id | Prompt (§8) | Chosen | Dur (s) | LUFS | TP (dBTP) | Why |
|---|---|---|---|---|---|---|
| X1 | banquet restaurant ambience (loopable) | v1 of 2 | 21.55 | −24.2 | −6.8 | Steady bed (LRA 2 vs 6; v2 had +1.5 dBTP spikes). Generated with `loop: true`, then given a 0.5 s equal-power crossfade seam. Checked the wrap: no sample jump, junction RMS within the clip's normal ±1.7 dB. |
| X2 | big table bursting into laughter | v2 of 2 | 3.03 | −19.9 | −9.1 | Fast 0.25 s onset, then a held laugh of about 2 s (works as the F01 swell). v1 starts at full level on sample 0 and only decays. |
| X3 | thermal receipt unspooling | v1 of 2 | 3.03 | −20.3 | −5.4 | Continuous broadband paper friction for the full 3 s. v2 is tonal and rattly, closer to a printer motor; it's in scratch if you prefer it. |
| X4 | contactless approval beep | v1 of 2 | 1.04 | −20.2 | −11.1 | Clean two-tone beep (about 1.24 kHz then 1.40 kHz, 0.4 s). v2 is a 50 ms click. |
| X6 | crickets, comedic pause | v2 of 2 | 2.04 | −20.2 | −8.0 | Chirps around 3.7 kHz, pulsing. v1 was basically silent (−72 dBFS). |
| X8 | empty restaurant room tone + distant mop squeak | v2 of 2 | 5.04 | −20.3 | −7.4 | Low room tone throughout, squeak at about 2.0–2.5 s. v1 drops to digital silence for its last 2.5 s. |
| bgm | `cat-walk.mp3` (Arulo, Mixkit) | copied untouched | 124.03 | n/a | n/a | from the video-shotcraft assets |

## Durations (paste into the editor)

```ts
export const VO_DUR: Record<string, number> = {
  N1: 2.59, N2: 1.85, N3: 4.49,
  K1: 3.24, K2: 3.19, 'K2-tight': 2.56, B1: 0.91,
  'E1-ensemble': 2.51, E2: 2.14, E3: 2.22, E4: 1.99, E5: 1.41, E6: 1.85,
  C1: 1.41, C2: 1.31, C3: 2.59, C4: 3.00, 'C4-tight': 2.59, 'C4-radio': 3.11, 'C4-tight-radio': 2.69,
  C5: 4.78, 'C5-tight': 3.68, C6: 2.04, C7: 1.67, C8: 1.46, O1: 1.33,
};

export const SFX_DUR: Record<string, number> = {
  X1: 21.55, X2: 3.03, X3: 3.03, X4: 1.04, X6: 2.04, X8: 5.04,
};

// cue points inside files (seconds)
export const VO_CUES = {
  C4_secondSentence: { C4: 2.0, 'C4-radio': 2.1, 'C4-tight': 1.58, 'C4-tight-radio': 1.68 },
  E1: { just: 0.1, pay: 0.58, ill: 1.33 },
  C5_grandpa: { C5: 4.26, 'C5-tight': 3.16 },
};
```

## Problems and what I'd try next

1. **Almost every line runs long against its Target.** v3 with emotion tags reads about 1.3–2× slower than the §8 targets assume. These collide with the beat sheet:
   - **K1 (3.24 s) in F06 (1.6 s).** It overruns by about 1.6 s, and 0.5 s of that is the scripted "..." pause. Options: let it run under the start of F07, extend F06, or use `playbackRate` 1.2 in Remotion. Remotion renders playbackRate with `atempo`, so pitch is kept.
   - **K2 in F12.** Use `K2-tight` (2.56 s) starting around 42.0 instead of 42.7. It then ends at about 44.56, before F13.
   - **C5 in the flood.** In FULL, C5 at 39.29 gets only 2.08 s before the hard cut at 41.37. In SHORT, C5 at 28.65 gets only 1.38 s. Either start `C5-tight` about 1.5 s before its message bubble lands (it needs about 3.7 s to reach "Grandpa"), or accept losing the sign-off.
   - **Flood cadence.** Lines sit about 0.92 s apart but run 1.3–3.0 s each. They will overlap: C3 runs 1.2 s into C4, and C7 overlaps C5 and C6. Duck the earlier line, or use playbackRate 1.1–1.2 on the C lines.
   - **F08 eruption.** E2–E5 run 1.4–2.2 s against 0.3–0.4 s picture cuts. Overlapping them is the joke, but expect only the first word or two of each to read.
   - N1 (2.59 s) fits F10 if it starts at 24.0. N3 (4.49 s) ends about 0.1 s into F22, so start it at 69.9.
2. **B1 "[gulps]".**
   - `eleven_v3` rejects a tag-only input ("input_text_empty").
   - With `[gulps] ...`, take 1 was a quiet gulp followed by a loud, clipped burst at the very end. Take 2 came back as a throat clear.
   - I used an ElevenLabs sound-effect gulp instead: "a single nervous comedic gulp, a young man swallowing hard, close mic, dry".
   - Next: record a real gulp on a phone, or generate `[gulps] uh.` and cut off the "uh".
3. **Name pronunciation (N1 vs N2).** See note ¹. If the two reads differ by ear, regenerate the odd one with a phonetic respelling in the text (for example "Kee-en"), or add an ElevenLabs pronunciation dictionary alias for "Kien".
4. **Experimental character voices can't be verified by STT.** STT confirms the words, not the character:
   - Grandpa: E2 and C5 were picked as the raspiest takes.
   - Baby: E3 and C6 were picked as the highest-pitched takes.
   - Astronaut: C4 has no tag; the character comes from the radio filter.
   - If any of them doesn't read by ear, next steps are: more takes with a different descriptor (`[shaky old man voice]`, `[toddler voice]`), or ElevenLabs Voice Design.
   - Avoid switching speakers, so the "it's all Kien" joke holds.
5. **Minor:**
   - E4's pirate "Ye'll" transcribes as "You'll". That's expected and reads fine.
   - E5 transcribed with a "?", so it may land as a question. The alternate is `tts/E5_t2.mp3` (1.59 s trimmed).
   - K1 "eleven" shows as "11", which is just STT formatting.
   - C7 (whisper) needed +19 dB to reach −16 LUFS, so play it lower in the mix to keep it whisper-sized.

## Scratch (rejected takes, transcripts, scripts)

`/private/tmp/claude-501/-Users-harjyot-Desktop-code-tab-Tab-MHacks26/89771490-9c85-439d-bb42-4a221654c27f/scratchpad/gen2-audio/`:
- `tts/`: all 53 raw VO takes (`<ID>_t<n>.mp3`).
- `sfx/`: all SFX variants plus the 2 gulps.
- `stt/`: scribe JSON for every take and every final file.
- `proc/`: trimmed WAVs and mixes.
- `process.py`: the full post chain, reproducible.

ElevenLabs usage: the account counter went from 515 to 2,397, so this pass used **1,882 credits**. That covers 53 TTS takes (plus 2 rejected requests) and 14 sound-effect generations, out of the 130,348 limit.
