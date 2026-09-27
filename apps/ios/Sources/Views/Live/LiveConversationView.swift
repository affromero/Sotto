import AVFoundation
import SwiftUI

/// Live translation: the learner speaks, and hears it back in the other
/// language with captions on both sides. Replaces the last of the three
/// browser hand-offs.
///
/// Gemini's session token is single-use and short-lived, so a dropped
/// connection ends the session rather than silently reconnecting with a spent
/// credential; starting again mints a fresh one.
struct LiveConversationView: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.sottoLayout) private var layout

    let course: SottoCourse

    @State private var direction = "native_to_target"
    @StateObject private var lifecycle = LiveConversationLifecycle()
    @State private var heard = ""
    @State private var spoken = ""
    @State private var errorMessage: String?
    @State private var session: LiveTranslateSession?
    @State private var audio = LiveAudioEngine()
    @State private var pump: Task<Void, Never>?
    @State private var startTask: Task<Void, Never>?
    @State private var showGoogleConsent = false

    private var phase: LiveConversationLifecycle.Phase { lifecycle.phase }

    private var directionLabel: String {
        direction == "native_to_target"
            ? "\(languageName(course.nativeLang)) → \(languageName(course.targetLang))"
            : "\(languageName(course.targetLang)) → \(languageName(course.nativeLang))"
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    controls

                    if let errorMessage {
                        ExamNoticeCard(
                            title: "Live translation is unavailable",
                            message: errorMessage,
                            systemImage: "exclamationmark.triangle"
                        )
                    }

                    captionCard(
                        title: "You said",
                        text: heard,
                        placeholder: phase == .live ? "Listening..." : "Start the session and speak."
                    )
                    captionCard(
                        title: "Translation",
                        text: spoken,
                        placeholder: "The translation appears here as it is spoken."
                    )

                    if !lifecycle.transcript.isEmpty {
                        SettingsCard(title: "This conversation") {
                            ForEach(Array(lifecycle.transcript.enumerated()), id: \.offset) { _, line in
                                Text(line)
                                    .font(.callout)
                                    .foregroundStyle(SottoTheme.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                }
                .padding(layout.pagePadding)
                .frame(maxWidth: layout.readableWidth, alignment: .leading)
            }
            .background(SottoTheme.paper)
            .navigationTitle("Live")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        finish()
                        dismiss()
                    }
                }
            }
            .onDisappear { finish() }
            .confirmationDialog("Share audio with Google Gemini?", isPresented: $showGoogleConsent, titleVisibility: .visible) {
                Button("Allow and start session") {
                    guard let request = lifecycle.acceptConsent() else { return }
                    startTask = Task { await begin(request: request) }
                }
                Button("Cancel", role: .cancel) { lifecycle.declineConsent() }
            } message: {
                Text("Your microphone audio and translation context are sent directly to Google Gemini to translate and speak replies. The conversation transcript is saved on your Sotto server for learning progress. Only continue if you agree to this processing.")
            }
        }
    }

    private var controls: some View {
        SettingsCard(title: "Direction") {
            Picker("Direction", selection: $direction) {
                Text("\(languageName(course.nativeLang)) → \(languageName(course.targetLang))")
                    .tag("native_to_target")
                Text("\(languageName(course.targetLang)) → \(languageName(course.nativeLang))")
                    .tag("target_to_native")
            }
            .pickerStyle(.segmented)
            .disabled(phase != .idle)

            Button {
                if phase == .live {
                    finish()
                } else {
                    lifecycle.requestConsent()
                    showGoogleConsent = true
                }
            } label: {
                Label(
                    buttonTitle,
                    systemImage: phase == .live ? "stop.fill" : "waveform"
                )
            }
            .buttonStyle(SottoPrimaryButtonStyle())
            .disabled(phase == .connecting)

            Text(phase == .live ? "Speaking \(directionLabel)." : "Sotto translates what you say, and speaks it back. It never starts a conversation of its own.")
                .font(.caption)
                .foregroundStyle(SottoTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
            Link("Google privacy policy", destination: URL(string: "https://policies.google.com/privacy")!)
                .font(.caption)
                .frame(minHeight: 44)
        }
    }

    private var buttonTitle: String {
        switch phase {
        case .idle: return "Start session"
        case .connecting: return "Connecting"
        case .live: return "End session"
        }
    }

    private func captionCard(title: String, text: String, placeholder: String) -> some View {
        SettingsCard(title: title) {
            Text(text.isEmpty ? placeholder : text)
                .font(text.isEmpty ? .callout : .body)
                .foregroundStyle(text.isEmpty ? SottoTheme.muted : SottoTheme.ink)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func begin(request: UUID) async {
        guard lifecycle.isCurrent(request), !Task.isCancelled else { return }
        errorMessage = nil
        heard = ""
        spoken = ""

        let allowed = await requestMicrophoneAccess()
        guard lifecycle.isCurrent(request), !Task.isCancelled else { return }
        guard allowed else {
            errorMessage = "Sotto needs the microphone to translate what you say."
            finish()
            return
        }

        do {
            let token = try await model.mintLiveToken(courseId: course.id, direction: direction)
            guard lifecycle.isCurrent(request), !Task.isCancelled else { return }
            let session = LiveTranslateSession(token: token)
            self.session = session

            let events = await session.open()
            guard lifecycle.isCurrent(request), !Task.isCancelled else {
                await session.close()
                return
            }
            try audio.start { base64 in
                Task { await session.sendAudio(base64Pcm16k: base64) }
            }

            pump = Task { await consume(events, request: request) }
        } catch {
            guard lifecycle.isCurrent(request), !Task.isCancelled else { return }
            errorMessage = SottoLiveFailure.message(for: error)
            finish()
        }
    }

    private func consume(_ events: AsyncStream<LiveTranslateSession.Event>, request: UUID) async {
        for await event in events {
            guard lifecycle.isCurrent(request), !Task.isCancelled else { return }
            switch event {
            case .opened:
                lifecycle.opened(request)
            case let .audio(base64):
                audio.enqueue(base64Pcm24k: base64)
            case let .inputTranscript(text, finished):
                heard += text
                if finished, !heard.isEmpty {
                    lifecycle.append("You: \(heard)", request: request)
                    heard = ""
                }
            case let .outputTranscript(text, finished):
                spoken += text
                if finished, !spoken.isEmpty {
                    lifecycle.append("Sotto: \(spoken)", request: request)
                    spoken = ""
                }
            case .interrupted:
                audio.flushPlayback()
            case let .closed(reason):
                if phase == .live, !reason.isEmpty {
                    errorMessage = "The live session ended: \(reason)"
                }
                finish()
            case let .failed(message):
                errorMessage = SottoLiveFailure.message(for: SottoAPIError.message(message))
                finish()
            }
        }
    }

    /// Ends the session and files the transcript, which is what feeds new
    /// vocabulary into the memory graph.
    private func finish() {
        let text = lifecycle.finish()
        startTask?.cancel()
        startTask = nil
        pump?.cancel()
        pump = nil
        audio.stop()
        let closingSession = session
        session = nil
        let credentials = model.credentials
        Task {
            await closingSession?.close()
            guard !text.isEmpty, model.credentials == credentials else { return }
            do { try await model.saveLiveSession(courseId: course.id, transcript: text) }
            catch { model.report(error) }
        }
    }

    private func requestMicrophoneAccess() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }
}

/// The token route answers a server without a Google key, or without Live
/// access on that key, with a 422 carrying the raw provider message. This
/// device pairs with a server and never configures one.
enum SottoLiveFailure {
    static func message(for error: Error) -> String {
        let raw = error.localizedDescription
        let lowered = raw.lowercased()
        if lowered.contains("google key") || lowered.contains("api key")
            || lowered.contains("live model") || lowered.contains("not configured") {
            return "Your Sotto server cannot run live translation yet. It needs a Google key with Gemini Live access, set up on the web app."
        }
        return raw
    }
}
