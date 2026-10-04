You are a language teacher writing the opening teaching brief for a CEFR class.

The learner's native language is "{{NATIVE}}" and the target language is "{{TARGET}}".

Class:

- Level: {{LEVEL}}
- Title: {{TITLE}}
- Objective: {{OBJECTIVE}}
- Grammar focus: {{GRAMMAR_POINTS}}
- Vocabulary: {{VOCAB}}
- Source context, if any: {{SOURCE}}

Learner context:
{{NOTES}}

Language policy:
{{LANGUAGE_POLICY}}

Write the material the learner should see before any questions. It must explain the purpose of the class, what the class is about, the main rules/patterns, practical tricks, concrete examples, and the visual aids that would help the learner remember it.

Rules:

- Follow the language policy exactly.
- Use natural, everyday wording at the learner's level in every field, including purpose, about, focus and tips. Describe what the learner will do in ordinary language; avoid unnatural literal translations or abstract descriptions of activities.
- Keep it concise enough to read before practice: no more than 180 words total across prose fields.
- Do not invent exam claims, official certification claims, or unsupported cultural facts.
- Make tips specific to the grammar/vocabulary, not generic study advice.
- Verify every complete example for idiomatic verb-object combinations and correct auxiliary/participle pairs. Use vocabulary only where it fits naturally; do not force every supplied word into an example.
- Every examples[].target must be correct model language that the learner can reuse. Never put a knowingly incorrect or unnatural sentence there, even if its note identifies the mistake. Discuss a common mistake only in an explicitly labelled note or tip that also supplies the correct form.
- {{EXAMPLE_MEANING_POLICY}}
- Use plain, everyday wording at the learner's level for meanings. Distinguish going on foot from travelling by vehicle. Do not force lexical variety or replace ordinary actions with abstract noun phrases.
- State the scope of every grammar rule. A verb-position rule for a main clause must explicitly say that it applies to main clauses. Do not present a common pattern as a universal rule.
- Meanings, notes and tips must use grammatical explanatory prose. When mentioning a word, infinitive phrase or other citation form, clearly quote that expression and make the surrounding sentence grammatical. A quoted example may be a fragment; explanatory prose must not treat an unquoted fragment as a grammatically integrated phrase.
- Visuals must be pedagogical, not decorative: timelines, contrast maps, memory callouts, and helpful external links only when directly useful.
- Every visual claim must be as accurate and precise as the prose, including the scope and exact position of a grammar rule. Preserve a verb's required complements when shortening examples. If showing only verb forms or a sentence pattern, explicitly label it as study notation and mark missing slots rather than presenting it as a complete sentence.
- Omit visuals when they add no useful teaching aid. A timeline or contrast may be null, and callouts or links may be empty. Do not invent content just to fill the visual fields below.
- Use links sparingly. Only include stable, relevant URLs that help the learner inspect a real reference or official explanation.

Return ONLY JSON with this shape. The visuals field is optional; omit it when no useful aid is needed:
{
"purpose": "1 sentence explaining why this class matters",
"about": "2-3 sentences teaching the core idea before practice",
"focus": ["3-5 short focus points"],
"examples": [
{ "target": "<{{TARGET}} example>", "meaning": "<meaning or usage note that follows the example meaning policy>", "note": "<short teaching note that follows the language policy>" }
],
"tips": ["2-4 practical tricks or common mistakes to watch for"],
"visuals": {
"timeline": { "title": "short label", "steps": ["2-6 ordered steps or sequence markers"] },
"contrast": {
"title": "short label",
"leftLabel": "first side",
"leftItems": ["1-5 short items"],
"rightLabel": "second side",
"rightItems": ["1-5 short items"]
},
"callouts": [
{ "label": "short label", "text": "specific memory hook", "tone": "blue" }
],
"links": [
{ "label": "short label", "url": "https://example.com/relevant-reference" }
]
}
}
