import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classTeachingSchema, type ClassLessonHelpResponse } from '@sotto/shared';
import { ClassTeachingNotes } from '@/components/learn/lesson/ClassTeachingNotes';
import { ClassLanguageHelp } from '@/components/learn/lesson/ClassLanguageHelp';
import { teaching } from './teaching-fixture';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const lesson = {
  ...teaching,
  title: 'Erzähle von gestern',
  explanation: 'Beschreibe den abgeschlossenen Besuch mit dem Perfekt.',
  guidedPractice: {
    ...teaching.guidedPractice,
    answer: 'Concealed guided answer.',
    explanation: 'Concealed guided explanation.',
  },
};
const help = {
  title: 'Talk about yesterday',
  explanation: 'Describe the completed visit using the perfect tense.',
  workedExamples: lesson.workedExamples.map((example) => ({
    prompt: example.prompt,
    meaning: 'A completed visit or journey.',
    explanation: example.explanation,
  })),
  correctionExplanation: 'Use sein for this journey.',
  guidedPrompt: 'Describe your visit.',
  guidedHint: 'Choose the auxiliary first.',
};
let response: ClassLessonHelpResponse;
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');

function showClass() {
  return render(
    <ClassTeachingNotes
      classId="native-help-class"
      courseId="course"
      teaching={lesson}
      intro={{
        purpose: 'Erzähle von gestern.',
        about: 'Ein Besuch.',
        focus: [],
        examples: [],
        tips: [],
      }}
    />
  );
}

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
  const hash = await webcrypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(classTeachingSchema.parse(lesson)))
  );
  response = {
    status: 'AVAILABLE',
    nativeLang: 'en',
    targetLang: 'de',
    canRetry: false,
    request: {
      operationId: '00000000-0000-4000-a000-000000000001',
      attempt: 1,
      sourceHash: Buffer.from(hash).toString('hex'),
      retryOf: null,
    },
  };
});
afterEach(() => {
  if (originalShowModal)
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('optional lesson language help', () => {
  it('keeps the reported beginner request explanation concealed while help is opened and reopened', async () => {
    // The teaching is synthetic; the Spanish help preserves the reported excerpts.
    const savedLesson = {
      ...lesson,
      title: 'Primeras palabras en ruso',
      explanation: 'Saluda e identifica a una persona.',
      workedExamples: [
        {
          prompt: 'Saluda a un amigo.',
          answer: 'Привет!',
          explanation: '«Привет» significa «hola».',
        },
        {
          prompt: 'Da las gracias por el té.',
          answer: 'Спасибо за чай. Пожалуйста.',
          explanation: 'Aquí «Пожалуйста» significa «de nada».',
        },
      ],
      commonMistake: {
        incorrect: 'Привед!',
        correction: 'Привет!',
        explanation: '«Привет» se escribe con «т» al final.',
      },
      guidedPractice: {
        prompt: 'Попросите чай в кафе.',
        hint: 'Добавьте вежливую формулу.',
        answer: 'Чай, пожалуйста.',
        explanation: 'Al pedir, «пожалуйста» significa «por favor».',
      },
    };
    const translated = {
      ...help,
      title: savedLesson.title,
      explanation: 'Saluda e identifica a una persona.',
      workedExamples: savedLesson.workedExamples.map((example) => ({
        prompt: example.prompt,
        meaning: example.answer === 'Привет!' ? '¡Hola!' : 'Gracias por el té. De nada.',
        explanation: example.explanation,
      })),
      correctionExplanation: savedLesson.commonMistake.explanation,
      guidedPrompt: 'Estás en una cafetería. En el menú pone «чай». Pide esta bebida con cortesía.',
      guidedHint:
        'Lee el nombre de la bebida. Añade la fórmula de cortesía que acompaña una petición.',
    };
    const hash = await webcrypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(classTeachingSchema.parse(savedLesson)))
    );
    vi.stubGlobal('fetch', async () =>
      Response.json({
        ...response,
        status: 'READY',
        nativeLang: 'es',
        targetLang: 'ru',
        help: translated,
        request: { ...response.request, sourceHash: Buffer.from(hash).toString('hex') },
      })
    );
    render(
      <ClassTeachingNotes
        classId="beginner-class"
        courseId="course"
        teaching={savedLesson}
        intro={{
          purpose: 'Saludar.',
          about: 'Primeras palabras.',
          focus: [],
          examples: [],
          tips: [],
        }}
      />
    );
    const worked = screen.getByRole('region', { name: 'Worked examples' });
    const guided = screen.getByRole('region', { name: 'Try it first' });
    expect(worked.compareDocumentPosition(guided) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(worked).getByText('Aquí «Пожалуйста» significa «de nada».')).toBeVisible();
    expect(within(guided).getByText(savedLesson.guidedPractice.explanation)).not.toBeVisible();
    for (let index = 0; index < 2; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Help in your language' }));
      const dialog = await screen.findByRole('dialog', { name: savedLesson.title });
      expect(await within(dialog).findByText(translated.guidedPrompt)).toBeVisible();
      expect(within(dialog).queryByText(savedLesson.guidedPractice.answer)).not.toBeInTheDocument();
      expect(
        within(dialog).queryByText(savedLesson.guidedPractice.explanation)
      ).not.toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Back to lesson' }));
      expect(within(guided).getByText(savedLesson.guidedPractice.explanation)).not.toBeVisible();
    }
    fireEvent.click(within(guided).getByText('Show the worked answer'));
    expect(within(guided).getByText(savedLesson.guidedPractice.explanation)).toBeVisible();
  });

  it('keeps the original lesson primary and shows native meanings beside unchanged target sentences', async () => {
    const requests: unknown[] = [];
    let prepared = false;
    vi.stubGlobal('fetch', async (_url: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method === 'POST') {
        requests.push(JSON.parse(String(options.body)));
        prepared = true;
        return Response.json({ status: 'PENDING' }, { status: 202 });
      }
      return Response.json(prepared ? { ...response, status: 'READY', help } : response);
    });
    showClass();
    const original = screen.getByText(lesson.explanation);
    expect(original).toBeVisible();
    expect(screen.queryByText(help.explanation)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Help in your language' }));
    const dialog = await screen.findByRole('dialog', { name: lesson.title });
    expect(await within(dialog).findByText(help.explanation)).toBeVisible();
    expect(within(dialog).getByText(lesson.workedExamples[0].answer)).toHaveAttribute('lang', 'de');
    expect(within(dialog).getAllByText('A completed visit or journey.')).toHaveLength(2);
    expect(within(dialog).queryByText(lesson.guidedPractice.answer)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(lesson.guidedPractice.explanation)).not.toBeInTheDocument();
    expect(requests).toEqual([response.request]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to lesson' }));
    expect(original).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('refuses help for a changed lesson instead of displaying it beside stale teaching', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({
        ...response,
        status: 'READY',
        help,
        request: { ...response.request, sourceHash: 'b'.repeat(64) },
      })
    );
    showClass();
    fireEvent.click(screen.getByRole('button', { name: 'Help in your language' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/lesson changed/i);
    expect(screen.queryByText(help.explanation)).not.toBeInTheDocument();
  });

  it('discards completed help synchronously when the lesson gains another example', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ ...response, status: 'READY', help }));
    const view = render(<ClassLanguageHelp classId="class" teaching={lesson} />);
    fireEvent.click(screen.getByRole('button', { name: 'Help in your language' }));
    expect(await screen.findByText(help.explanation)).toBeVisible();
    view.rerender(
      <ClassLanguageHelp
        classId="class"
        teaching={{
          ...lesson,
          title: 'Eine neue Lektion',
          workedExamples: [...lesson.workedExamples, lesson.workedExamples[0]],
        }}
      />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(help.explanation)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help in your language' })).toBeVisible();
  });

  it('discards a late private response after the reading pane closes', async () => {
    const deferred = Promise.withResolvers<Response>();
    vi.stubGlobal('fetch', () => deferred.promise);
    showClass();
    fireEvent.click(screen.getByRole('button', { name: 'Help in your language' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to lesson' }));
    await act(async () => {
      deferred.resolve(Response.json({ ...response, status: 'READY', help }));
    });
    expect(screen.queryByText(help.explanation)).not.toBeInTheDocument();
    expect(screen.getByText(lesson.explanation)).toBeVisible();
  });

  it('exposes an uncertain outcome without submitting another provider request', async () => {
    const methods: string[] = [];
    vi.stubGlobal('fetch', async (_url: RequestInfo | URL, options?: RequestInit) => {
      methods.push(options?.method ?? 'GET');
      return Response.json({
        ...response,
        status: 'FAILED',
        error: 'The previous request has an unconfirmed outcome.',
      });
    });
    showClass();
    fireEvent.click(screen.getByRole('button', { name: 'Help in your language' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('unconfirmed');
    expect(screen.getByRole('button', { name: 'Check saved status' })).toBeEnabled();
    expect(methods).toEqual(['GET']);
  });
});
