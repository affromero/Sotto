'use client';

import { useState } from 'react';
import { ClassGlyph } from './ClassGlyph';
import type { ClassTeaching } from '@sotto/shared';
import { ClassTeachingNotes } from './lesson/ClassTeachingNotes';
import type { ClassPrerequisiteDirections } from './lesson/prerequisiteTypes';
import {
  SKILL_GLYPH,
  skillLabel,
  type ClassIntroData,
  type ClassSection,
  type ClassWritingHistory,
  type ClassSpeakingHistory,
  type ClassHistoricalRecording,
  type ClassQuizHistory,
  type ClassOrphanQuizAnswer,
  type ClassQuizSubmission,
  type ClassQuizReceipt,
} from './classTypes';
import styles from './ClassHub.module.css';

interface ClassHubProps {
  classId: string;
  courseId: string;
  lesson: { title: string; level: string; objective: string };
  intro: ClassIntroData;
  teaching?: ClassTeaching;
  prerequisiteSourceHash?: string | null;
  lessonHelpRevision?: string | null;
  prerequisiteDirections?: ClassPrerequisiteDirections | null;
  onDirectionsChange?: (value: ClassPrerequisiteDirections | null) => void;
  order: number;
  sections: ClassSection[];
  writingHistory?: ClassWritingHistory[];
  speakingHistory?: ClassSpeakingHistory[];
  speakingHistoryUnlinked?: ClassHistoricalRecording[];
  orphanWritingDrafts?: Array<{ id: string; text: string }>;
  quizHistory?: ClassQuizHistory[];
  orphanQuizAnswers?: ClassOrphanQuizAnswer[];
  quizHistoryUnreadable?: boolean;
  quizSubmissionReceipts?: ClassQuizReceipt[];
  /** committed 0..100 score per section id */
  scores: Record<string, number>;
  started: boolean;
  regenerating?: boolean;
  onBegin: () => void;
  onRegenerate: () => void;
}

export function ClassHub({
  classId,
  courseId,
  lesson,
  intro,
  teaching,
  prerequisiteSourceHash,
  lessonHelpRevision,
  prerequisiteDirections,
  onDirectionsChange,
  order,
  sections,
  writingHistory,
  speakingHistory,
  speakingHistoryUnlinked,
  orphanWritingDrafts,
  quizHistory,
  orphanQuizAnswers,
  quizHistoryUnreadable,
  quizSubmissionReceipts,
  scores,
  started,
  regenerating = false,
  onBegin,
  onRegenerate,
}: ClassHubProps) {
  const doneCount = sections.filter(
    (section) => (scores[section.id] ?? section.score ?? 0) > 0
  ).length;
  const totalActivities = sections.length;

  return (
    <article className={styles.root}>
      <div className={styles.segEnter}>
        <header>
          <p className={styles.eyebrow}>
            Class {order} · {lesson.level}
          </p>
          <h1 className={styles.title}>{lesson.title}</h1>
          <p className={styles.readingGuide}>Study the explanation and examples, then practise.</p>
        </header>

        <ClassTeachingNotes
          classId={classId}
          courseId={courseId}
          intro={intro}
          teaching={teaching}
          prerequisiteSourceHash={prerequisiteSourceHash}
          lessonHelpRevision={lessonHelpRevision}
          prerequisiteDirections={prerequisiteDirections}
          onDirectionsChange={onDirectionsChange}
        />

        <section className={styles.practiceSection} aria-labelledby="class-activities">
          <h2 id="class-activities" className={styles.practiceTitle}>
            Practice this class
          </h2>
          <p className={styles.practiceGuide}>Work through the activities in order.</p>
          <div className={styles.startRow}>
            <button type="button" className={styles.beginButton} onClick={onBegin}>
              {started ? 'Resume the class' : 'Begin the class'}
              <ClassGlyph name="arrow" size={17} />
            </button>
            <div className={styles.activityProgress}>
              <label htmlFor="class-progress">
                {doneCount} of {totalActivities} activities
              </label>
              <progress
                id="class-progress"
                value={doneCount}
                max={Math.max(totalActivities, 1)}
                aria-label="Class activity progress"
              />
            </div>
          </div>

          <ol className={styles.activityList} aria-label="Class activities">
            {sections.map((section) => {
              const score =
                scores[section.id] ?? (section.score == null ? null : section.score * 100);
              const itemCount =
                section.questions.length || section.prompts.length || section.writingPrompts.length;
              return (
                <li className={styles.activity} key={section.id}>
                  <span className={styles.activityIcon}>
                    <ClassGlyph name={SKILL_GLYPH[section.skill] ?? 'gate'} size={19} />
                  </span>
                  <div className={styles.activityName}>
                    <span>{skillLabel(section.skill)}</span>
                    <span className={styles.activityCount}>{itemCount} exercises</span>
                  </div>
                  {score !== null && score !== undefined && (
                    <span className={score ? styles.activityScored : styles.activityScore}>
                      {Math.round(score * 10) / 10}%
                    </span>
                  )}
                </li>
              );
            })}
          </ol>

          <div className={styles.classTools}>
            <a className={styles.toolButton} href={`/classes/${classId}/worksheet`}>
              <ClassGlyph name="pen" size={17} /> Export / print
            </a>
            <button
              type="button"
              className={styles.toolButton}
              onClick={onRegenerate}
              disabled={regenerating}
              aria-busy={regenerating}
            >
              <ClassGlyph name="spark" size={17} />
              {regenerating ? 'Regenerating...' : 'Regenerate class'}
            </button>
          </div>
          {((speakingHistory?.length ?? 0) > 0 || (speakingHistoryUnlinked?.length ?? 0) > 0) && (
            <details className={styles.writingHistory}>
              <summary>Previous speaking work</summary>
              {speakingHistory?.map((section) => (
                <div key={section.sectionId}>
                  <h3>Attempt {section.attempt}</h3>
                  {section.prompts.map((prompt) => (
                    <div key={prompt.id}>
                      <p>{prompt.targetPhrase}</p>
                      <p>{prompt.translation}</p>
                      {prompt.recordings.map((recording) => (
                        <div key={recording.id}>
                          <p>Recording: {recording.status}</p>
                          <SavedSpeakingAudio
                            key={`${classId}:${prompt.id}:${recording.id}`}
                            classId={classId}
                            promptId={prompt.id}
                            recordingId={recording.id}
                          />
                          {!recording.attemptMatches && (
                            <p>Saved with a different attempt number.</p>
                          )}
                          {recording.transcript !== null && (
                            <p>Transcript: {recording.transcript}</p>
                          )}
                          {recording.overallScore !== null && (
                            <p>{scoreLabel(recording.overallScore)}</p>
                          )}
                          {recording.feedback !== null && <p>Feedback: {recording.feedback}</p>}
                          <SpeakingHistoryDetails recording={recording} />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
              {speakingHistoryUnlinked?.map((recording) => (
                <div key={recording.id}>
                  <h3>Recording without its original task</h3>
                  <p>Recording: {recording.status}</p>
                  {recording.transcript !== null && <p>Transcript: {recording.transcript}</p>}
                  {recording.overallScore !== null && <p>{scoreLabel(recording.overallScore)}</p>}
                  {recording.feedback !== null && <p>Feedback: {recording.feedback}</p>}
                  <SpeakingHistoryDetails recording={recording} />
                </div>
              ))}
            </details>
          )}
          {((writingHistory?.length ?? 0) > 0 || (orphanWritingDrafts?.length ?? 0) > 0) && (
            <details className={styles.writingHistory}>
              <summary>Previous writing</summary>
              {writingHistory?.map((section) => (
                <section key={section.sectionId}>
                  <h3>Attempt {section.attempt}</h3>
                  {section.prompts.map((prompt) => (
                    <div key={prompt.id} className={styles.historyPrompt}>
                      <h4>{prompt.task}</h4>
                      {prompt.savedDraft !== null && (
                        <>
                          <strong>Saved draft</strong>
                          <p>{prompt.savedDraft || '(Empty draft)'}</p>
                        </>
                      )}
                      {prompt.responses.map((response) => (
                        <div key={response.id} className={styles.historyResponse}>
                          <strong>
                            {response.overallScore === null
                              ? 'Submitted response'
                              : 'Graded response'}
                          </strong>
                          <p>{response.text}</p>
                          {!response.attemptMatches && (
                            <p>Saved with a different attempt number.</p>
                          )}
                          {response.overallScore !== null && (
                            <p>Score: {Math.round(response.overallScore * 100)}%</p>
                          )}
                          {response.feedback && <p>{response.feedback}</p>}
                          {Array.isArray(response.corrections) &&
                            response.corrections.map((correction, index) => {
                              if (
                                !correction ||
                                typeof correction !== 'object' ||
                                typeof correction.old !== 'string' ||
                                typeof correction.new !== 'string' ||
                                typeof correction.why !== 'string'
                              )
                                return null;
                              return (
                                <p key={index}>
                                  {correction.old} → {correction.new}: {correction.why}
                                </p>
                              );
                            })}
                        </div>
                      ))}
                    </div>
                  ))}
                </section>
              ))}
              {orphanWritingDrafts?.map((draft) => (
                <div key={draft.id} className={styles.historyPrompt}>
                  <strong>Saved draft without its original task</strong>
                  <p>{draft.text || '(Empty draft)'}</p>
                </div>
              ))}
            </details>
          )}
          {((quizHistory?.length ?? 0) > 0 ||
            (orphanQuizAnswers?.length ?? 0) > 0 ||
            (quizSubmissionReceipts?.length ?? 0) > 0 ||
            quizHistoryUnreadable) && (
            <details className={styles.writingHistory}>
              <summary>Previous quiz work</summary>
              <p>
                Tasks and choices are the currently saved versions. Earlier wording may have
                changed.
              </p>
              {quizSubmissionReceipts?.map((receipt, index) => (
                <div key={index} className={styles.historyPrompt}>
                  <strong>
                    Saved submission
                    {receipt.attempt === null ? '' : ` · Attempt ${receipt.attempt}`}
                  </strong>
                  {receipt.submittedAt && <p>Submitted at: {receipt.submittedAt}</p>}
                  <p>
                    {receipt.passed === null
                      ? 'Outcome unavailable'
                      : receipt.passed
                        ? 'Passed'
                        : 'Not passed'}
                  </p>
                  <p>{scoreLabel(receipt.overallScore)}</p>
                  {(receipt.passedSections !== null || receipt.totalSections !== null) && (
                    <p>
                      Recorded: {receipt.passedSections ?? '?'} of {receipt.totalSections ?? '?'}{' '}
                      skills passed
                    </p>
                  )}
                  {receipt.sections.map((section, sectionIndex) => (
                    <p key={sectionIndex}>
                      {section.skill === null ? 'Skill unavailable' : skillLabel(section.skill)} ·{' '}
                      {scoreLabel(section.score)} ·{' '}
                      {section.passed === null
                        ? 'Outcome unavailable'
                        : section.passed
                          ? 'Passed'
                          : 'Not passed'}
                    </p>
                  ))}
                  {receipt.summaryIncomplete && <p>Some result details are unavailable.</p>}
                  {receipt.answersUnavailable && <p>Some individual answers are unavailable.</p>}
                </div>
              ))}
              {quizHistory?.map((section) => (
                <section key={section.sectionId}>
                  <h3>
                    {skillLabel(section.skill)} · Attempt {section.attempt}
                  </h3>
                  {section.questions.map((question) => (
                    <div key={question.id} className={styles.historyPrompt}>
                      {question.passageText && <p>{question.passageText}</p>}
                      <h4>{question.question}</h4>
                      {question.savedChoice !== null && (
                        <p>Saved choice: {choiceLabel(question.options, question.savedChoice)}</p>
                      )}
                      {question.submissions.map((event, index) => (
                        <QuizSubmission key={index} event={event} options={question.options} />
                      ))}
                    </div>
                  ))}
                </section>
              ))}
              {orphanQuizAnswers?.map((answer, index) => (
                <div key={index} className={styles.historyPrompt}>
                  <strong>Answer without its original task</strong>
                  {answer.savedChoice !== null && (
                    <p>Saved choice: {choiceLabel(null, answer.savedChoice)}</p>
                  )}
                  {answer.submissions.map((event, eventIndex) => (
                    <QuizSubmission key={eventIndex} event={event} options={null} />
                  ))}
                </div>
              ))}
              {quizHistoryUnreadable && <p>Some previous quiz records could not be displayed.</p>}
            </details>
          )}
        </section>
      </div>
    </article>
  );
}

function choiceLabel(options: string[] | null, selectedIndex: number | null) {
  if (selectedIndex === null) return 'Choice unavailable';
  if (options && selectedIndex >= 0 && selectedIndex < options.length)
    return `${selectedIndex + 1}. ${options[selectedIndex]}`;
  return `Choice index ${selectedIndex} (text unavailable)`;
}

function SavedSpeakingAudio({
  classId,
  promptId,
  recordingId,
}: {
  classId: string;
  promptId: string;
  recordingId: string;
}) {
  const [unavailable, setUnavailable] = useState(false);
  return (
    <>
      <audio
        controls
        preload="none"
        aria-label="Play saved recording"
        src={`/api/v1/classes/${encodeURIComponent(classId)}/speaking/${encodeURIComponent(promptId)}/recordings/${encodeURIComponent(recordingId)}/audio`}
        onError={() => setUnavailable(true)}
        onCanPlay={() => setUnavailable(false)}
      >
        Your browser cannot play this recording.
      </audio>
      {unavailable && <p>Recording unavailable. Your saved feedback is still shown below.</p>}
    </>
  );
}

function SpeakingHistoryDetails({ recording }: { recording: ClassHistoricalRecording }) {
  const scores = recording.rubricScores;
  const entries =
    scores && typeof scores === 'object' && !Array.isArray(scores) ? Object.entries(scores) : [];
  const validScores = entries.filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])
  );
  const tokens = Array.isArray(recording.phonemeScores) ? recording.phonemeScores : [];
  const validTokens = tokens.filter(
    (token): token is { op: string; expected?: string | null; actual?: string | null } =>
      token !== null &&
      typeof token === 'object' &&
      typeof token.op === 'string' &&
      (token.expected == null || typeof token.expected === 'string') &&
      (token.actual == null || typeof token.actual === 'string')
  );
  const malformed =
    (scores !== null &&
      (typeof scores !== 'object' ||
        Array.isArray(scores) ||
        validScores.length !== entries.length)) ||
    (recording.phonemeScores !== null &&
      (!Array.isArray(recording.phonemeScores) || validTokens.length !== tokens.length));
  return (
    <>
      {validScores.map(([name, value]) => (
        <p key={name}>
          {name}: {scoreLabel(value).replace(/^Score: /, '')}
        </p>
      ))}
      {validTokens.map((token, index) => (
        <p key={index}>
          {token.op}: {token.expected ?? 'unavailable'} → {token.actual ?? 'unavailable'}
        </p>
      ))}
      {malformed && <p>Some speaking feedback could not be displayed.</p>}
    </>
  );
}

function scoreLabel(score: number | null) {
  if (score === null) return 'Score unavailable';
  if (score < 0 || score > 1) return `Recorded score: ${score} (outside expected range)`;
  return `Score: ${Math.round(score * 100)}%`;
}

function QuizSubmission({
  event,
  options,
}: {
  event: ClassQuizSubmission;
  options: string[] | null;
}) {
  return (
    <div className={styles.historyResponse}>
      <strong>Submitted{event.attempt === null ? '' : ` · Attempt ${event.attempt}`}</strong>
      {event.submittedAt && <p>Submitted at: {event.submittedAt}</p>}
      <p>
        {choiceLabel(options, event.selectedIndex)} ·{' '}
        {event.isCorrect === null
          ? 'Outcome unavailable'
          : event.isCorrect
            ? 'Correct'
            : 'Incorrect'}
      </p>
    </div>
  );
}
