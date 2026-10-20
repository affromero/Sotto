import SwiftUI

struct RootView: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.scenePhase) private var scenePhase

    private var layout: SottoLayoutMode {
        SottoLayoutMode(horizontalSizeClass)
    }

    var body: some View {
        ZStack {
            if model.showingPlay {
                PlayRootView(coordinator: model.play)
            } else if model.isPaired {
                if model.hasSelectedProfile {
                    if !model.hasAIConsent, let serverURL = model.credentials?.serverURL {
                        PrivacyConsentView(serverURL: serverURL) {
                            model.acceptAIProcessing()
                        } onDecline: {
                            model.signOut()
                        } onPlay: {
                            model.openPlay()
                        }
                    } else if let selectedClass = model.selectedClass {
                        let state = model.learningSessionState(path: "/api/v1/classes/\(selectedClass.id)",
                            attempt: selectedClass.attempt ?? 1, revision: selectedClass.progressRevision ?? 0)
                        ClassSessionView(classDetail: selectedClass, progress: state.progress, drafts: state.drafts)
                            .id("\(selectedClass.id)/\(selectedClass.attempt ?? 1)")
                            .environmentObject(model)
                    } else {
                        CourseListView()
                    }
                } else {
                    ProfileSelectionView()
                }
            } else {
                PairingView()
            }

            if model.isLoading && !model.showingPlay {
                LoadingOverlay(
                    operation: model.loadingOperation,
                    onCancel: {
                        Task {
                            await model.cancelWork()
                        }
                    }
                )
            }
        }
        .background(SottoTheme.paper)
        .environment(\.sottoLayout, layout)
        .safeAreaInset(edge: .top) {
            if !model.showingPlay, let failure = model.courseRefreshError {
                Text(failure)
                    .font(.caption)
                    .foregroundStyle(SottoTheme.muted)
                    .padding(10)
                    .frame(maxWidth: .infinity)
                    .background(SottoTheme.surface)
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
        .task(id: CourseRefreshLifecycle(scenePhase: scenePhase, identity: model.courseRefreshIdentity, showingPlay: model.showingPlay)) {
            guard scenePhase == .active, model.hasSelectedProfile, !model.showingPlay else { return }
            while !Task.isCancelled {
                await model.loadCourses(showLoading: false)
                guard !Task.isCancelled, !model.showingPlay else { return }
                await model.refreshPreparingPracticeOverview()
                do { try await Task.sleep(for: .seconds(15)) }
                catch { return }
            }
        }
        .sheet(isPresented: practiceSheetBinding) {
            if let practiceStart = model.practiceStart {
                let state = model.learningSessionState(path: "/api/v1/practice/\(practiceStart.sessionId)",
                    attempt: 1, revision: practiceStart.progressRevision ?? 0)
                PracticeStartView(start: practiceStart, progress: state.progress, drafts: state.drafts)
                    .environmentObject(model)
            }
        }
        .sheet(isPresented: workbookSheetBinding) {
            if let workbook = model.workbook {
                WorkbookView(response: workbook)
                    .environmentObject(model)
            }
        }
        .alert("Sotto", isPresented: errorBinding) {
            Button("OK") {
                model.errorMessage = nil
            }
        } message: {
            Text(model.errorMessage ?? "")
        }
    }

    private var errorBinding: Binding<Bool> {
        Binding {
            model.errorMessage != nil
        } set: { isPresented in
            if !isPresented {
                model.errorMessage = nil
            }
        }
    }

    private var practiceSheetBinding: Binding<Bool> {
        Binding {
            !model.showingPlay && model.practiceStart != nil
        } set: { isPresented in
            if !isPresented {
                model.closePractice()
            }
        }
    }

    private var workbookSheetBinding: Binding<Bool> {
        Binding {
            !model.showingPlay && model.workbook != nil && model.selectedClass == nil
        } set: { isPresented in
            if !isPresented {
                model.workbook = nil
            }
        }
    }
}

private struct CourseRefreshLifecycle: Equatable {
    let scenePhase: ScenePhase
    let identity: SottoLearnerIdentity?
    let showingPlay: Bool
}

struct LoadingOverlay: View {
    let operation: SottoLoadingOperation?
    let onCancel: () -> Void

    var body: some View {
        ZStack {
            Rectangle()
                .fill(.black.opacity(0.18))
                .ignoresSafeArea()

            VStack(spacing: 18) {
                SottoBrandMark(progress: operation?.progress)
                    .frame(width: 116, height: 116)

                VStack(spacing: 6) {
                    Text(operation?.title ?? "Working with your Sotto server")
                        .font(.headline)
                        .foregroundStyle(SottoTheme.ink)
                        .multilineTextAlignment(.center)
                    Text(operation?.detail ?? "Waiting for the server to finish the current request.")
                        .font(.callout)
                        .foregroundStyle(SottoTheme.muted)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let progress = operation?.progress {
                    Text(progressSummary(progress))
                    .font(.caption)
                    .foregroundStyle(SottoTheme.muted)
                    .monospacedDigit()
                }

                Button(role: .destructive, action: onCancel) {
                    Label("Stop waiting", systemImage: "xmark.circle")
                }
                .buttonStyle(.bordered)
                .controlSize(.regular)
            }
            .padding(28)
            .frame(maxWidth: 460)
            .padding(.horizontal, 24)
            .background(.regularMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .shadow(color: .black.opacity(0.16), radius: 24, y: 12)
        }
    }

    private func progressSummary(_ progress: Double) -> String {
        let percent = "\(Int(max(0, min(1, progress)) * 100))%"
        if let currentStep = operation?.currentStep, let totalSteps = operation?.totalSteps {
            return "Step \(currentStep) of \(totalSteps) / \(percent)"
        }
        return percent
    }
}
