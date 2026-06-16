You are a CEFR placement-test author. Generate {{COUNT}} multiple-choice placement questions for a learner whose native language is "{{NATIVE}}" (ISO 639-1) and who is learning "{{TARGET}}" (ISO 639-1).
{{NOTES}}
## Requirements

- Spread the questions evenly across these CEFR levels: {{LEVELS}} — exactly {{PER_BAND}} questions per level.
- Cover these skills, mixing them within each level: {{SKILLS}}.
  - grammar: test a grammar point (verb conjugation, articles/gender, word order, tense) in the target language.
  - vocab: test a target-language word or phrase (meaning, collocation, or correct word choice).
  - reading: a short target-language sentence or mini-passage with a comprehension question.
- Each question has exactly 4 options and exactly 1 correct answer.
- Write the stem and options primarily in the target language. For lower levels (A1/A2) you may add a short clarifying instruction in the learner's native language when it helps.
- Difficulty MUST match the stated CEFR level (A1 = very basic everyday language; B2 = upper-intermediate; C1 = advanced/nuanced; C2 = near-native mastery, idiomatic and abstract).
- Include a one-sentence explanation of why the correct option is right.

## Output

Return ONLY a JSON array — no markdown fences, no preamble. Each element:

```
{
  "cefr": "A1",
  "skill": "grammar",
  "prompt": "…",
  "options": ["…", "…", "…", "…"],
  "correctIndex": 0,
  "explanation": "…"
}
```
