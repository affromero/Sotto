import SwiftUI

enum SottoPrivacy {
    static let policyURL = URL(string: "https://sotto.fm/privacy")!
}

struct PrivacyPolicyLink: View {
    @State private var isPresented = false

    var body: some View {
        Button("Privacy policy") { isPresented = true }
            .frame(minHeight: 44)
            .sheet(isPresented: $isPresented) { PrivacyPolicyView() }
    }
}

struct PrivacyPolicyView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Your server and your data").font(.title2.bold())
                    Text("Sotto connects to the server you choose. Its operator controls learner profiles, photos, courses, recordings, answers, transcripts, progress, logs, and backups. The open-source project does not receive data from independently operated servers.")
                    Text("On this device").font(.headline)
                    Text("Pairing codes are scanned locally. Server credentials are stored in the iOS Keychain. Workbook and answer handwriting are saved on this device. Text recognition runs on this device; only answers you choose to submit are sent for feedback. Photos you choose are uploaded to your server as your profile image. Sotto does not include advertising or tracking SDKs.")
                    Text("AI and speech processing").font(.headline)
                    Text("Your server sends lesson context, written answers, recordings, and transcripts to the AI and speech providers selected by its operator. Ask your operator which providers are configured and review their terms before sharing sensitive information. Live translation sends microphone audio and translation context directly to Google Gemini after your permission, then stores the transcript on your server.")
                    Text("Deletion and questions").font(.headline)
                    Text("Use Delete learner profile in Settings to request removal of your profile and learning data. Your server operator controls retention in backups, logs, and connected providers. Contact that operator for access, export, retention, or other privacy requests. Unpairing removes this device's saved access credentials; it does not delete server data.")
                    Link("Privacy policy on the web", destination: SottoPrivacy.policyURL)
                        .frame(minHeight: 44)
                    Link("Google privacy policy", destination: URL(string: "https://policies.google.com/privacy")!)
                        .frame(minHeight: 44)
                }
                .padding(24)
                .frame(maxWidth: 720, alignment: .leading)
            }
            .navigationTitle("Privacy")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
    }
}

struct PrivacyConsentView: View {
    let serverURL: URL
    let onAccept: () -> Void
    let onDecline: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Text("Before you learn").font(.largeTitle.bold())
                Text("You are connected to \(serverURL.host ?? serverURL.absoluteString).")
                Text("Your learning requests, written answers, recordings, and transcripts may be sent to the AI and speech providers configured by this server's operator. They process this information to generate lessons, recognize speech, and provide feedback. Your server stores your learning activity and results.")
                Text("Ask your server operator which providers are enabled and review their policies before continuing. Live translation asks separately before sending audio to Google Gemini.")
                PrivacyPolicyLink()
                Button("Allow AI processing", action: onAccept)
                    .buttonStyle(SottoPrimaryButtonStyle())
                Button("Unpair this device", action: onDecline)
                    .buttonStyle(SottoSecondaryButtonStyle())
            }
            .padding(24)
            .frame(maxWidth: 680, alignment: .leading)
        }
    }
}
