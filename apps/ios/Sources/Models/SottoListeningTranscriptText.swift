import Foundation

enum ListeningTranscriptText {
    static func display(_ text: String) -> String {
        text.replacingOccurrences(
            of: #"\[V[0-9]+:([^\]]+)\]"#,
            with: "$1",
            options: .regularExpression
        )
    }
}
