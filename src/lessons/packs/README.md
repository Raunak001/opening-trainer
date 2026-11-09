# Lesson packs

One JSON file per pack. Every `*.json` here is bundled and validated at load
(`src/lessons/lesson.ts`); a broken pack is listed on the Lessons page instead of shown.

```json
{
  "id": "strike-the-center",
  "name": "Strike the center",
  "description": "optional",
  "lessons": [
    {
      "id": "center-01",
      "concept": "strike-center",
      "fen": "<full FEN, side to move = side the user plays>",
      "prompt": "What the user is asked.",
      "accepted": ["d4", "c3"],
      "hints": ["Text hints, revealed one at a time."],
      "explanation": "Shown once solved."
    }
  ]
}
```

- `accepted` is SAN; the first move is the main answer (the hint arrow points at it).
- Lesson ids are unique across all packs; positions are unique within a pack.
- The authoring tool (Lessons → Author) exports this format.
