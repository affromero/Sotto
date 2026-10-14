import Foundation

extension SottoGenerationProgress {
    func loadingOperation(title: String, elapsedSeconds: Int, now: Date = Date()) -> SottoLoadingOperation {
        var activity: [String] = []
        if let completed = providerRequestsCompleted, completed > 0 {
            activity.append("\(completed) AI requests completed.")
        }
        if providerRequestInFlight == true {
            activity.append("Waiting for an AI response.")
        }
        if status == "GENERATING", let updatedAt {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let fractionalDate = formatter.date(from: updatedAt)
            formatter.formatOptions = [.withInternetDateTime]
            if let date = fractionalDate ?? formatter.date(from: updatedAt) {
                let age = max(0, Int(now.timeIntervalSince(date)))
                if age >= 90 {
                    activity.append("No progress update for \(Self.duration(age)). The server may still be working.")
                } else {
                    activity.append("Last progress update \(Self.duration(age)) ago.")
                }
            }
        }
        return SottoLoadingOperation(
            title: title,
            detail: "\(stage). \(detail)",
            progress: max(0, min(1, progress)),
            currentStep: currentStep == 0 ? nil : currentStep,
            totalSteps: totalSteps,
            elapsedSeconds: self.elapsedSeconds ?? elapsedSeconds,
            remainingSeconds: remainingSeconds,
            activity: activity.isEmpty ? nil : activity.joined(separator: " ")
        )
    }

    private static func duration(_ seconds: Int) -> String {
        seconds >= 60 ? "\(seconds / 60)m \(seconds % 60)s" : "\(seconds)s"
    }
}

extension SottoLoadingOperation {
    func progressUnavailable(elapsedSeconds: Int) -> SottoLoadingOperation {
        var operation = SottoLoadingOperation(
            title: title, detail: detail, progress: progress,
            currentStep: currentStep, totalSteps: totalSteps,
            elapsedSeconds: elapsedSeconds, remainingSeconds: nil
        )
        operation.activity = "Cannot refresh progress. Check your connection to the server."
        return operation
    }
}
