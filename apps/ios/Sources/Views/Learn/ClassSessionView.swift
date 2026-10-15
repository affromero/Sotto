import SwiftUI
import UIKit
import PencilKit

struct ClassSessionView: View {
    @Environment(\.sottoLayout) private var layout
    @EnvironmentObject private var model: SottoAppModel
    let classDetail: SottoClassDetail

    @ObservedObject var progress: LearningProgressStore
    @State private var hydrated = false
    @State private var answers: [String: Int] = [:]
    @State private var submittedAnswers: [String: Int] = [:]
    @ObservedObject var drafts: WritingDraftStore
    @State private var showingRemoveConfirmation = false
    @State private var selectionHelpRequest: LearnerSelectionHelpRequest?
    @State private var selectionHelp: SottoSelectionHelpResponse?
    @State private var selectionHelpError: String?
    @State private var isLoadingSelectionHelp = false
    @State private var isExportingClass = false
    @State private var classExportError: String?
    @State private var exportedClass: ClassPDFExport?
    @State private var unreviewedPencilAnswers = Set<String>()
    @State private var pencilReviewError: String?
    @State private var pencilToolPicker = WorkbookTools.makeWorkbookToolPicker()

    private var currentClass: SottoClassDetail {
        model.selectedClass ?? classDetail
    }

    private var questions: [SottoQuestion] {
        currentClass.sections.flatMap(\.questions)
    }

    /// Only the choices that moved since the last submit.
    private var changedAnswers: [SottoSubmitAnswer] {
        answers
            .filter { submittedAnswers[$0.key] != $0.value }
            .map { SottoSubmitAnswer(questionId: $0.key, selectedIndex: $0.value) }
    }

    private var everyAnswer: [SottoSubmitAnswer] {
        answers.map { SottoSubmitAnswer(questionId: $0.key, selectedIndex: $0.value) }
    }

    private var hasChanges: Bool {
        !changedAnswers.isEmpty || drafts.hasChanges
    }

    private var completionProgress: Double {
        if currentClass.submitted { return 1 }
        guard !questions.isEmpty else { return 0 }
        return min(1, Double(answers.count) / Double(questions.count))
    }

    private var completionPercent: Int {
        Int((completionProgress * 100).rounded())
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                classContent
                .padding(layout == .compact ? 16 : 28)
                .frame(maxWidth: 980, alignment: .leading)
            }
            .background(SottoTheme.paper)
            .navigationTitle(model.pencilWorkbook && layout.supportsHandwriting ? "Class \(currentClass.order) workbook" : "Class \(currentClass.order)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                sessionToolbar
            }
            .sheet(isPresented: workbookSheetBinding) {
                if let workbook = model.workbook {
                    WorkbookView(response: workbook)
                        .environmentObject(model)
                }
            }
            .sheet(item: $exportedClass) { export in
                ClassShareSheet(activityItems: [export.url])
            }
            .alert(
                "Could not export class",
                isPresented: Binding(
                    get: { classExportError != nil },
                    set: { if !$0 { classExportError = nil } }
                )
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(classExportError ?? "")
            }
            .sheet(item: $selectionHelpRequest, onDismiss: resetSelectionHelp) { request in
                SelectionHelpSheet(
                    request: request,
                    help: selectionHelp,
                    isLoading: isLoadingSelectionHelp,
                    errorMessage: selectionHelpError
                ) {
                    Task {
                        await loadSelectionHelp(for: request)
                    }
                }
                .presentationDetents([.medium, .large])
                .task(id: request.id) {
                    await loadSelectionHelp(for: request)
                }
            }
            .confirmationDialog("Remove class?", isPresented: $showingRemoveConfirmation, titleVisibility: .visible) {
                Button("Remove class", role: .destructive) {
                    model.run {
                        await model.deleteSelectedClass()
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This removes the current generated class and clears the active-class gate so you can generate a new one.")
            }
            .task(id: currentClass.id) {
                guard !hydrated else { return }
                progress.configure(client: model.makeClient(), path: "/api/v1/classes/\(currentClass.id)",
                    revision: currentClass.progressRevision ?? 0)
                answers = progress.answers ?? currentClass.learnerAnswers ?? [:]
                drafts.register(currentClass.sections.flatMap(\.writingPrompts), savedDrafts: currentClass.writingDrafts ?? [:])
                hydrated = true
                refreshPencilReviews()
            }
            .onChange(of: answers) { _, _ in saveProgress(); refreshPencilReviews() }
            .onChange(of: drafts.texts) { _, _ in saveProgress(); refreshPencilReviews() }
            .onDisappear { Task { await progress.flush() } }
            .onChange(of: currentClass.sections.map(\.id)) { _, _ in
                answers = currentClass.learnerAnswers ?? [:]
                refreshPencilReviews()
            }
        }
    }

    private var classContent: some View {
        VStack(alignment: .leading, spacing: 26) {
            ClassHeroHeader(
                classDetail: currentClass,
                answeredCount: answers.count,
                questionCount: questions.count,
                completionProgress: completionProgress,
                completionPercent: completionPercent
            )
            LearningSaveFailureView(progress: progress)
            if model.pencilWorkbook && layout.supportsHandwriting {
                Text("Write or mark your answers on each white exercise page with Apple Pencil. Use a finger to scroll. Tap Read my marks, check the interpretation, then Use reviewed answer. Record speaking below and tap Submit at the end for class feedback.")
                    .font(.callout).foregroundStyle(SottoTheme.muted)
            }
            pencilReviewStatus
            if let intro = currentClass.intro {
                ClassIntroBlock(intro: intro, onSelectionHelp: openSelectionHelp)
            }
            if let result = model.classResult {
                ClassResultBanner(result: result)
            }
            ForEach(currentClass.sections) { section in
                classSection(section)
            }
            ClassFeedbackClinicBlock(classDetail: currentClass, result: model.classResult)
            workbookSubmissionFooter
        }
    }

    private func classSection(_ section: SottoClassSection) -> some View {
        ClassSectionView(
            classId: currentClass.id,
            section: section,
            answers: $answers,
            drafts: drafts,
            pencilWorkbook: model.pencilWorkbook && layout.supportsHandwriting,
            classAttempt: currentClass.attempt ?? 1,
            pencilToolPicker: pencilToolPicker,
            onPencilReviewRequired: updatePencilReview,
            onSelectionHelp: openSelectionHelp
        )
    }

    private func updatePencilReview(id: String, required: Bool) {
        if required { unreviewedPencilAnswers.insert(id) }
        else { unreviewedPencilAnswers.remove(id) }
    }

    @ViewBuilder
    private var pencilReviewStatus: some View {
        if let pencilReviewError { Text(pencilReviewError).foregroundStyle(.red) }
        if !unreviewedPencilAnswers.isEmpty && !model.pencilWorkbook {
            Text(layout.supportsHandwriting ? "Open Workbook to review your saved Pencil answers before submitting." :
                "Widen this window to review your saved Pencil answers before submitting.")
                .foregroundStyle(SottoTheme.primary)
        }
    }

    @ViewBuilder
    private var workbookSubmissionFooter: some View {
        if !unreviewedPencilAnswers.isEmpty {
            Text("Review your Pencil answers before submitting. Read my marks helps you check circles, edits, and handwriting.")
                .foregroundStyle(SottoTheme.primary)
        }
        submitButton.buttonStyle(SottoPrimaryButtonStyle())
    }

    @ToolbarContentBuilder
    private var sessionToolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button("Close") { model.closeClass() }
        }
        ToolbarItemGroup(placement: .primaryAction) {
            if layout == .compact {
                Menu { classTools } label: {
                    Label("Class actions", systemImage: "ellipsis.circle")
                }
            } else {
                classTools
            }
            submitButton
        }
    }

    @ViewBuilder
    private var classTools: some View {
        ProfileToolbarMenu {
            model.closeClass()
        }

        Button {
            exportCurrentClass()
        } label: {
            Label(isExportingClass ? "Exporting" : "Export", systemImage: "square.and.arrow.up")
        }
        .disabled(isExportingClass)

        Button {
            if layout.supportsHandwriting {
                model.pencilWorkbook.toggle()
                return
            }
            let classId = currentClass.id
            model.run {
                await model.openWorkbookPDF(for: classId)
            }
        } label: {
            Label(model.pencilWorkbook ? "Class view" : "Workbook", systemImage: "pencil.and.scribble")
        }

        if layout.supportsHandwriting {
            Button("PDF notes", systemImage: "doc") {
                model.run { await model.openWorkbookPDF(for: currentClass.id) }
            }
        }

        Menu {
            Button {
                model.run {
                    await model.regenerateSelectedClass()
                    answers = [:]
                }
            } label: {
                Label("Regenerate class", systemImage: "arrow.triangle.2.circlepath")
            }

            Button(role: .destructive) {
                showingRemoveConfirmation = true
            } label: {
                Label("Remove class", systemImage: "trash")
            }
        } label: {
            Label("Class settings", systemImage: "ellipsis.circle")
        }
        .disabled(model.isLoading)

    }

    private var submitButton: some View {
        Button {
            let classId = currentClass.id
            model.run {
                let graded = await drafts.submit(
                    source: .classSession(classId: classId),
                    model: model,
                    includingUnchanged: false
                )
                guard graded else { return }

                let payload = everyAnswer
                await model.submitClassAnswers(payload)
                submittedAnswers = answers
            }
        } label: {
            Label("Submit", systemImage: "checkmark.circle.fill")
        }
        .disabled(!hydrated || drafts.isOverLimit || drafts.isSubmitting || !unreviewedPencilAnswers.isEmpty)
    }

    private func refreshPencilReviews() {
        guard let credentials = model.credentials, let profile = credentials.selectedProfile else { return }
        let reviews = PencilReviewStore()
        let inks = LearningInkStore()
        var required = Set<String>()
        pencilReviewError = nil
        for section in currentClass.sections {
            let exercises = section.questions.map { PencilExercise.question($0) } + section.writingPrompts.map { PencilExercise.writing($0) }
            for exercise in exercises {
                let digest = PencilExercisePaper.taskDigest(prompt: exercise.prompt, passage: exercise.passage, options: exercise.options)
                let key = LearningInkStore.scope(server: credentials.serverURL, profileID: profile.id,
                    activity: "pencil/v1/\(currentClass.id)/\(currentClass.attempt ?? 1)/\(exercise.id)/\(digest)")
                let confirmed: PencilAnswer? = exercise.kind == "QUESTION" ? answers[exercise.id].map { .choice($0) } :
                    drafts.draft(for: exercise.id).map { .writing($0.text) }
                do {
                    if try reviews.requiresReview(drawing: inks.load(key), key: key, confirmedAnswer: confirmed) { required.insert(exercise.id) }
                } catch {
                    required.insert(exercise.id)
                    pencilReviewError = "Saved Pencil work could not be opened. It will not be overwritten. \(error.localizedDescription)"
                }
            }
        }
        unreviewedPencilAnswers = required
    }

    private func saveProgress() {
        guard hydrated, !currentClass.submitted else { return }
        progress.update(answers: answers, writingDrafts: drafts.texts)
    }

    private var workbookSheetBinding: Binding<Bool> {
        Binding {
            model.workbook != nil
        } set: { isPresented in
            if !isPresented {
                model.workbook = nil
            }
        }
    }

    private func openSelectionHelp(text: String, contextText: String) {
        let cleaned = cleanLearnerSelection(text)
        guard !cleaned.isEmpty else { return }
        selectionHelp = nil
        selectionHelpError = nil
        isLoadingSelectionHelp = true
        selectionHelpRequest = LearnerSelectionHelpRequest(
            courseId: currentClass.courseId,
            text: cleaned,
            contextText: cleanLearnerSelection(contextText)
        )
    }

    private func loadSelectionHelp(for request: LearnerSelectionHelpRequest) async {
        guard selectionHelpRequest?.id == request.id else { return }
        isLoadingSelectionHelp = true
        selectionHelpError = nil

        do {
            let response = try await model.fetchSelectionHelp(
                courseId: request.courseId,
                text: request.text,
                contextText: request.contextText
            )
            guard selectionHelpRequest?.id == request.id else { return }
            selectionHelp = response
        } catch {
            guard selectionHelpRequest?.id == request.id else { return }
            selectionHelpError = error.localizedDescription
        }

        isLoadingSelectionHelp = false
    }

    private func resetSelectionHelp() {
        selectionHelp = nil
        selectionHelpError = nil
        isLoadingSelectionHelp = false
    }

    private func exportCurrentClass() {
        isExportingClass = true
        classExportError = nil

        do {
            let url = try ClassPDFExporter.export(classDetail: currentClass, answers: answers)
            exportedClass = ClassPDFExport(url: url)
        } catch {
            classExportError = error.localizedDescription
        }

        isExportingClass = false
    }
}
