/// Collect the MC answers recorded across all class sections so far, ready for
/// the class submit. Only answered MC/listening-comprehension questions are
/// included (speaking/writing are graded via their own endpoints; the class
/// submit grades MC and aggregates the rest server-side). Pure.
pub(crate) fn collect_class_answers(
    sections: &[ClassSection],
) -> Vec<types::SubmitClassRequestAnswersItem> {
    let mut answers = Vec::new();
    for section in sections {
        let (questions, selected) = match &section.progress {
            SectionProgress::Mc {
                questions,
                selected,
                ..
            }
            | SectionProgress::Listening {
                questions,
                selected,
                ..
            } => (questions, selected),
            _ => continue,
        };
        for (q, choice) in questions.iter().zip(selected.iter()) {
            if let Some(idx) = choice {
                answers.push(types::SubmitClassRequestAnswersItem {
                    question_id: q.id.clone(),
                    selected_index: *idx as i64,
                });
            }
        }
    }
    answers
}

/// Collect the MC answers recorded across all EXAM sections, for the exam
/// submit. Like [`collect_class_answers`], but the exam item carries a validated
/// `question_id` newtype, so an answered question whose id the contract rejects
/// returns `Err` rather than being silently dropped (a partial payload would
/// misgrade the exam). Skipped (unanswered) questions are legitimately omitted.
pub(crate) fn collect_exam_answers(
    sections: &[ClassSection],
) -> Result<Vec<types::SubmitExamRequestAnswersItem>, String> {
    let mut answers = Vec::new();
    for section in sections {
        let (questions, selected) = match &section.progress {
            SectionProgress::Mc {
                questions,
                selected,
                ..
            }
            | SectionProgress::Listening {
                questions,
                selected,
                ..
            } => (questions, selected),
            _ => continue,
        };
        for (q, choice) in questions.iter().zip(selected.iter()) {
            if let Some(idx) = choice {
                let question_id =
                    types::SubmitExamRequestAnswersItemQuestionId::try_from(q.id.clone())
                        .map_err(|e| format!("invalid question id {:?}: {e}", q.id))?;
                answers.push(types::SubmitExamRequestAnswersItem {
                    question_id,
                    selected_index: *idx as i64,
                });
            }
        }
    }
    Ok(answers)
}

/// Whether every section of the class has been worked through to a submittable
/// state: MC/listening have an answer for every question, speaking has graded
/// (or failed) every prompt, writing has graded (or failed) every prompt. Pure;
/// drives whether the class can be submitted. Reused for exams.
pub(crate) fn class_ready_to_submit(sections: &[ClassSection]) -> bool {
    sections.iter().all(section_complete)
}

fn section_complete(section: &ClassSection) -> bool {
    match &section.progress {
        SectionProgress::Mc { selected, .. } | SectionProgress::Listening { selected, .. } => {
            selected.iter().all(Option::is_some)
        }
        // Speaking/writing are submittable only once their phase is terminal
        // (Graded or Failed). In-flight phases (Idle/Recording/Uploading/
        // Polling/Submitting/Editing) are NOT ready, so the class/exam can't be
        // submitted while a prompt is still being worked on.
        SectionProgress::Speaking { phase, .. } => {
            matches!(
                phase,
                SpeakingPhase::Graded { .. } | SpeakingPhase::Failed { .. }
            )
        }
        SectionProgress::Writing { phase, .. } => {
            matches!(
                phase,
                WritingPhase::Graded { .. } | WritingPhase::Failed { .. }
            )
        }
    }
}

/// Reduce a start-practice response against the current `CourseHome` view.
///
/// Routing is kind-aware so each skill enters its own screen:
/// - `ready` `VOCAB`/`GRAMMAR`/`READING` with well-formed items → `ItemReview`
///   (one shared multiple-choice screen; the kind only changes the title).
/// - `ready` `LISTENING` with an `episodeId` → `ListeningReview` (items, if any,
///   must each have options; a zero-option item is `Malformed`).
/// - `ready_speaking` → `SpeakingReview` (must carry at least one prompt).
/// - `ready` `WRITING` → a "not available in the terminal yet" notice (P6b).
/// - `ready` that is empty/malformed for its skill → a `Malformed` notice; we
///   never enter a review we cannot present honestly.
/// - `unavailable` → the server's reason as a notice.
/// - `ready_writing` / `ready_full` → a not-in-terminal notice.
///
/// In every non-review case the learner stays on `CourseHome` (the start
/// in-flight flag is cleared). If `view` is not a `CourseHome`, it is returned
/// unchanged (the learner navigated away before the response arrived).
pub(crate) fn reduce_start(view: View, resp: &types::StartPracticeResponse) -> View {
    let View::CourseHome { course, due, .. } = view else {
        return view;
    };

    match resp {
        types::StartPracticeResponse::Ready(ready) => match ReviewKind::from_kind(ready.kind) {
            // VOCAB / GRAMMAR / READING share the multiple-choice review screen.
            Some(review_kind) => match validate_choice_items(&ready.items) {
                Some(items) => {
                    View::start_items(course, review_kind, ready.session_id.clone(), items)
                }
                None => course_home_notice(course, due, Unavailable::Malformed),
            },
            None => match ready.kind {
                types::PracticeKind::Listening => reduce_listening(course, due, ready),
                other => {
                    course_home_notice(course, due, Unavailable::NotInTerminal(skill_name(other)))
                }
            },
        },
        types::StartPracticeResponse::ReadySpeaking(ready) => {
            if ready.prompts.is_empty() {
                course_home_notice(course, due, Unavailable::Malformed)
            } else {
                let prompts = ready.prompts.iter().map(SpeakingPrompt::from).collect();
                View::start_speaking(course, ready.session_id.clone(), prompts)
            }
        }
        types::StartPracticeResponse::Unavailable(unavailable) => {
            course_home_notice(course, due, Unavailable::from(unavailable.reason))
        }
        types::StartPracticeResponse::ReadyWriting(_) => course_home_notice(
            course,
            due,
            Unavailable::NotInTerminal(skill_name(types::PracticeKind::Writing)),
        ),
        types::StartPracticeResponse::ReadyFull(_) => course_home_notice(
            course,
            due,
            Unavailable::NotInTerminal(skill_name(types::PracticeKind::Full)),
        ),
    }
}

/// Reduce a `ready` LISTENING response: requires an `episodeId` (else malformed)
/// and well-formed comprehension items if any are present (transcript-only
/// listening with zero items is valid).
fn reduce_listening(course: Course, due: DueCounts, ready: &types::StartPracticeReady) -> View {
    let Some(episode_id) = ready.episode_id.clone() else {
        return course_home_notice(course, due, Unavailable::Malformed);
    };
    // Items are optional for listening, but any present must be answerable.
    if ready.items.iter().any(|item| item.options.is_empty()) {
        return course_home_notice(course, due, Unavailable::Malformed);
    }
    let items = ready.items.iter().map(VocabItem::from).collect();
    View::start_listening(course, ready.session_id.clone(), episode_id, items)
}

/// Validate a multiple-choice payload before it becomes a review. Returns the
/// converted items only when the set is non-empty and every item has at least
/// one answer option; otherwise `None` (malformed). A zero-option item would
/// let Enter record a fabricated answer, so it is rejected here at ingestion.
fn validate_choice_items(items: &[types::PracticeItem]) -> Option<Vec<VocabItem>> {
    if items.is_empty() {
        return None;
    }
    if items.iter().any(|item| item.options.is_empty()) {
        return None;
    }
    Some(items.iter().map(VocabItem::from).collect())
}

fn course_home_notice(course: Course, due: DueCounts, reason: Unavailable) -> View {
    View::CourseHome {
        course,
        due,
        menu_cursor: 0,
        notice: Some(reason),
        starting: false,
    }
}

/// Map a speaking grading poll result to the next [`SpeakingPhase`]:
/// - `SCORED` → `Graded` with the (rounded percent) score, transcript, feedback.
/// - `FAILED` → `Failed`.
/// - `PENDING`/`GRADING` → still `Polling` for the same `recording_id` (the App
///   schedules another poll). Pure: no network, no timers.
pub(crate) fn reduce_speaking_poll(
    recording_id: &str,
    resp: &types::SpeakingPollResponse,
) -> SpeakingPhase {
    match resp.status {
        types::SpeakingGradeStatus::Scored => SpeakingPhase::Graded {
            // overallScore is 0..1; present it as a whole percentage.
            score: resp
                .overall_score
                .map(|s| (s.clamp(0.0, 1.0) * 100.0).round() as u32),
            transcript: resp.transcript.clone(),
            feedback: resp.feedback.clone(),
        },
        types::SpeakingGradeStatus::Failed => SpeakingPhase::Failed {
            message: "Grading failed for this attempt. Try recording again.".to_string(),
        },
        types::SpeakingGradeStatus::Pending | types::SpeakingGradeStatus::Grading => {
            SpeakingPhase::Polling {
                recording_id: recording_id.to_string(),
            }
        }
    }
}

/// Whether a poll result is terminal (grading reached a final state), so the App
/// can stop the poll loop.
pub(crate) fn poll_is_terminal(phase: &SpeakingPhase) -> bool {
    matches!(
        phase,
        SpeakingPhase::Graded { .. } | SpeakingPhase::Failed { .. }
    )
}

/// Whether a course's due counts allow starting a vocab review at all. We let
/// the learner attempt a review when there is due vocab *or* any tracked vocab
/// (the server decides for sure and may still answer `unavailable`).
pub(crate) fn can_review_vocab(due: &DueCounts) -> bool {
    due.vocab > 0 || due.total_vocab > 0
}
