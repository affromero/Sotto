import { createHash } from 'node:crypto';
import type { LearningCatalog, LearningLevel, LearningObjective } from '@sotto/shared';

export interface SeedLessonReviewScope {
  level: LearningLevel;
  objective: string;
  grammarPoints: readonly string[];
  canDoSummary?: string;
}

interface ReviewedSeedObjective {
  objectiveId: string;
  criterionVersion: 1;
  criterionMeaningHash: string;
  rationale: string;
}

export interface ReviewedSeedLesson {
  pair: string;
  targetLang: string;
  slug: string;
  level: LearningLevel;
  catalogVersion: 1;
  sourceScopeHash: string;
  objectives: readonly ReviewedSeedObjective[];
  unresolvedScopes: readonly string[];
}

/** Exact reviewed source fields. A changed seed scope requires a new review. */
export function reviewedSeedSourceHash(lesson: SeedLessonReviewScope): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        level: lesson.level,
        objective: lesson.objective,
        grammarPoints: lesson.grammarPoints,
        canDoSummary: lesson.canDoSummary ?? null,
      })
    )
    .digest('hex');
}

/** Pin actual criterion meaning as well as its declared revision. */
export function reviewedSeedCriterionHash(objective: LearningObjective): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        branch: objective.branch,
        level: objective.level,
        assessment: objective.assessment,
        policyVersion: objective.policyVersion,
        skills: [...objective.skills].sort(),
        skillCriteria: Object.fromEntries(
          Object.entries(objective.skillCriteria).sort(([left], [right]) =>
            left.localeCompare(right)
          )
        ),
      })
    )
    .digest('hex');
}

/** Reviewed teaching scope only. No learner evidence or mastery is inferred. */
export const reviewedSeedLessonLinks: readonly ReviewedSeedLesson[] = [
  {
    pair: 'de-from-en',
    targetLang: 'de',
    slug: 'a1-greetings-introductions',
    level: 'A1',
    sourceScopeHash: 'fd8d1d442fa8252fa8e2b7e9394820cf36dd8d836ac59c9a75d25611367e1882',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'The greeting scope has sein but not haben, and does not establish the complete introduction task with origin, another detail, and a relevant question.',
    ],
  },
  {
    pair: 'de-from-en',
    targetLang: 'de',
    slug: 'a1-numbers-dates',
    level: 'A1',
    sourceScopeHash: '8c2aed475c17ee72c62ba2deec7cab6b3540d83e47d644e08fc9c91a760d1c0a',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'Cardinal numbers, basic ordinals, and dates have no reviewed matching leaf in this maintained A1 catalog.',
    ],
  },
  {
    pair: 'de-from-en',
    targetLang: 'de',
    slug: 'a1-nouns-articles-gender',
    level: 'A1',
    sourceScopeHash: 'e7c657d686bbb4ab3089cd842e3ee56b435aa65790bdd3505e8dbe1e586b748b',
    objectives: [
      {
        objectiveId: 'de.g.articles-gender',
        criterionVersion: 1,
        criterionMeaningHash: '790e5236a042c6d06cb750643f3e1b6ab2109712b28ec6d6cb007a439886efe1',
        rationale:
          'The lesson explicitly teaches all three German genders with definite and indefinite articles on common nouns.',
      },
    ],
    catalogVersion: 1,
    unresolvedScopes: [
      'Basic noun plural formation remains outside the reviewed article-selection link.',
    ],
  },
  {
    pair: 'de-from-en',
    targetLang: 'de',
    slug: 'a1-origin-nationality',
    level: 'A1',
    sourceScopeHash: '910dd462624221ecb2237a73508e5c2aa1b1cced41ab72e7ec99a4e9fb1b0e73',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'Origin and residence phrases do not by themselves establish the complete introduction task or a matching A1 grammar contrast.',
    ],
  },
  {
    pair: 'de-from-en',
    targetLang: 'de',
    slug: 'a1-family-people',
    level: 'A1',
    sourceScopeHash: 'ad283931be49b788e85b6c2c2ef20ede6acea311e32abfc13f0d7708278238a8',
    objectives: [
      {
        objectiveId: 'de.g.present-sein-haben',
        criterionVersion: 1,
        criterionMeaningHash: 'ee09e671c7eea19a316638766783ab47dbf926f0c972ac27419208fb79df6838',
        rationale:
          'The family lesson declares both present sein and present haben, supporting subject-matched identification, age, and possession.',
      },
    ],
    catalogVersion: 1,
    unresolvedScopes: ['Basic possessive articles and predicative adjectives remain unlinked.'],
  },
  {
    pair: 'de-from-en',
    targetLang: 'de',
    slug: 'a1-food-drink',
    level: 'A1',
    sourceScopeHash: '5858a5391c6dbec3829ff95cb05bd117335714fb2fd2b01e9bbda145cabb02e8',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'The ordering scope does not explicitly establish quantity and follow-up comprehension; food preferences and kein alone do not establish the complete negation contrast.',
    ],
  },
  {
    pair: 'de-from-en',
    targetLang: 'de',
    slug: 'a1-daily-routine-time',
    level: 'A1',
    sourceScopeHash: 'f55d892a25d1306fa0e68c1b4908460a08e158ccb2f69e3d55f550c15cdfb8bc',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'Separable verbs, routine time expressions, and present conjugation do not explicitly establish the fronted-time verb-second contrast.',
    ],
  },
  {
    pair: 'de-from-en',
    targetLang: 'de',
    slug: 'a1-shopping-prices',
    level: 'A1',
    sourceScopeHash: 'a9bf04877dbcd332009c5a10c770f91ed28bb14bdbc75ef5554d861cd3dd4c64',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'The scope establishes prices but does not explicitly establish a quantity request; nicht alone does not establish the nicht/kein contrast.',
    ],
  },
  {
    pair: 'de-from-en',
    targetLang: 'de',
    slug: 'a2-home-living',
    level: 'A2',
    sourceScopeHash: '66204e955db699c226870410d2cd21f24a5c18ed31ea2978f4e80b330f6e8783',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'Only dative location use is declared; the catalog objective also requires accusative destination use.',
    ],
  },
  {
    pair: 'de-from-en',
    targetLang: 'de',
    slug: 'a2-transport-directions',
    level: 'A2',
    sourceScopeHash: '65600e79fb99eb6ed2be19e04571b5a024664a247d1ba94b9eda9dfa381e8761',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'Only direction-focused accusative use is declared; the catalog objective also requires dative location use. The directions task belongs to A1.',
    ],
  },
  {
    pair: 'de-from-en',
    targetLang: 'de',
    slug: 'a2-health-body',
    level: 'A2',
    sourceScopeHash: 'b58406f2ce6f83d22c8eafa63290491a66885111b054046a7ab45fcdaf6edafd',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'The health task is maintained at B1, and the A2 grammar inventory has no reviewed equivalent for these symptom and obligation forms.',
    ],
  },
  {
    pair: 'de-from-en',
    targetLang: 'de',
    slug: 'a2-work-occupations',
    level: 'A2',
    sourceScopeHash: '07945a2e8eae4ed1149ebc3124c33765005149c4b06f259fa74ecaa0647fe438',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'Occupational nouns and basic work descriptions have no reviewed equivalent in the maintained A2 objectives.',
    ],
  },
  {
    pair: 'de-from-en',
    targetLang: 'de',
    slug: 'a2-past-tense-perfect',
    level: 'A2',
    sourceScopeHash: '88353e19c1a3bec90d013cf5df55dfb19b7d6a78a96d428ee11cf2c86f30ccd5',
    objectives: [
      {
        objectiveId: 'de.g.perfekt-haben-sein',
        criterionVersion: 1,
        criterionMeaningHash: '8b3006fed6bb2dc1166ac3e1f4c609d84ecfdf4f5d7d533821986f795d717150',
        rationale:
          'The lesson explicitly combines haben and sein auxiliaries with regular and common irregular participles for completed past events.',
      },
    ],
    catalogVersion: 1,
    unresolvedScopes: [],
  },
  {
    pair: 'de-from-en',
    targetLang: 'de',
    slug: 'a2-plans-future',
    level: 'A2',
    sourceScopeHash: '94b375630a28c9cb6aa2c05b45db51a12382973aabc09351c5572897c2a6efd3',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'Future werden, intentions, and invitations do not establish the A2 task of negotiating and confirming a meeting time and place.',
    ],
  },
  {
    pair: 'en-from-es',
    targetLang: 'en',
    slug: 'a1-greetings-introductions',
    level: 'A1',
    sourceScopeHash: '42e001f236d38c7c9231ecfa10b8c904d56fa0c2a1e94e04ffe60d9cb9ec2640',
    objectives: [
      {
        objectiveId: 'en.g.present-be',
        criterionVersion: 1,
        criterionMeaningHash: '005e53ba10d8e8686f4ac259a8bb562556e3bd06af30056382d93a40b9145b76',
        rationale:
          'The lesson declares present be, subject pronouns, and yes/no questions in basic personal exchanges.',
      },
    ],
    catalogVersion: 1,
    unresolvedScopes: [
      'The complete introduction task additionally requires another personal detail and a relevant question; those are not established by this source summary.',
    ],
  },
  {
    pair: 'en-from-es',
    targetLang: 'en',
    slug: 'a1-numbers-alphabet',
    level: 'A1',
    sourceScopeHash: 'a1c0ad229548c21d268c99108d66e7cd6045080823ea48cf55c37b483f2ba59b',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'Numbers, spelling, and clarification requests have no reviewed matching A1 leaf.',
    ],
  },
  {
    pair: 'en-from-es',
    targetLang: 'en',
    slug: 'a1-everyday-objects',
    level: 'A1',
    sourceScopeHash: '30067d7f29438db6e9b9ca526e8721411e1d1626f5fdb05c5170e88416901ad6',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'Article choice and demonstratives do not explicitly establish the plural count-noun formation required by the complete catalog leaf.',
    ],
  },
  {
    pair: 'en-from-es',
    targetLang: 'en',
    slug: 'a1-family-descriptions',
    level: 'A1',
    sourceScopeHash: '662f1adc373a976ddb54a567775b1a6559e3c926cefd539389164df1ea9dfa39',
    objectives: [
      {
        objectiveId: 'en.g.possessive-determiners',
        criterionVersion: 1,
        criterionMeaningHash: '35a387cb7c84c67e093acb8d237d7c042b8adb2e5de1da8fe448ac631e5b85c7',
        rationale:
          'Possessive adjectives are an explicit grammar focus for identifying family members and their owners.',
      },
    ],
    catalogVersion: 1,
    unresolvedScopes: [
      'Descriptive adjective position and present have remain outside the reviewed possessive-determiner link.',
    ],
  },
  {
    pair: 'en-from-es',
    targetLang: 'en',
    slug: 'a1-daily-routine',
    level: 'A1',
    sourceScopeHash: 'ffb91b7da037c695a5d06a475402a417d41a99f8639aff38d4594f9a61b4577b',
    objectives: [
      {
        objectiveId: 'en.g.present-simple-routines',
        criterionVersion: 1,
        criterionMeaningHash: 'f9446cb533f4da72765e52f25a301089a48e77cdb22e418bb0ffac2d3dbb900e',
        rationale:
          'The objective and summary explicitly describe daily habits with the simple present, matching subject-dependent present forms.',
      },
    ],
    catalogVersion: 1,
    unresolvedScopes: [
      'Frequency adverbs and telling the time have no separate reviewed objective link here.',
    ],
  },
  {
    pair: 'en-from-es',
    targetLang: 'en',
    slug: 'a1-food-drink',
    level: 'A1',
    sourceScopeHash: '9c8eca1756ef09f8ecbf94f9c6780199e97c35753c5435bc6163f9bb462fd1e2',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'Quantity and follow-up comprehension are not explicit in the ordering scope; some/any at A1 cannot be linked to the A2 some/much/many criterion.',
    ],
  },
  {
    pair: 'en-from-es',
    targetLang: 'en',
    slug: 'a1-places-directions',
    level: 'A1',
    sourceScopeHash: 'c2f02cf1c616cae3b51251bd191f807a67b3a2470b0af27f7257d602c24887a9',
    objectives: [
      {
        objectiveId: 'en.s.directions',
        criterionVersion: 1,
        criterionMeaningHash: '1f5f6ccc341a72a68ec1a31002c4a47ede44194294e9325dc7c7500387b2c501',
        rationale:
          'The objective asks for and gives simple directions, and the summary explicitly requires locating a place and understanding a short route.',
      },
    ],
    catalogVersion: 1,
    unresolvedScopes: [
      'Place prepositions, imperatives, and there-is/there-are remain outside the reviewed directions task link.',
    ],
  },
  {
    pair: 'en-from-es',
    targetLang: 'en',
    slug: 'a1-shopping',
    level: 'A1',
    sourceScopeHash: 'cd24fc8ea121c733a6e3e8e83e8ceac5bb6165cd07478c60545c574776e49ad3',
    objectives: [
      {
        objectiveId: 'en.s.shopping',
        criterionVersion: 1,
        criterionMeaningHash: '0a3dac70ac0e2f98872624a28d3507f5eb6b40ca2a531078663ae944564bc0cd',
        rationale:
          'The declared how-much/how-many focus supplies price and quantity questions, while the objective and summary require completing a basic purchase.',
      },
    ],
    catalogVersion: 1,
    unresolvedScopes: [
      'Size, colour, and demonstrative grammar remain outside the reviewed price-and-quantity task link.',
    ],
  },
  {
    pair: 'en-from-es',
    targetLang: 'en',
    slug: 'a2-past-experiences',
    level: 'A2',
    sourceScopeHash: 'd4411bccabb6778648b020a7d535cab1701e694cda52060b17c9aa358dcd49e5',
    objectives: [
      {
        objectiveId: 'en.g.past-simple-events',
        criterionVersion: 1,
        criterionMeaningHash: '3ac42626ba9bba772f7f33d754de3cadf43f5f9ef9437631b1a70ec547302d88',
        rationale:
          'The declared simple-past tense explicitly covers regular and common irregular completed events, matching the catalog tense scope.',
      },
    ],
    catalogVersion: 1,
    unresolvedScopes: [
      'The source does not explicitly establish event ordering and follow-up responses for the separate recent-experience situation task.',
    ],
  },
  {
    pair: 'en-from-es',
    targetLang: 'en',
    slug: 'a2-health-body',
    level: 'A2',
    sourceScopeHash: 'ba0b557f812c5f228a1ac4f4cb1f112c25930b75826c5e3984b7d8cba711c8df',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'The health situation is maintained at B1, and its modal-advice grammar has no reviewed A2 equivalent.',
    ],
  },
  {
    pair: 'en-from-es',
    targetLang: 'en',
    slug: 'a2-work-studies',
    level: 'A2',
    sourceScopeHash: '24c0a5cb1caf2ad955693f4c9108e8cf1e551c4b5cda3de10604bed2a5f40b75',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'Work descriptions and present routines do not establish a maintained A2 work task or a same-band grammar objective.',
    ],
  },
  {
    pair: 'en-from-es',
    targetLang: 'en',
    slug: 'a2-future-plans',
    level: 'A2',
    sourceScopeHash: '0f40c0c6572d02092cd393d1d96184e8744ce6107206e44189e5b91c03929fc1',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'Going to and will are declared, but the catalog contrast also requires present-continuous arrangements.',
    ],
  },
  {
    pair: 'en-from-es',
    targetLang: 'en',
    slug: 'a2-hobbies-interests',
    level: 'A2',
    sourceScopeHash: '01ca2a728477c3f868da61392b0ac6b7bb8a582c69978436d1c14fb9897b81ae',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'Gerund preferences and invitations do not establish negotiation and confirmation of a meeting time and place.',
    ],
  },
  {
    pair: 'en-from-es',
    targetLang: 'en',
    slug: 'a2-travel-transport',
    level: 'A2',
    sourceScopeHash: 'be37c24d1da1812407340c3c41592dc5fdc1b73ee7bbf9382ec37006f05808d5',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'Comparatives alone do not establish superlatives, and arrangements alone do not establish the going-to contrast. Ordinary travel transactions do not establish problem resolution.',
    ],
  },
  {
    pair: 'es-from-en',
    targetLang: 'es',
    slug: 'a1-greetings-introductions',
    level: 'A1',
    sourceScopeHash: '3c32d27bffa572419aacd92d053902a2c6a40894c66110754e2816bbde309fd5',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'Ser without estar does not establish that contrast, and name/origin alone do not establish the complete introduction task.',
    ],
  },
  {
    pair: 'es-from-en',
    targetLang: 'es',
    slug: 'a1-numbers-alphabet',
    level: 'A1',
    sourceScopeHash: '38a8d5d7eb0ed29fda5b47cf225637e027455bb21b837be0b64bb199be3ceaf5',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: ['Numbers, ages, and spelling have no reviewed matching A1 leaf.'],
  },
  {
    pair: 'es-from-en',
    targetLang: 'es',
    slug: 'a1-nouns-articles-gender',
    level: 'A1',
    sourceScopeHash: 'c84bfa865f850616adf55a26e6085f285ae370857777d4b890888a90ea9b4451',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'Articles, noun gender, and noun plurals do not establish the adjective agreement required by the complete catalog leaf.',
    ],
  },
  {
    pair: 'es-from-en',
    targetLang: 'es',
    slug: 'a1-ser-estar',
    level: 'A1',
    sourceScopeHash: '6c188c0bc1f09b196814c9f20f7343ff29f7e7b93121a65c7da5920c0f5add70',
    objectives: [
      {
        objectiveId: 'es.g.ser-estar-basics',
        criterionVersion: 1,
        criterionMeaningHash: '332c3008adaa3c7cb2e48fe86dec6d0b88a3e6603db5590026a3d1a81298d0d5',
        rationale:
          'The lesson explicitly contrasts ser for descriptions with estar for states and locations in the present.',
      },
    ],
    catalogVersion: 1,
    unresolvedScopes: [],
  },
  {
    pair: 'es-from-en',
    targetLang: 'es',
    slug: 'a1-family-adjectives',
    level: 'A1',
    sourceScopeHash: '0be3574b5ad89afb1128a59f13432466009423ad24efdbcfa74a62a13b0c8fde',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'Adjective and possessive practice does not explicitly establish the full article-and-adjective agreement criterion.',
    ],
  },
  {
    pair: 'es-from-en',
    targetLang: 'es',
    slug: 'a1-present-tense-regular-verbs',
    level: 'A1',
    sourceScopeHash: '561a6cb1c6f8f19bdbf807ddceb21856055edcf24c7f589dc96c7878e6528294',
    objectives: [
      {
        objectiveId: 'es.g.present-regular-verbs',
        criterionVersion: 1,
        criterionMeaningHash: '843db861d8153e0c125323e38bddf924ab91a5581a239da6f73f20a157c58c4c',
        rationale:
          'The lesson explicitly teaches present conjugation of regular -ar, -er, and -ir verbs.',
      },
    ],
    catalogVersion: 1,
    unresolvedScopes: [
      'Negation and question formation remain separate unreviewed scope beyond regular present conjugation.',
    ],
  },
  {
    pair: 'es-from-en',
    targetLang: 'es',
    slug: 'a1-food-drink-ordering',
    level: 'A1',
    sourceScopeHash: 'a06b61e860e7e2bfefd539d2597d7b4253ce06a4239727e98cb4a4e315b13834',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'Gustar is maintained at A2. Quantity and follow-up comprehension are not explicit in this A1 ordering scope.',
    ],
  },
  {
    pair: 'es-from-en',
    targetLang: 'es',
    slug: 'a1-days-time-schedule',
    level: 'A1',
    sourceScopeHash: '3fd6ac6b5dddd52678f27271b67cbdd88fc65c00f542f0442fc3457e1a45ad96',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'Dates, time, and weekly schedules have no reviewed equivalent in the maintained A1 objectives.',
    ],
  },
  {
    pair: 'es-from-en',
    targetLang: 'es',
    slug: 'a2-home-surroundings',
    level: 'A2',
    sourceScopeHash: 'c3842b5c9af2569a0b029c2e7db7156f6bbc4425caef7cb7ea0408686041629c',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'Hay and location are maintained at A1; this A2 lesson cannot be mapped across bands.',
    ],
  },
  {
    pair: 'es-from-en',
    targetLang: 'es',
    slug: 'a2-shopping-prices',
    level: 'A2',
    sourceScopeHash: '371ded2a16c884a87b688c14792c2b32a7d737d1f86aa866e15092037dd73c00',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'The lesson specifies direct lo/la objects, while the catalog leaf includes indirect objects. The shopping situation is maintained at A1.',
    ],
  },
  {
    pair: 'es-from-en',
    targetLang: 'es',
    slug: 'a2-daily-routine-reflexive-verbs',
    level: 'A2',
    sourceScopeHash: 'b14096cf1c1e797bd2116d362cee6ebd79b4759c0ef2a6806657a173b751ac1c',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'Spanish reflexive routine forms have no reviewed matching leaf in this maintained A2 inventory.',
    ],
  },
  {
    pair: 'es-from-en',
    targetLang: 'es',
    slug: 'a2-travel-transport-directions',
    level: 'A2',
    sourceScopeHash: 'f74c0a163a99d5877232a4552aa74e782723fcc686c48374219a4989d94b55bd',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'The directions task is maintained at A1, and ordinary ticket buying does not establish the A2 travel-problem task.',
    ],
  },
  {
    pair: 'es-from-en',
    targetLang: 'es',
    slug: 'a2-preterite-past-events',
    level: 'A2',
    sourceScopeHash: 'e61fb9e34ba42601776fef199eb02fcb3679e5120e45f7ab7896b5af52a4aef9',
    objectives: [],
    catalogVersion: 1,
    unresolvedScopes: [
      'The lesson explicitly limits conjugation to regular preterite verbs; the catalog leaf also requires common irregulars. Recent-experience follow-up scope is not explicit.',
    ],
  },
  {
    pair: 'es-from-en',
    targetLang: 'es',
    slug: 'a2-plans-future-intentions',
    level: 'A2',
    sourceScopeHash: 'a885f368c4d248d991f33561bab08e641e5b10bea4451eab27f270abb039d5f9',
    objectives: [
      {
        objectiveId: 'es.g.ir-a-infinitive',
        criterionVersion: 1,
        criterionMeaningHash: 'b8d4cc5b0e299f4a43c35ce72280a6d28b8f4c9f0dbee46a35907339f6398ec5',
        rationale:
          'The objective and summary explicitly require near-future plans formed with conjugated ir followed by a and an infinitive.',
      },
    ],
    catalogVersion: 1,
    unresolvedScopes: [
      'Intentions with querer and pensar remain outside the reviewed ir-a-infinitive link.',
    ],
  },
];

export function reviewedSeedObjectives(
  targetLang: string,
  slug: string,
  catalog: LearningCatalog,
  source?: SeedLessonReviewScope
): string[] {
  const reviewed = reviewedSeedLessonLinks.find(
    (lesson) => lesson.targetLang === targetLang && lesson.slug === slug
  );
  if (
    !reviewed ||
    catalog.targetLang !== targetLang ||
    catalog.version !== reviewed.catalogVersion ||
    (source !== undefined && reviewedSeedSourceHash(source) !== reviewed.sourceScopeHash)
  )
    return [];
  for (const link of reviewed.objectives) {
    const objective = catalog.nodes.find((node) => node.id === link.objectiveId);
    if (
      objective?.kind !== 'OBJECTIVE' ||
      objective.level !== reviewed.level ||
      !objective.id.startsWith(targetLang + '.') ||
      objective.criterionVersion !== link.criterionVersion ||
      reviewedSeedCriterionHash(objective) !== link.criterionMeaningHash
    )
      return [];
  }
  return reviewed.objectives.map((link) => link.objectiveId);
}
