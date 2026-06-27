import SwiftUI

struct RootView: View {
    @EnvironmentObject private var model: SottoAppModel

    var body: some View {
        ZStack {
            if model.isPaired {
                CourseListView()
            } else {
                PairingView()
            }

            if model.isLoading {
                LoadingOverlay(operation: model.loadingOperation)
            }
        }
        .background(SottoTheme.paper)
        .sheet(item: $model.selectedClass) { classDetail in
            ClassSessionView(classDetail: classDetail)
                .environmentObject(model)
        }
        .sheet(isPresented: practiceSheetBinding) {
            if let practiceStart = model.practiceStart {
                PracticeStartView(start: practiceStart)
                    .environmentObject(model)
            }
        }
        .sheet(isPresented: workbookSheetBinding) {
            if let workbook = model.workbook {
                WorkbookView(response: workbook)
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

    var body: some View {
        ZStack {
            Rectangle()
                .fill(.black.opacity(0.18))
                .ignoresSafeArea()

            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 14) {
                    ProgressView()
                        .controlSize(.large)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(operation?.title ?? "Working with your Sotto server")
                            .font(.headline)
                            .foregroundStyle(SottoTheme.ink)
                        Text(operation?.detail ?? "Waiting for the server to finish the current request.")
                            .font(.callout)
                            .foregroundStyle(SottoTheme.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                if let progress = operation?.progress {
                    ProgressView(value: progress)
                        .tint(SottoTheme.primary)
                    HStack {
                        if let currentStep = operation?.currentStep, let totalSteps = operation?.totalSteps {
                            Text("Step \(currentStep) of \(totalSteps)")
                        } else {
                            Text("\(Int(progress * 100))%")
                        }
                        Spacer()
                        Text(timeSummary)
                    }
                    .font(.caption)
                    .foregroundStyle(SottoTheme.muted)
                    .monospacedDigit()
                }
            }
            .padding(24)
            .frame(width: 440, alignment: .leading)
            .background(.regularMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .shadow(color: .black.opacity(0.16), radius: 24, y: 12)
        }
    }

    private var timeSummary: String {
        let elapsed = formatDuration(operation?.elapsedSeconds)
        guard let remainingSeconds = operation?.remainingSeconds else {
            return "Elapsed \(elapsed)"
        }
        return "Elapsed \(elapsed) / about \(formatDuration(remainingSeconds)) left"
    }

    private func formatDuration(_ seconds: Int?) -> String {
        guard let seconds else { return "0:00" }
        let minutes = max(0, seconds) / 60
        let remainder = max(0, seconds) % 60
        return "\(minutes):\(String(format: "%02d", remainder))"
    }
}
