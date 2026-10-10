import { cefrRank } from '../cefr-levels';
import type { CefrLevel } from '@sotto/shared';

export function isImmersionLevel(level: string): boolean {
  return cefrRank(level as CefrLevel) >= cefrRank('A2');
}

export function classIntroExampleMeaningPolicy(p: {
  level: string;
  nativeLang: string;
  targetLang: string;
}): string {
  return [
    isImmersionLevel(p.level)
      ? `For each intro example, write its meaning as a short, grammatical ${p.targetLang} explanation of the actual action, state or message at the learner's ${p.level} level. Express the participants and what happens plainly. Observations about grammatical form or communicative use belong in note. Meaning may reuse the target's words; do not force synonyms or lexical differences.`
      : `For each intro example, preserve the exact meaning of the target sentence. Concise ${p.nativeLang} support is allowed under the A1 language policy.`,
    'Preserve who speaks and acts, participant identities and count, group membership, referents, event time and aspect, negation and modality. Prefer neutral explanatory wording when addressing the learner could change those relationships. A first-person group does not establish that the learner or addressee belongs to it.',
    'Distinguish the fields: target is reusable model language practicing the trusted grammar focus; meaning explains that sentence, and note teaches its form or use. A grammatical usage note or paraphrase need not repeat the target’s grammatical tense when it preserves the same event time and aspect. Do not reject an equivalent past-event explanation merely because its verb has a different past-tense form. Reject changed event time or aspect, and any incorrect claim about the target’s actual grammatical form.',
    'An explanation may use a different grammatical subject, person or number when it refers to the same participants and action. Agreement follows the explanation’s own grammatical subject in the target language. A singular collective noun can refer to the same plural group; do not require the original sentence’s plural verb form with that singular subject. Reject any added or excluded participant or changed action.',
    'Do not require identical pronouns or wording. Any change in participant identity or group membership must be explicitly supported by the trusted lesson context. Do not infer participants, events, results, intentions or grammar claims from the generated explanation itself.',
    isImmersionLevel(p.level)
      ? 'Judge an immersion meaning together with its displayed target sentence and trusted lesson context. An idiomatic explanation need not copy the target verb or grammatical tense, but it must convey the actual action, state or message and preserve its relationships. A general experience, presence or topic description is insufficient when it leaves the concrete action unspecified. Reject changed or omitted meaning, not equivalent wording. Explain the concrete misleading inference or lost distinction in rejection feedback. Preserve the participant, event-time, aspect, negation and modality requirements above.'
      : 'A meaning must express the actual action and relationships in the example. A broader statement that omits the action is not an equivalent explanation. Keep every claim grammatical, natural and supported by the example and trusted lesson context.',
  ].join(' ');
}

export function classIntroGrammarRulePolicy(): string {
  return [
    'Every grammar claim must state its relevant scope and hold for the exact verbs and forms it describes. A word-order claim must explicitly identify the clause type or the complete quoted example sentence to which it applies. Quoted verb forms alone do not establish clause scope. A qualification in another focus point, tip or example does not qualify this claim.',
    'Clause type and sentence type are separate. When statements and questions have different word order, qualify which sentence type the rule describes. Check the rule against every complete example it covers; saying main clause alone does not distinguish a statement from a question.',
    'Distinguish rules about grammatical forms from rules about their position. Identifying a participle does not establish where its auxiliary occurs. Check the claimed order in the stated clause context; main-clause order must not be presented as universal order.',
    'In written explanations, distinguish a quoted word or form being mentioned from the surrounding sentence that uses it. Respect quotation boundaries and the complete displayed example; do not combine separately quoted forms with adjacent explanatory words to invent a different word or construction. Still reject actual grammatical or collocational errors, false usage claims and changed meaning in the displayed explanation.',
    'When reviewing a rule, identify a concrete contradiction or the missing applicable scope. Feedback must explain the defect and the required correction; repeating the claim without explaining its defect is insufficient. Correct equivalent wording and stylistic preference alone are not defects.',
  ].join(' ');
}

export function classLanguagePolicy(p: {
  level: string;
  nativeLang: string;
  targetLang: string;
}): string {
  if (isImmersionLevel(p.level)) {
    return [
      `Immediate immersion for ${p.level}: every learner-visible field must be in the target language (${p.targetLang}).`,
      `Do not write native-language (${p.nativeLang}) explanations, hints, translations, option text, guidance, or feedback.`,
      'If an output schema has a field named "translation" or "meaning", fill it with a target-language paraphrase or usage note, not a native-language translation. Intro examples follow the supplied example meaning policy instead: their meaning conveys the actual action, state or message, and form or use commentary belongs in note.',
      'Native-language support is handled by selection/right-click tools outside this generated class content.',
    ].join(' ');
  }

  return [
    `A1 scaffolding: keep the target language (${p.targetLang}) dominant, but concise native-language (${p.nativeLang}) support is allowed when it prevents confusion.`,
    'Examples and answer options should still exercise the target language.',
  ].join(' ');
}

export function classSpeakingMeaningPolicy(p: {
  level: string;
  nativeLang: string;
  targetLang: string;
}): string {
  return [
    classLanguagePolicy(p),
    'Speaking fields have distinct roles: targetPhrase is the exact utterance the learner practices aloud; translation supplies its meaning under the following field policy. IPA, when supplied, transcribes targetPhrase exactly.',
    isImmersionLevel(p.level)
      ? `For ${p.level}, translation is a short, grammatical ${p.targetLang} paraphrase or explanatory usage note about the exact utterance. It may reuse the entire targetPhrase unchanged. Lexical variation is not required. An explanation of a question or request may be a statement about what the speaker asks or requests; it need not itself perform that speech act. Its own grammatical subject, person and tense may differ when it still refers to the same participants and event time. Keep the utterance's communicated action, state, question or request and every stated fact clear.`
      : `For A1, translation is a concise, faithful ${p.nativeLang} translation of targetPhrase. Preserve the original speech act and speaker/addressee relationships. Grammatical differences between the languages are allowed only when they convey the same meaning.`,
    "In either mode, preserve the original speaker and addressee, participant identities and group membership, actions, event time and completion, place, negation, modality and stated descriptive facts. Distinguish an explanation's own grammatical framing from the utterance it explains. Reuse already correct wording and time anchors; do not force synonyms or a different grammatical tense.",
    "Reject changed or omitted meaning, invented answers, events, results or intentions, instructions replacing the meaning, and a broader topic description that leaves the utterance's message unspecified. Every form or usage claim must be correct for the exact utterance. Explanatory framing and exact wording reuse do not excuse grammatical, collocational, factual or phonetic errors.",
  ].join(' ');
}

export function classListeningTranscriptPolicy(p: {
  level: string;
  nativeLang: string;
  targetLang: string;
}): string {
  return [
    'The listening transcript is supplied as passage or passageText. The spoken-content rules below apply only to that shared passage.',
    'Assess listening difficulty for the actual task: learners can pause and replay the audio, and the multiple-choice questions are visible before answering. Do not assume a learner-visible transcript. Do not assume a single uninterrupted hearing or require unaided recall of every incidental detail. Replay does not establish that the audio is spoken slowly or clearly; actual audio delivery requires separate verification.',
    'Evaluate the complete passage for level-appropriate vocabulary, syntax and discourse, and evaluate question demands using the questions actually supplied to your role. A passage-only review must not invent a recall task or unseen question. Passage length, turn count, number of events or the mere presence of subordinate clauses alone does not establish a level defect, and there is no universal CEFR word or turn cutoff. Retain a level finding for a concrete comprehension barrier after the available support, such as inaccessible vocabulary or constructions, dense unsignposted events or dependencies, or a question requiring distinctions the learner cannot reasonably follow. Cite the actual wording or dependency and explain the remaining barrier. Pausing, replay and visible questions do not excuse these defects, incorrect grammar, incoherent facts or unsupported answers.',
    'In passageText, HOST and EXPERT at turn prefixes are nonspoken speaker identifiers. Known inline audio controls [laughs], [chuckles], [giggles], [with genuine belly laugh], [sighs], [exhales sharply], [whispers], [gasps], [excited], [sarcastic], [curious], [nervously], [cautiously], [pause], [short pause] and [long pause] are nonspoken delivery metadata. Do not reject these identifiers or controls merely for their English spelling.',
    'This exemption applies only to those transcript controls, never to arbitrary bracketed English or spoken words. Preserve actual speaker attribution.',
    'For passageText only, typography is a spoken-content defect when it changes audible meaning or pronunciation, or the written distinction itself is explicitly taught. Spoken word mentions may be identified by audible framing without quotation marks, which are not audible.',
    'A clearly framed word, verb or example form may be a fragment; its surrounding explanation must remain grammatical and idiomatic. A clearly presented starter for the learner to finish is an exercise input, not an asserted complete sentence.',
    'Assess each spoken example in its complete local teaching context. An erroneous form explicitly identified and correctly repaired is not endorsed as correct; reject uncorrected or endorsed errors, incorrect corrections and false meaning equivalences.',
    'Reject bare citation forms improperly integrated into ordinary clauses, incorrect case or agreement, missing complements and false rules. Still reject incorrect complete positive examples, unclear attribution and defective spoken language; do not reinterpret an unmarked error as an exercise or invent missing context.',
    'Retain normal written accuracy and citation checks for questions, options and explanations. The spoken-content distinctions above apply only to passageText.',
    'The following source-interpretation rules apply to the transcript and all passage-linked questions, options and explanations.',
    "Preserve the claim's actual quantifiers and local conditions. A contextual observation about a cited form does not assert that the form alone or universally encodes every detail unless that is explicitly claimed. Counterexamples must fit the claim's actual grammatical category, construction and conditions; a related event alone does not establish the same verb construction. Interpret word and form references using nearby explicit distinctions between base forms and inflections; do not assume every reference denotes the base form. Keep unstated details unspecified in literal accounts and operands, including a means of transport not entailed by the source expression. These scope rules do not excuse a false grammatical or factual claim.",
    'A role label identifying an otherwise unambiguous speaker is not contradicted merely because an internal speaker identifier omits its grammatical gender. Still reject actual misattribution, material ambiguity or false identity claims; do not invent names or biographical facts.',
    `Apply the class language policy to all spoken transcript content and the full questions, options and explanations: ${classLanguagePolicy(p)}`,
  ].join(' ');
}
