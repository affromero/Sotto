import CryptoKit
import Foundation

extension SottoClassTeaching {
    // The server hashes JSON.stringify(classTeachingSchema.parse(teaching)).
    // Preserve the schema's field order and JavaScript's string escaping.
    var sourceHash: String {
        let examples = workedExamples.map {
            "{\"prompt\":\(Self.jsonString($0.prompt)),\"answer\":\(Self.jsonString($0.answer)),\"explanation\":\(Self.jsonString($0.explanation))}"
        }.joined(separator: ",")
        let mistake = "{\"incorrect\":\(Self.jsonString(commonMistake.incorrect)),\"correction\":\(Self.jsonString(commonMistake.correction)),\"explanation\":\(Self.jsonString(commonMistake.explanation))}"
        let practice = "{\"prompt\":\(Self.jsonString(guidedPractice.prompt)),\"hint\":\(Self.jsonString(guidedPractice.hint)),\"answer\":\(Self.jsonString(guidedPractice.answer)),\"explanation\":\(Self.jsonString(guidedPractice.explanation))}"
        let json = "{\"version\":\(version),\"title\":\(Self.jsonString(title)),\"explanation\":\(Self.jsonString(explanation)),\"workedExamples\":[\(examples)],\"commonMistake\":\(mistake),\"guidedPractice\":\(practice)}"
        return SHA256.hash(data: Data(json.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private static func jsonString(_ value: String) -> String {
        let trim = CharacterSet(charactersIn: "\u{0009}\u{000A}\u{000B}\u{000C}\u{000D}\u{0020}\u{00A0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}")
        var result = "\""
        for scalar in value.trimmingCharacters(in: trim).unicodeScalars {
            switch scalar.value {
            case 0x22: result += "\\\""
            case 0x5c: result += "\\\\"
            case 0x08: result += "\\b"
            case 0x09: result += "\\t"
            case 0x0a: result += "\\n"
            case 0x0c: result += "\\f"
            case 0x0d: result += "\\r"
            case 0x00...0x1f: result += String(format: "\\u%04x", scalar.value)
            default: result.unicodeScalars.append(scalar)
            }
        }
        return result + "\""
    }
}
