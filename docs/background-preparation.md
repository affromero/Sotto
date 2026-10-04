# Background class preparation

Updated: October 1, 2026

Durable class and practice preparation preserves learner authority, execution cleanup, and visible outcomes.

New audio generations and ordinary failed-stitch resumes use bundled stock sound
effects. They do not require a separate premium effects credential. Existing jobs
retain their recorded sound policy; an explicitly admitted premium job still
surfaces provider failures without switching to stock effects.

Run `node scripts/tests/browser/preparation-layout.mjs` from the repository root
to verify the expanded schedule and activity panels at 375px. The browser probe
uses synthetic HTTP responses and writes screenshots to `test-results/preparation-layout/`.

Class preparation is admitted to durable storage before generation starts. A worker prepares the class through the existing curriculum and mastery gates. Closing the browser does not discard an accepted task.

On the course card, **Take a class** starts immediate preparation. **Prepare a class later** schedules one task within the next seven days. Select a local time and a maximum number of model requests. The saved time zone and selected model appear under **Preparation activity**. **Check preparation** retrieves a saved task after reopening the page.

Scheduled preparation uses an API or local HTTP model. It generates the listening script but leaves audio for a subsequent learner action. Ordinary manual preparation retains its existing audio behavior. Subscription CLI requests have no enforceable HTTP request count; bounded CLI preparation requires the optional isolated Claude broker described in [isolated agents](isolated-agents.md).

## Scope and context

The task captures the selected model, provider, endpoint, credential revision, course, and learner identity. Replacing a credential or changing ownership prevents later effects. It does not silently choose another provider. A request limit counts admitted parent model requests, including retries. It is not a currency limit. Audio operations have separate provider usage and are not part of that parent request count.

Grammar, reading, and contextual vocabulary candidates receive an independent review through the same captured model before publication. The blind reviewer sees the passage, questions, and options without the proposed answer key or explanations. It must find exactly one defensible answer per question, agree with the proposed key, and accept the reading language. Candidates that pass also receive a teaching review of the exact learner-visible content, including answer keys and explanations. Rejected candidates fail after bounded retries. These reviews are probabilistic and cannot guarantee accuracy.

These multiple-choice sections permit two generation attempts and, when needed, one JSON repair. Each structurally valid candidate adds one blind review request. Passing that review adds one teaching review request, including for repaired output. This allows at most seven application-level model calls per section; provider transport retries can consume additional admitted requests. A section that passes both reviews on its first attempt uses three calls. Reviews use the existing request budget and fail when admission is denied; no alternate provider is selected. Allow for these requests when scheduling preparation.

Listening allows one complete script and quiz replacement after a valid blind
review rejects their content. It uses the original model, objective, vocabulary,
and execution authority. Both independent reviews must approve the final material
before publication. Malformed verdicts, provider errors, cancellation, and teaching
review rejection stop generation without another replacement. Listening uses at
most seven application model calls: two scripts, two quizzes, two blind reviews,
and one teaching review. Reference verification, provider transport and search
subrequests, and later audio usage are separate.

Reading vocabulary receives teaching review in batches of five words and allows
one extraction replacement. Twelve words permit at most two extraction calls and
six teaching reviews. These requests use the unchanged parent budget. Replacement
preserves the reading passage and questions while correcting the reviewed word
metadata. A background word may have no associated question and therefore adds no
SRS evidence; the extracted word list remains nonempty.

Generation reads the course level, curriculum, saved course notes, and existing review targets through the normal learning pipeline. Notes can guide future content; scored practice determines mastery. Clearing saved notes does not delete vocabulary previously imported from them or reset practice scores. Edit those items through the existing vocabulary and learning controls.

Raw source URLs and topics live in the scoped job payload so existing erasure rules cover them. The preparation record stores their fingerprint. The activity feed exposes model selection, admission counts, and lifecycle events without prompts, credentials, or raw learner content. The shared journal retains at most 128 recent events and marks gaps explicitly.

## Cancellation and recovery

Cancellation revokes the preparation grant. Queued work cannot begin new model requests, and linked audio jobs cannot make further provider requests or publish results under revoked authority. Work already sent to a remote provider may still incur charges. Sotto waits for local execution cleanup before treating cancellation as settled.

Class preparations recorded as `FAILED` retain that outcome after cleanup.
Completing cleanup does not mean the learner cancelled the task. A new class attempt is admitted only after
the execution and descendant audio receipts confirm that cleanup settled.
Practice failures report unsuccessful generation without assuming the provider
settings caused it. Reviewer feedback and generated content remain private.

Interrupted requests can have an unknown remote outcome. Sotto records that state and does not repeat the request automatically. **Check cleanup and recover** requires acknowledging possible provider charges and verifies the canonical execution and child-job receipts. The acknowledgement cannot override active work or unconfirmed cleanup. A completed class is retained when its remaining background work is cancelled.

If an isolated container cannot be removed, an operator must reconcile its recorded identity against the same Docker daemon. Follow the recovery procedure in [isolated agents](isolated-agents.md). Provider-outcome acknowledgement, container cleanup, and job-journal settlement are separate checks.

## API

- `POST /api/v1/courses/:courseId/next-class` durably admits immediate work. `Prefer: respond-async` returns 202 with the operation ID. Existing synchronous callers may wait for the worker result, with a 202 response if the wait window expires.
- `POST /api/v1/courses/:courseId/preparation` schedules one task. Supply `availableAt` as an ISO timestamp, `timeZone`, `maxProviderRequests` from 1 through 256, and `deferAudio: true`.
- `GET /api/v1/courses/:courseId/generation` returns progress even before a class exists. `DELETE` requests cancellation.
- `GET /api/v1/courses/:courseId/preparation` returns sanitized activity. `after` and `limit` page through retained events.
- `PATCH /api/v1/courses/:courseId/preparation` with `acknowledgeUnknownOutcome: true` checks cleanup and recovers a cancelled or interrupted task when safe.

To replace a generated class that has no learner work, request `GET /api/v1/classes/:classId?pristineSnapshot=1`, then send its opaque `pristineSnapshot` and the current `expectedAttempt` to the existing class POST route with `scope: "class"`. Successful durable admission returns 202 with the operation and course IDs. It rejects stale snapshots or attempts, learner work, or unsettled linked execution with 409. Admission checks ownership and the snapshot in a serializable transaction; the worker rechecks the captured state before rebuilding pristine sections. It does not delete submissions. Existing explicit regeneration without this guard retains its existing behavior.

All endpoints require the current learner's authority. Preparation uses the existing SQL state, durable outbox, worker execution journal, and Redis queue. The preparation subsystem requires no additional schema migration. Deploy the web application and workers together. Next-class callers still receive the existing 200/201 result when generation finishes within the wait window. Class regeneration and newly admitted practice return 202 and require polling their saved operation or session. Native clients do not yet expose the new scheduling, activity, or recovery controls. The TUI treats a next-class 202 after the wait window as an unsuccessful request even though preparation continues; inspect the saved task in the web UI.

The pinned Sidedoor dependency includes the delegation, broker, and isolated-runner exports used by this feature. Its exact version is recorded in `apps/web/package.json` and `package-lock.json`.
