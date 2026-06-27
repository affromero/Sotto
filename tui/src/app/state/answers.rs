/// Outcome of recording an answer for the current vocab item.
///
/// Not `PartialEq`: the generated [`types::SubmitPracticeRequestAnswersItem`]
/// payload does not implement it. Tests match on the variant instead.
#[derive(Clone, Debug)]
pub(crate) enum AnswerStep {
    /// Advanced to the next item.
    Advanced,
    /// That was the last item; the caller should submit the built payload. The
    /// `Result` carries an error instead of a partial payload when any answer
    /// fails id validation, so a malformed id is surfaced rather than silently
    /// dropped.
    Submit(Result<Vec<types::SubmitPracticeRequestAnswersItem>, String>),
}

/// Move the option cursor up within the current item, saturating at 0.
pub(crate) fn cursor_up(cursor: usize) -> usize {
    cursor.saturating_sub(1)
}

/// Move the option cursor down within the current item, clamped to the last
/// option.
pub(crate) fn cursor_down(cursor: usize, option_count: usize) -> usize {
    let last = option_count.saturating_sub(1);
    (cursor + 1).min(last)
}

/// Move the list cursor up within `len` items, saturating at 0.
pub(crate) fn list_up(cursor: usize) -> usize {
    cursor.saturating_sub(1)
}

/// Move the list cursor down within `len` items, clamped to the last index.
pub(crate) fn list_down(cursor: usize, len: usize) -> usize {
    let last = len.saturating_sub(1);
    (cursor + 1).min(last)
}

/// Record `choice` for the item at `index`, advance to the next item, and
/// return whether more items remain or the answers are ready to submit.
///
/// `selected` is mutated in place; `index`/`cursor` are returned to the caller
/// so the view can update its own copies. The returned [`AnswerStep::Submit`]
/// payload is built from `items` + the just-updated `selected`, so callers do
/// not reconstruct it.
pub(crate) fn answer_current(
    items: &[VocabItem],
    selected: &mut [Option<usize>],
    index: usize,
    choice: usize,
) -> AnswerStep {
    if index < selected.len() {
        selected[index] = Some(choice);
    }

    if index + 1 < items.len() {
        AnswerStep::Advanced
    } else {
        AnswerStep::Submit(build_answers(items, selected))
    }
}

/// Record `choice` for the question at `index` and report whether it was the
/// last question (so the section is complete). Used by the class MC/listening
/// sections, whose answers are collected later by [`collect_class_answers`]
/// rather than built into a payload here. Pure.
/// `total` is the question count (the question type itself is irrelevant — only
/// the count matters), so class and placement MC reviews share this helper.
pub(crate) fn answer_current_choice(
    total: usize,
    selected: &mut [Option<usize>],
    index: usize,
    choice: usize,
) -> bool {
    if index < selected.len() {
        selected[index] = Some(choice);
    }
    index + 1 >= total
}

/// Build the `submit` request payload from items and their recorded selections.
///
/// Items the learner skipped (no recorded selection) are omitted — that is a
/// legitimate "no answer", not corruption. But if an *answered* item carries an
/// id the contract rejects, this returns `Err` rather than dropping it: a
/// partial payload would silently misgrade the session, so the caller surfaces
/// the error instead of submitting.
pub(crate) fn build_answers(
    items: &[VocabItem],
    selected: &[Option<usize>],
) -> Result<Vec<types::SubmitPracticeRequestAnswersItem>, String> {
    let mut answers = Vec::new();
    for (item, choice) in items.iter().zip(selected.iter()) {
        let Some(choice) = *choice else {
            continue;
        };
        let item_id = types::SubmitPracticeRequestAnswersItemItemId::try_from(item.id.clone())
            .map_err(|e| format!("invalid item id {:?}: {e}", item.id))?;
        answers.push(types::SubmitPracticeRequestAnswersItem {
            item_id,
            selected_index: choice as i64,
        });
    }
    Ok(answers)
}
