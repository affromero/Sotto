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
    let onCancel: (() -> Void)?

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
            .frame(width: 460)
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

            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [
                                Color(red: 0.416, green: 0.627, blue: 1.0),
                                Color(red: 0.545, green: 0.482, blue: 1.0),
                                Color(red: 1.0, green: 0.561, blue: 0.694),
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )

                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                .white.opacity(0.42),
                                .white.opacity(0.08),
                                .clear,
                            ],
                            center: .topLeading,
                            startRadius: 0,
                            endRadius: 58
                        )
                    )

                Text("S")
                    .font(.system(size: 34, weight: .bold, design: .serif))
                    .foregroundStyle(.white.opacity(0.9))

                Circle()
                    .stroke(.white.opacity(0.28), lineWidth: 1)
            }
            .frame(width: 76, height: 76)
            .shadow(color: SottoTheme.primary.opacity(0.24), radius: 16, y: 8)
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
