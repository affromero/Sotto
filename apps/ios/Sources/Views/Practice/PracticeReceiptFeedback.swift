import SwiftUI

struct PracticeReceiptFeedback: View {
    let result: SottoPracticeSubmitResult

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            ForEach(result.itemFeedback ?? []) { item in
                VStack(alignment: .leading, spacing: 8) {
                    Text(item.prompt).font(.headline)
                    Text("Your answer: \(item.selectedAnswer)")
                    if !item.correct { Text("Correct answer: \(item.correctAnswer)") }
                    Text(item.explanation).foregroundStyle(SottoTheme.muted)
                }
            }
            ForEach(result.writingFeedback ?? []) { item in
                VStack(alignment: .leading, spacing: 8) {
                    Text(item.task).font(.headline)
                    Text(item.grade.text)
                    ForEach(item.grade.corrections ?? []) { correction in
                        Text("\(correction.old) → \(correction.new). \(correction.why)")
                    }
                    Text(item.grade.feedback ?? "").foregroundStyle(SottoTheme.muted)
                }
            }
            ForEach(result.speakingFeedback ?? []) { item in
                VStack(alignment: .leading, spacing: 8) {
                    Text(item.targetPhrase).font(.headline)
                    Text(item.evidence.transcript ?? "")
                    Text(item.evidence.feedback ?? "").foregroundStyle(SottoTheme.muted)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
