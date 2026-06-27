import SwiftUI

struct RootView: View {
    @EnvironmentObject private var model: SottoAppModel

    var body: some View {
        ZStack {
            if model.isPaired {
                if model.hasSelectedProfile {
                    CourseListView()
                } else {
                    ProfileSelectionView()
                }
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

    var body: some View {
        ZStack {
            Rectangle()
                .fill(.black.opacity(0.18))
                .ignoresSafeArea()

            VStack(spacing: 18) {
                SottoProgressMark(progress: operation?.progress)

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
            .padding(28)
            .frame(width: 460)
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

private struct SottoProgressMark: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isAnimating = false

    let progress: Double?

    private var clampedProgress: Double? {
        guard let progress else { return nil }
        return max(0, min(1, progress))
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(SottoTheme.primary.opacity(0.16), lineWidth: 8)

            if let clampedProgress {
                Circle()
                    .trim(from: 0, to: clampedProgress)
                    .stroke(
                        SottoTheme.primary,
                        style: StrokeStyle(lineWidth: 8, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
                    .animation(reduceMotion ? nil : .easeOut(duration: 0.35), value: clampedProgress)
            } else {
                Circle()
                    .trim(from: 0, to: 0.34)
                    .stroke(
                        SottoTheme.primary,
                        style: StrokeStyle(lineWidth: 8, lineCap: .round)
                    )
                    .rotationEffect(.degrees(isAnimating && !reduceMotion ? 270 : -90))
                    .animation(
                        reduceMotion ? nil : .linear(duration: 1.4).repeatForever(autoreverses: false),
                        value: isAnimating
                    )
            }

            VStack(spacing: 4) {
                Text("Sotto")
                    .font(.system(size: 22, weight: .bold, design: .serif))
                    .foregroundStyle(
                        LinearGradient(
                            colors: [
                                Color(red: 0.416, green: 0.627, blue: 1.0),
                                Color(red: 1.0, green: 0.561, blue: 0.694),
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                if let clampedProgress {
                    Text("\(Int(clampedProgress * 100))%")
                        .font(.caption.monospacedDigit().weight(.semibold))
                        .foregroundStyle(SottoTheme.muted)
                }
            }
            .scaleEffect(reduceMotion ? 1 : (isAnimating ? 1.04 : 0.96))
            .opacity(reduceMotion ? 1 : (isAnimating ? 1 : 0.82))
            .animation(
                reduceMotion ? nil : .easeInOut(duration: 1.8).repeatForever(autoreverses: true),
                value: isAnimating
            )
        }
        .frame(width: 116, height: 116)
        .accessibilityHidden(true)
        .onAppear {
            isAnimating = true
        }
    }
}
