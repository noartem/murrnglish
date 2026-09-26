# Review Report — Parsed Exercise Data Quality Audit

## Scope
- Full diff: units 1, 17, 44, 72, 98, 121, 139, 145
- Full diff: additional exercises 1, 16, 25, 41
- Spot-check: 5 items each from units 8, 23, 37, 52, 67, 81, 104, 118, 131, 143
- Structural sanity: all 145 unit files + 41 additional files

## Structural Sanity

- **145 unit files present** (units 1–145, none missing)
- **566 total exercises** across all units
- **41 additional exercise files** present
- **Exercise ids consecutive** N.1..N.k per unit — all pass
- **Choice options count** ≥ 2 for all choice exercises — all pass
- **Matching pairs** one-per-left for all matching exercises — all pass
- **Self-check items** all have non-empty modelAnswers — all pass
- **Additional exercise ids** all valid — all pass

---

## Mismatches Found

### Unit 1 — `data/units/unit-001.json`

**1.1 item 1** — Parts split error (example item)
- **JSON**: parts `["She's taking ", " a picture."]` answers `[["taking"]]`
- **Result**: "She's taking **taking** a picture." (duplicated "taking")
- **Correct**: parts `["She\u2019s ", " a picture."]` answers `[["taking"]]`

**1.1 items 2–6** — Answers include bare -ing forms that don't grammatically fill the gap
- Item 2: JSON answers `[["tying", "is tying"]]` — "He **tying** a shoelace" is ungrammatical
  - Key says: "He's tying / He is tying" → gap answer should be `["'s tying", "is tying"]`
- Item 3: JSON parts `["She ", " the road."]` answers `[["crossing", "is crossing"]]`
  - **Two errors**: (a) subject "She" is wrong — key says "They're crossing" → should be `["They ", " the road."]`; (b) "She crossing the road" is ungrammatical → answer should be `["'re crossing", "are crossing"]`
- Item 4: JSON answers `[["scratching", "is scratching"]]` — "He **scratching** his head" is ungrammatical
  - Key says: "He's scratching" → answer should be `["'s scratching", "is scratching"]`
- Item 5: JSON answers `[["hiding", "is hiding"]]` — "She **hiding** behind a tree" is ungrammatical
  - Key says: "She's hiding" → answer should be `["'s hiding", "is hiding"]`
- Item 6: JSON answers `[["waving", "are waving"]]` — "They **waving** to somebody" is ungrammatical
  - Key says: "They're waving" → answer should be `["'re waving", "are waving"]`

**1.4 item 8** — Parts/answer spacing
- **JSON**: parts `["Tim ", " today. He\u2019s taken the day off."]` answers include `["\u2019s not working"]`
- **Result**: "Tim **'s** not working" (space before apostrophe)
- **Correct**: parts `["Tim", " today. He\u2019s taken the day off."]` (remove trailing space after "Tim")

---

### Unit 17 — `data/units/unit-017.json`

**17.1** — Clean ✓ (all 8 matching pairs verified against key)
**17.2** — Clean ✓ (all 11 items verified)
**17.3** — Clean ✓ (all 12 items verified)
**17.4** — Clean ✓ (all 10 items verified)

---

### Unit 44 — `data/units/unit-044.json`

**44.4 item 2** — Example item treated as practice item
- **JSON**: parts `["I ", " invited to many parties."]` answers `[["don't get"]]`
- **Book page**: item 2 is shown as complete sentence "I don't get invited to many parties." (example, like item 1)
- **Key**: starts at item 3 (items 1–2 are examples, not in key)
- **Correct**: answers should be `[]` (empty, same as item 1)

All other exercises (44.1, 44.2, 44.3, 44.4 items 3–10) verified clean ✓

---

### Unit 72 — `data/units/unit-072.json`

**72.2** — Wrong exercise type (choice instead of fill-in)
- **JSON**: type "choice", each item has 3 options and one `answer` index
- **Book page**: instruction is "Put in a/an or the." — each sub-option (a, b, c) needs its own article filled in
- **Key format**: "1 a a / b the / c the" (different article for each sub-option)
- **Correct type**: "fill-in" with 3 gaps per item (one per sub-option a/b/c)
- **Items 4–5**: Key missing from `work/key/unit-072.txt` (only items 1–3 present); JSON answers for items 4–5 are unverifiable

**72.1, 72.3, 72.4** — Clean ✓

---

### Unit 98 — `data/units/unit-098.json`

**98.1** — Clean ✓ (all 8 items with compound nums verified)
**98.2** — Clean ✓ (all 15 items verified)
**98.3** — Clean ✓ (all 11 items verified)

---

### Unit 121 — `data/units/unit-121.json`

**121.2 items 1–10** — Systematic parts/answer duplication
- The parts include the word bank phrase text AFTER the blank, causing the answer to appear twice
- Item 1 (example): parts `["Mozart was born ", " 1756."]` answers `[["in 1756"]]` → "Mozart was born in 1756 **1756**."
  - Should be: parts `["Mozart was born in 1756", "."]` answers `[]` (example)
- Item 2: parts `["If the sky is clear, you can see the stars ", " at night."]` answers `[["at night"]]` → "...stars **at night at night**."
  - Should be: parts `["If the sky is clear, you can see the stars ", "."]` answers `[["at night"]]`
- Same duplication pattern for items 3–10

**121.3 items 1, 4, 6, 9** — Key says "both" but JSON stores single answer
- Item 1: key "both" (a and b both correct), JSON answer: 1 (only b)
- Item 4: key "both", JSON answer: 1 (only b)
- Item 6: key "both", JSON answer: 1 (only b)
- Item 9: key "both", JSON answer: 1 (only b)
- **Note**: The choice type can only store one answer; the checker would incorrectly mark option a as wrong

**121.1** — Clean ✓

---

### Unit 139 — `data/units/unit-139.json`

**139.1** — Clean ✓ (all 6 matching pairs verified)
**139.2** — Clean ✓ (all 15 items verified)
**139.3** — Clean ✓ (all 6 items verified)
**139.4** — Clean ✓ (all 5 items verified)

---

### Unit 145 — `data/units/unit-145.json`

**145.1** — Clean ✓ (all 6 items verified)
**145.2** — Clean ✓ (all 6 items verified)
**145.3** — Clean ✓ (all 7 items verified)
**145.4** — Clean ✓ (all 5 items verified)

---

### Additional Exercise 1 — `data/additional/01.json`

**Item 3** — Missing answer variant
- **JSON**: answers `[["I\u2019m getting"]]`
- **Key**: "I'm getting / I am getting"
- **Missing**: `"I am getting"` variant

---

### Additional Exercise 16 — `data/additional/16.json`

**Items 4, 6, 10, 13** — Key says multiple options correct but JSON stores single answer
- Item 4: key "B or C", JSON answer: 1 (only B)
- Item 6: key "A or C", JSON answer: 0 (only A)
- Item 10: key "A or B", JSON answer: 0 (only A)
- Item 13: key "A or B", JSON answer: 0 (only A)
- **Note**: Same design limitation as 121.3 — choice type can't represent "both" answers

---

### Additional Exercise 25 — `data/additional/25.json`

Clean ✓ (all 7 items verified against key, including jumbled key sections)

---

### Additional Exercise 41 — `data/additional/41.json`

**Item 11** — Missing answer variants
- **JSON**: answers `[["left", "missed"]]`
- **Key**: "left / 've left / have left or missed / 've missed / have missed"
- **Missing**: `"'ve left"`, `"have left"`, `"'ve missed"`, `"have missed"` variants

---

### Spot-Check Units (8, 23, 37, 52, 67, 81, 104, 118, 131, 143)

All clean ✓ — 5 items per unit verified against key, no mismatches found.

---

## Summary

| Category | Count | Details |
|----------|-------|---------|
| **Type mapping errors** | 1 | Unit 72, exercise 72.2 (choice → fill-in) |
| **Example items with wrong answers** | 2 | Unit 1 1.1 item 1, Unit 44 44.4 item 2 |
| **Grammatically broken answers** | 5 | Unit 1 1.1 items 2–6 (bare -ing forms) |
| **Wrong subject** | 1 | Unit 1 1.1 item 3 ("She" → "They") |
| **Systematic duplication** | 10 | Unit 121 121.2 items 1–10 (parts include answer text) |
| **Parts spacing error** | 1 | Unit 1 1.4 item 8 |
| **Missing answer variants** | 2 | Additional 1 item 3, Additional 41 item 11 |
| **Choice "both" limitation** | 8 | Unit 121 121.3 items 1,4,6,9 + Additional 16 items 4,6,10,13 |

**Total mismatches: 30 individual item-level issues across 6 files**
