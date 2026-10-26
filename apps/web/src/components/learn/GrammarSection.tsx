'use client';

import { useEffect, useState } from 'react';
import { parseTextWithCitations } from '@/lib/citation-parser';
import guardStyles from '@/components/ui/LearningTextGuard.module.css';
import { learningTextGuardProps } from '@/components/ui/learningTextGuard';
import type { ReferenceData } from '@/types/reference';
import { ClassGlyph } from './ClassGlyph';
import { ContinueBar, DotRail, MasteryMeter, type DotState } from './ClassWidgets';
import { LearningSelectionMenu } from './LearningSelectionMenu';
import type { ClassFeedbackNote, ClassQuestion } from './classTypes';
import styles from './GrammarSection.module.css';

interface GrammarSectionProps {
  courseId: string;
  sourceId: string;
  skill: 'GRAMMAR' | 'READING';
  questions: ClassQuestion[];
  savedAnswers?: Record<string, number>;
  gate: number;
  nextName: string | null;
  references?: ReferenceData[];
  onAnswer: (questionId: string, selectedIndex: number) => void;
  onScore: (score: number) => void;
  onFeedback?: (note: ClassFeedbackNote) => void;
  feedbackHref?: string;
  onContinue: () => void;
  onCompletionChange?: (complete: boolean, passed: boolean) => void;
  onRetry?: () => void;
  retrying?: boolean;
}

export function GrammarSection({
  courseId,
  sourceId,
  skill,
  questions,
  savedAnswers = {},
  gate,
  nextName,
  references = [],
  onAnswer,
  onScore,
  onFeedback,
  feedbackHref = '#feedback-clinic',
  onContinue,
  onCompletionChange,
  onRetry,
  retrying = false,
}: GrammarSectionProps) {
  const [picked, setPicked] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      questions.flatMap((question) => {
        const selected = savedAnswers[question.id];
        return Number.isInteger(selected) && selected >= 0 && selected < question.options.length
          ? [[question.id, selected]]
          : [];
      })
    )
  );
  const total = questions.length;
  const answered = questions.filter((question) => picked[question.id] !== undefined).length;
  const correctCount = questions.filter(
    (question) =>
      question.correctIndex !== undefined && picked[question.id] === question.correctIndex
  ).length;
  const recall = total > 0 ? (correctCount / total) * 100 : 0;
  const complete = total > 0 && answered === total;
  const passed = complete && correctCount / total >= gate / 100;
  const label = skill === 'GRAMMAR' ? 'Grammar' : 'Reading';
  const firstUnanswered = questions.findIndex((question) => picked[question.id] === undefined);
  const dotStates: DotState[] = questions.map((question, index) => {
    if (picked[question.id] === undefined) return index === firstUnanswered ? 'now' : 'idle';
    return question.correctIndex === undefined || picked[question.id] === question.correctIndex
      ? 'done'
      : 'miss';
  });

  useEffect(() => {
    onScore(recall);
  }, [recall, onScore]);
  useEffect(() => {
    onCompletionChange?.(complete, passed);
  }, [complete, passed, onCompletionChange]);

  function pick(question: ClassQuestion, option: number) {
    if (picked[question.id] !== undefined) return;
    setPicked((previous) => ({ ...previous, [question.id]: option }));
    onAnswer(question.id, option);
    if (question.explanation) {
      const correct = question.correctIndex !== undefined && option === question.correctIndex;
      onFeedback?.({
        id: skill + ':' + question.id,
        skill,
        title: label + (correct ? ': right choice' : ': review this'),
        body: question.explanation,
        returnHref: '#class-active-stage',
        tone: correct ? 'good' : 'review',
      });
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.segEnter}>
        <header>
          <p className={styles.eyebrow}>{label}</p>
          <h1 className={styles.title}>{label} practice</h1>
          <p className={styles.modLede}>
            {skill === 'GRAMMAR'
              ? 'Choose the form that completes each sentence.'
              : 'Read the passage, then answer its questions.'}{' '}
            Work in any order. Each explanation appears after you answer.
          </p>
        </header>
        <MasteryMeter value={recall} gate={gate} label="Recall" />
        <DotRail
          states={dotStates}
          countLabel={answered + '/' + total + ' answered · ' + correctCount + ' correct'}
        />
        <ol className={styles.questionList} aria-label={label + ' exercises'}>
          {questions.map((question, index) => {
            const selected = picked[question.id];
            const correct =
              question.correctIndex !== undefined && selected === question.correctIndex;
            const passage = question.passageText?.trim();
            const previousPassage = questions[index - 1]?.passageText?.trim();
            return (
              <li key={question.id}>
                {passage && passage !== previousPassage && (
                  <LearningSelectionMenu
                    courseId={courseId}
                    sourceType="CLASS"
                    sourceId={sourceId}
                    sourceLabel={label}
                  >
                    <article
                      className={styles.readingPassage + ' ' + guardStyles.guarded}
                      aria-label="Reading passage"
                      {...learningTextGuardProps<HTMLElement>()}
                    >
                      {parseTextWithCitations(passage, references)}
                    </article>
                  </LearningSelectionMenu>
                )}
                <section
                  className={styles.drillCard}
                  id={'question-' + question.id}
                  aria-label={'Question ' + (index + 1)}
                >
                  <div className={styles.drillMeta}>
                    <span className={styles.questionNumber}>
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span>{selected === undefined ? 'Choose an answer' : 'Answered'}</span>
                  </div>
                  {!passage && question.passageRef && (
                    <LearningSelectionMenu
                      courseId={courseId}
                      sourceType="CLASS"
                      sourceId={sourceId}
                      sourceLabel={label}
                    >
                      <blockquote
                        className={styles.passage + ' ' + guardStyles.guarded}
                        {...learningTextGuardProps<HTMLQuoteElement>()}
                      >
                        {question.passageRef}
                      </blockquote>
                    </LearningSelectionMenu>
                  )}
                  <LearningSelectionMenu
                    courseId={courseId}
                    sourceType="CLASS"
                    sourceId={sourceId}
                    sourceLabel={label}
                  >
                    <h2
                      className={styles.drillPrompt + ' ' + guardStyles.guarded}
                      {...learningTextGuardProps<HTMLHeadingElement>()}
                    >
                      {question.question}
                    </h2>
                  </LearningSelectionMenu>
                  <div
                    className={styles.optRow}
                    role="group"
                    aria-label={'Options for: ' + question.question}
                  >
                    {question.options.map((option, optionIndex) => {
                      let optionClass = styles.opt;
                      if (selected !== undefined) {
                        if (question.correctIndex === optionIndex)
                          optionClass += ' ' + styles.optCorrect;
                        else if (selected === optionIndex) optionClass += ' ' + styles.optWrong;
                        else optionClass += ' ' + styles.optDim;
                      }
                      return (
                        <LearningSelectionMenu
                          key={optionIndex}
                          courseId={courseId}
                          sourceType="CLASS"
                          sourceId={sourceId}
                          sourceLabel={label}
                        >
                          <button
                            type="button"
                            className={optionClass + ' ' + guardStyles.guarded}
                            {...learningTextGuardProps<HTMLButtonElement>()}
                            disabled={selected !== undefined}
                            aria-pressed={selected === optionIndex}
                            aria-label={'Option ' + (optionIndex + 1) + ': ' + option}
                            onClick={() => pick(question, optionIndex)}
                          >
                            <span className={styles.optionLetter} aria-hidden="true">
                              {String.fromCharCode(65 + optionIndex)}
                            </span>
                            <span>{option}</span>
                            {selected !== undefined &&
                              (question.correctIndex === optionIndex ||
                                selected === optionIndex) && (
                                <ClassGlyph
                                  name={question.correctIndex === optionIndex ? 'check' : 'x'}
                                  size={16}
                                />
                              )}
                          </button>
                        </LearningSelectionMenu>
                      );
                    })}
                  </div>
                  {selected !== undefined && question.explanation && (
                    <div
                      className={
                        styles.drillWhy + ' ' + (correct ? styles.drillWhyOk : styles.drillWhyNo)
                      }
                    >
                      <p className={styles.whyHead}>
                        {correct
                          ? 'Correct'
                          : question.correctIndex === undefined
                            ? 'Answer saved'
                            : 'Review: ' + question.options[question.correctIndex]}
                      </p>
                      <p>{question.explanation}</p>
                      <a className={styles.feedbackLink} href={feedbackHref}>
                        Go to Feedback Clinic
                      </a>
                    </div>
                  )}
                </section>
              </li>
            );
          })}
        </ol>
        {complete && (
          <section className={styles.result} aria-label={label + ' result'}>
            <h2 className={styles.resultTitle}>
              {passed ? 'Ready to continue' : 'More practice needed'}
            </h2>
            <p>
              {passed
                ? 'You reached the mastery gate. Your answers and explanations stay above.'
                : 'You need ' +
                  gate +
                  '% to continue. Review the explanations, then practise with new questions.'}
            </p>
            {!passed && onRetry && (
              <button
                type="button"
                className={styles.btn + ' ' + styles.btnPrimary}
                onClick={onRetry}
                disabled={retrying}
                aria-busy={retrying}
              >
                {retrying ? 'Preparing new questions...' : 'Practise with new questions'}
                <ClassGlyph name="retry" size={16} />
              </button>
            )}
          </section>
        )}
        <ContinueBar
          passed={passed}
          gate={gate}
          score={recall}
          nextName={nextName}
          onContinue={onContinue}
        />
      </div>
    </div>
  );
}
