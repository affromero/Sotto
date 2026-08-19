import SwiftUI

struct RootView: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var layout: SottoLayoutMode {
        SottoLayoutMode(horizontalSizeClass)
    }

    var body: some View {
        ZStack {
            if model.isPaired {
                if model.hasSelectedProfile {
                    if let selectedClass = model.selectedClass {
                        ClassSessionView(classDetail: selectedClass)
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

            if model.isLoading {
                LoadingOverlay(
                    operation: model.loadingOperation,
                    onCancel: model.canCancelLoading ? {
                        Task {
                            await model.cancelCurrentClassGeneration()
                        }
                    } : nil
                )
            }
        }
        .background(SottoTheme.paper)
        .environment(\.sottoLayout, layout)
        .sheet(isPresented: practiceSheetBinding) {
            if let practiceStart = model.practiceStart {
                PracticeStartView(start: practiceStart)
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
            model.practiceStart != nil
        } set: { isPresented in
            if !isPresented {
                model.practiceStart = nil
                model.practiceResult = nil
            }
        }
    }

    private var workbookSheetBinding: Binding<Bool> {
        Binding {
            model.workbook != nil && model.selectedClass == nil
        } set: { isPresented in
            if !isPresented {
                model.workbook = nil
            }
        }
    }
}

struct LoadingOverlay: View {
    let operation: SottoLoadingOperation?
    let onCancel: (() -> Void)?

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

                if let onCancel {
                    Button(role: .destructive, action: onCancel) {
                        Label("Cancel generation", systemImage: "xmark.circle")
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.regular)
                }
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
