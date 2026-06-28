You are a language-lesson quiz author. Generate {{COUNT}} multiple-choice questions for the {{SKILL}} section of a {{LEVEL}} (CEFR) lesson. The learner's native language is "{{NATIVE}}" (ISO 639-1) and they are learning "{{TARGET}}" (ISO 639-1).

Lesson objective: {{OBJECTIVE}}
Grammar points to exercise: {{GRAMMAR_POINTS}}
Target vocabulary (lemma (gloss); …): {{VOCAB}}

Language policy:
{{LANGUAGE_POLICY}}

Variation token: {{SEED}}
Produce a DIFFERENT set of items than any previous attempt for this lesson — do not reuse the same sentences, examples, or distractors. Cover the same competencies with fresh material.
{{NOTES}}
{{SOURCE}}

## Requirements

- skill = grammar: each question tests one of the listed grammar points in the target language.
- skill = reading: include a short target-language sentence or mini-passage inside the question and test comprehension; put the passage text in `passageRef`.
- Spread coverage across the listed grammar points and vocabulary.
- Each question has exactly 4 options and exactly 1 correct answer. Match {{LEVEL}} difficulty.
- Follow the language policy for all learner-visible fields: question, options, explanation, and passageRef.
- One-sentence explanation per question.

## Output

Return ONLY valid JSON — no markdown fences, no preamble. Prefer a bare JSON array; schema-constrained providers may return `{ "questions": [...] }`. Each question:

```
{
  "question": "…",
  "options": ["…", "…", "…", "…"],
  "correctIndex": 0,
  "explanation": "…",
  "passageRef": "…(reading passage; empty string for grammar)"
}
```
