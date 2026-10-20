import type { PlayChoice, PlayTheme } from '@sotto/shared';
import { PlayRuleError } from './errors';

type Labels = readonly [string, string, string, string];
type ChoiceDeck = Record<PlayTheme, Labels>;

const labels = new Map<string, ChoiceDeck>([
  [
    'en',
    {
      EVERYDAY: ['Go for a walk', 'Cook something', 'Read a book', 'Have a rest'],
      FOOD: ['Pizza', 'Soup', 'Salad', 'Pasta'],
      TRAVEL: ['By train', 'By boat', 'By bicycle', 'On foot'],
      SILLY: ['Flying', 'Invisibility', 'Talking to animals', 'Time travel'],
      GET_TO_KNOW_YOU: ['Painting', 'Dancing', 'Gardening', 'Cooking'],
      AFFECTIONATE: ['A picnic', 'Dinner together', 'A long walk', 'A film at home'],
    },
  ],
  [
    'de',
    {
      EVERYDAY: ['Spazieren gehen', 'Etwas kochen', 'Ein Buch lesen', 'Sich ausruhen'],
      FOOD: ['Pizza', 'Suppe', 'Salat', 'Nudeln'],
      TRAVEL: ['Mit dem Zug', 'Mit dem Boot', 'Mit dem Fahrrad', 'Zu Fuß'],
      SILLY: ['Fliegen', 'Unsichtbarkeit', 'Mit Tieren sprechen', 'Zeitreisen'],
      GET_TO_KNOW_YOU: ['Malen', 'Tanzen', 'Gärtnern', 'Kochen'],
      AFFECTIONATE: [
        'Ein Picknick',
        'Zusammen essen',
        'Ein langer Spaziergang',
        'Ein Film zu Hause',
      ],
    },
  ],
  [
    'es',
    {
      EVERYDAY: ['Dar un paseo', 'Cocinar algo', 'Leer un libro', 'Descansar'],
      FOOD: ['Pizza', 'Sopa', 'Ensalada', 'Pasta'],
      TRAVEL: ['En tren', 'En barco', 'En bicicleta', 'A pie'],
      SILLY: ['Volar', 'Invisibilidad', 'Hablar con animales', 'Viajar en el tiempo'],
      GET_TO_KNOW_YOU: ['Pintar', 'Bailar', 'Cuidar un jardín', 'Cocinar'],
      AFFECTIONATE: ['Un pícnic', 'Cenar juntos', 'Un paseo largo', 'Una película en casa'],
    },
  ],
  [
    'fr',
    {
      EVERYDAY: ['Se promener', 'Cuisiner quelque chose', 'Lire un livre', 'Se reposer'],
      FOOD: ['Pizza', 'Soupe', 'Salade', 'Pâtes'],
      TRAVEL: ['En train', 'En bateau', 'À vélo', 'À pied'],
      SILLY: ['Voler', 'Invisibilité', 'Parler aux animaux', 'Voyager dans le temps'],
      GET_TO_KNOW_YOU: ['Peindre', 'Danser', 'Jardiner', 'Cuisiner'],
      AFFECTIONATE: [
        'Un pique-nique',
        'Dîner ensemble',
        'Une longue promenade',
        'Un film à la maison',
      ],
    },
  ],
  [
    'pt',
    {
      EVERYDAY: ['Dar um passeio', 'Cozinhar algo', 'Ler um livro', 'Descansar'],
      FOOD: ['Pizza', 'Sopa', 'Salada', 'Massa'],
      TRAVEL: ['De trem', 'De barco', 'De bicicleta', 'A pé'],
      SILLY: ['Voar', 'Invisibilidade', 'Falar com animais', 'Viajar no tempo'],
      GET_TO_KNOW_YOU: ['Pintar', 'Dançar', 'Cuidar de um jardim', 'Cozinhar'],
      AFFECTIONATE: ['Um piquenique', 'Jantar juntos', 'Um passeio longo', 'Um filme em casa'],
    },
  ],
  [
    'it',
    {
      EVERYDAY: ['Fare una passeggiata', 'Cucinare qualcosa', 'Leggere un libro', 'Riposarsi'],
      FOOD: ['Pizza', 'Zuppa', 'Insalata', 'Pasta'],
      TRAVEL: ['In treno', 'In barca', 'In bicicletta', 'A piedi'],
      SILLY: ['Volare', 'Invisibilità', 'Parlare con gli animali', 'Viaggiare nel tempo'],
      GET_TO_KNOW_YOU: ['Dipingere', 'Ballare', 'Fare giardinaggio', 'Cucinare'],
      AFFECTIONATE: ['Un picnic', 'Cenare insieme', 'Una lunga passeggiata', 'Un film a casa'],
    },
  ],
  [
    'ja',
    {
      EVERYDAY: ['散歩する', '何か料理する', '本を読む', '休む'],
      FOOD: ['ピザ', 'スープ', 'サラダ', 'パスタ'],
      TRAVEL: ['電車で', '船で', '自転車で', '歩いて'],
      SILLY: ['空を飛ぶ', '透明になる', '動物と話す', '時間旅行をする'],
      GET_TO_KNOW_YOU: ['絵を描く', '踊る', '園芸をする', '料理する'],
      AFFECTIONATE: ['ピクニック', '一緒に夕食を食べる', '長い散歩', '家で映画を見る'],
    },
  ],
  [
    'zh',
    {
      EVERYDAY: ['散步', '做点吃的', '看书', '休息'],
      FOOD: ['比萨', '汤', '沙拉', '意大利面'],
      TRAVEL: ['坐火车', '坐船', '骑自行车', '步行'],
      SILLY: ['飞行', '隐身', '和动物说话', '穿越时空'],
      GET_TO_KNOW_YOU: ['画画', '跳舞', '园艺', '烹饪'],
      AFFECTIONATE: ['野餐', '一起吃晚饭', '长时间散步', '在家看电影'],
    },
  ],
  [
    'ko',
    {
      EVERYDAY: ['산책하기', '요리하기', '책 읽기', '쉬기'],
      FOOD: ['피자', '수프', '샐러드', '파스타'],
      TRAVEL: ['기차로', '배로', '자전거로', '걸어서'],
      SILLY: ['하늘 날기', '투명 인간 되기', '동물과 대화하기', '시간 여행하기'],
      GET_TO_KNOW_YOU: ['그림 그리기', '춤추기', '정원 가꾸기', '요리하기'],
      AFFECTIONATE: ['소풍', '함께 저녁 먹기', '긴 산책', '집에서 영화 보기'],
    },
  ],
]);

const symbols: Record<PlayTheme, Labels> = {
  EVERYDAY: ['🚶', '🍳', '📖', '🛋️'],
  FOOD: ['🍕', '🍲', '🥗', '🍝'],
  TRAVEL: ['🚆', '⛵', '🚲', '🚶'],
  SILLY: ['🪽', '🫥', '🐦', '⏳'],
  GET_TO_KNOW_YOU: ['🎨', '💃', '🌱', '🍳'],
  AFFECTIONATE: ['🧺', '🍽️', '🚶', '🎬'],
};

export function playChoices(
  theme: PlayTheme,
  targetLang: string,
  nativeLang: string
): PlayChoice[] {
  const target = labels.get(targetLang);
  if (!target)
    throw new PlayRuleError(
      'invalid',
      'Choice cards are unavailable for this language. Choose open questions explicitly.'
    );
  const support = labels.get(nativeLang);
  return (['A', 'B', 'C', 'D'] as const).map((id, index) => ({
    id,
    text: target[theme][index],
    supportText: support?.[theme][index] ?? null,
    symbol: symbols[theme][index],
  }));
}

const choicePrompts: Record<PlayTheme, readonly [string, string]> = {
  EVERYDAY: [
    'You have an unexpected free hour. What would you pick?',
    'It is raining all afternoon. What would you pick?',
  ],
  FOOD: [
    'After a long day, which would you order?',
    'You are cooking together. What would you pick?',
  ],
  TRAVEL: [
    'You have a free day in a new place. How would you get around?',
    'You need to reach the next town. How would you travel?',
  ],
  SILLY: [
    'You can borrow one superpower for a day. Which one?',
    'You need to escape an awkward dinner. Which power would you use?',
  ],
  GET_TO_KNOW_YOU: [
    'You can try a free class. Which one would you choose?',
    'You want a new weekend hobby. Which would you pick?',
  ],
  AFFECTIONATE: [
    'You have an afternoon together. Which plan would you choose?',
    'You want to surprise your partner. Which plan would you choose?',
  ],
};

export function playChoicePrompt(theme: PlayTheme, variation: number): string {
  return choicePrompts[theme][variation % 2 === 0 ? 0 : 1];
}
