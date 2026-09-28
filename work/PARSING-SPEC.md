# PARSING SPEC — English Grammar in Use exercises → JSON

You are parsing extracted page text into exercise JSON. Answer data comes ONLY
from the answer-key text. Never invent, "improve", or complete answers.

## Inputs

- Page text: `work/pages/plain/pNNN.txt` (NNN = zero-padded PDF page number).
- Answer key for unit N: `work/key/unit-NNN.txt`.
- Answer key for additional exercises: `work/key/additional.txt`.

- Answer-key files may contain small orphan fragments (lines with no `N.M`
  label) and their item order can be jumbled — key pages are multi-column.
  The first line of a key file (`# key pages: pNNN`) tells you which PDF
  pages hold that unit's key: read their PLAIN text
  (`work/pages/plain/pNNN.txt`) when the key file is ambiguous. Plain key
  pages preserve the visual 2-column grid and are the readable ground truth.
- Unit → PDF pages mapping: `work/layout.json` (`units[N].pdfPages`, `title`).

## Text-layout notes

- A unit start often prints `Unit` alone on one line and
  `<num> <title>` on the next line (look at the file, not just line 1).
- Exercise items are numbered `1.` `2.` … or `N.M` at line starts, often with
  large whitespace between the number and the text (layout-preserved columns).
- The last page footer has cross-references like
  `Present continuous and present simple ➜ Units 3–4` — ignore all `➜` lines.
- Page footer may also contain a bare page number and a sidebar `Unit N`.
- Curly quotes (’ ‘ “ ”) and en/em dashes are part of the text: copy them
  verbatim into instructions, stems, and word banks.

## Output schema

`data/units/unit-NNN.json` (NNN = zero-padded 3), one file per unit:

```json
{
  "unit": 1,
  "title": "Present continuous (I am doing)",
  "pdfPages": [13, 14],
  "exercises": []
}
```

`data/additional/NN.json` (NN = zero-padded 2), one file per additional exercise:

```json
{
  "id": 25,
  "topic": "Reported speech",
  "refs": "Units 47–48, 50",
  "pdfPages": [328, 329],
  "exercise": {}
}
```

`exercises` / `exercise` holds one object per numbered exercise:

```json
{
  "id": "1.1",
  "type": "fill-in",
  "instruction": "What’s happening in the pictures? Choose from these verbs:",
  "wordBank": ["cross", "hide", "scratch", "take", "tie", "wave"],
  "items": []
}
```

- `id` is globally unique. Unit exercises: `"N.M"`. Additional exercises: `"N"`.
- `wordBank` is present only when the exercise prints a word bank; extra
  duplicates in the bank (e.g. one extra distractor verb) are kept verbatim.
- Exactly one `type` per exercise; no per-item type overrides.

## Item shapes by type

### fill-in — blank(s) inside a sentence

```json
{"num": 1, "parts": ["She’s taking ", " a picture."], "answers": [["taking"]]}
```

- `parts.length == answers.length + 1`; gap i sits between `parts[i]` and
  `parts[i+1]`.
- `answers[i]` = ALL acceptable strings for that gap, taken from the key
  (split variants per rules below).
- Key shows `…` between two answers for one printed item → ONE JSON item with
  2+ gaps, e.g. key `4 fell … hurt` → one item, `answers: [["fell"], ["hurt"]]`.

### choice — lettered options a/b/c…

```json
{"num": 2, "options": ["a …", "b …", "c …"], "answer": 2}
```

- `answer` is the 0-based index of the correct option.
- `options` entries are the printed option texts (keep the `a …` letter prefix
  out or in? IN — copy the option text WITHOUT the letter prefix).

### matching — "Which goes with which?"

No `items`. Exercise-level fields:

```json
{"leftOptions": ["1 Please don’t make so much noise.", "…"],
 "rightOptions": ["a I’m getting hungry.", "…"],
 "pairs": [[0,5], [1,3]]}
```

- `rightOptions` in the book's printed (scrambled) order with letter prefixes
  stripped (`a `, `b `…); `leftOptions` with number prefixes stripped.
- `pairs[i]` = `[leftIndex, rightIndex]`, exactly one pair per left option,
  indices 0-based.

### write — write a full sentence / question / answer

```json
{"num": 2, "prompt": "(why / you / cry?)", "answers": ["What’s the matter? Why are you crying?"]}
```

- `prompt` = the printed cue on the exercise page (the parenthesised word
  cues). Keep verbatim including parentheses. If the book underlines part of
  the prompt (e.g. "Are the underlined verbs OK?…"), wrap ONLY the underlined
  span in square brackets inside `prompt`, e.g.
  `"Ben [tries] to find a job, but he hasn’t had any luck yet."` — the UI
  renders the bracketed span underlined; brackets must be balanced and
  non-empty (validator checks this).
- Exercise-level `example: [1, 2]` lists the item nums the printed book
  already answers on the page (right-column solved answers). Those render as
  printed rows and are excluded from grading; their `answers` hold the
  printed model text; the remaining rows keep normal `answers` from the key.


### self-check — model answers, not auto-checkable

```json
{"num": 2, "prompt": "(what / you / do / these days?)", "modelAnswers": [""]}
```

- Used when the key header says `Example answers:` / `(example answer)` / the
  exercise is genuinely open-ended (descriptions, emails, true personal
  facts).
- `modelAnswers` = the key's example answer(s); may be empty ONLY via missing-
  key rule below.
- No Check button; the UI reveals the model answer and the user self-marks.

## Type-mapping rules (mandatory)

1. Blank/underscored gap inside a sentence → `fill-in`.
2. "Which goes with which?" / left column ↔ right column → `matching`.
3. Choose among printed lettered options a/b/c… → `choice`.
4. "Write questions/sentences/replies" → `write`.
5. Key header `Example answers:` or free personal answers → `self-check`.
6. Anything not cleanly mappable → `self-check` (never invent an auto-checkable answer).
7. Answers come ONLY from the key text. Never invent or "fix" answers. If the
   key truly lacks an item's answer: keep the item, set type `self-check` with
   `modelAnswers: []` and append one line `unitN.M item<nums>` to
   `work/missing-key.txt`.
8. Key variant splitting: split on ` / ` and on ` or ` ONLY when both sides
   are plausible standalone answers; when unsure, include BOTH readings as
   separate variants (a superset of accepted answers is safe; a missing
   variant is not).
9. Keep original typography (curly apostrophes, dashes) in
   stems/instructions verbatim from the page text.

## Correctness bar

- The set of exercise ids you can see printed on the unit's pages (e.g.
  `1.1`, `1.2`, `1.3`, `1.4`) MUST equal the ids in your JSON. Run:

    python scripts/validate.py data/units/unit-NNN.json

  Fix until it exits 0. Then visually confirm every instruction, stem, option,
  and answer in your JSON against the page text and key text once more.
- Item `num` values are the printed item numbers (1,2,3… as printed, offsets
  preserved — never renumber).
- `self-check` items keep their printed prompt; `prompt` may be an empty
  string only when the exercise truly has no printed cue.
