import SwiftUI
import UIKit

struct ClassSessionView: View {
    @EnvironmentObject private var model: SottoAppModel
    let classDetail: SottoClassDetail

    @State private var answers: [String: Int] = [:]
    @State private var submittedAnswers: [String: Int] = [:]
    @StateObject private var drafts = WritingDraftStore()
    @State private var showingRemoveConfirmation = false
    @State private var selectionHelpRequest: LearnerSelectionHelpRequest?
    @State private var selectionHelp: SottoSelectionHelpResponse?
    @State private var selectionHelpError: String?
    @State private var isLoadingSelectionHelp = false
    @State private var isExportingClass = false
    @State private var classExportError: String?
    @State private var exportedClass: ClassPDFExport?

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
                VStack(alignment: .leading, spacing: 26) {
                    ClassHeroHeader(
                        classDetail: currentClass,
                        answeredCount: answers.count,
                        questionCount: questions.count,
                        completionProgress: completionProgress,
                        completionPercent: completionPercent
                    )

                    if let intro = currentClass.intro {
                        ClassIntroBlock(intro: intro, onSelectionHelp: openSelectionHelp)
                    }

                    if let result = model.classResult {
                        ClassResultBanner(result: result)
                    }

                    ForEach(currentClass.sections) { section in
                        ClassSectionView(
                            classId: currentClass.id,
                            section: section,
                            answers: $answers,
                            drafts: drafts,
                            onSelectionHelp: openSelectionHelp
                        )
                    }

                    ClassFeedbackClinicBlock(
                        classDetail: currentClass,
                        result: model.classResult
                    )
                }
                .padding(28)
                .frame(maxWidth: 980, alignment: .leading)
            }
            .background(SottoTheme.paper)
            .navigationTitle("Class \(currentClass.order)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        model.closeClass()
                    }
                }
                ToolbarItemGroup(placement: .primaryAction) {
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
                        let classId = currentClass.id
                        model.run {
                            await model.openWorkbook(for: classId)
                        }
                    } label: {
                        Label("Workbook", systemImage: "pencil.and.scribble")
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

                    Button {
                        let classId = currentClass.id
                        model.run {
                            let graded = await drafts.submit(
                                source: .classSession(classId: classId),
                                model: model,
                                includingUnchanged: !hasChanges
                            )
                            guard graded else { return }

                            let payload = hasChanges ? changedAnswers : everyAnswer
                            if !payload.isEmpty {
                                await model.submitClassAnswers(payload)
                                submittedAnswers = answers
                            }
                        }
                    } label: {
                        Label("Submit", systemImage: "checkmark.circle.fill")
                    }
                    .disabled(drafts.isOverLimit || drafts.isSubmitting)
                }
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
            .onChange(of: currentClass.sections.map(\.id)) { _, _ in
                answers = [:]
            }
        }
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
