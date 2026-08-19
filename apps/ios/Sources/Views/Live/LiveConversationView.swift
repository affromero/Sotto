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
    @State private var phase: SessionPhase = .idle
    @State private var heard = ""
    @State private var spoken = ""
    @State private var transcript: [String] = []
    @State private var errorMessage: String?
    @State private var session: LiveTranslateSession?
    @State private var audio = LiveAudioEngine()
    @State private var pump: Task<Void, Never>?

    /// Named for the session, not the view: a nested `State` would shadow
    /// SwiftUI's property wrapper.
    enum SessionPhase: Equatable {
        case idle
        case connecting
        case live
    }

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

                    if !transcript.isEmpty {
                        SettingsCard(title: "This conversation") {
                            ForEach(Array(transcript.enumerated()), id: \.offset) { _, line in
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
                        Task { await finish() }
                        dismiss()
                    }
                }
            }
            .onDisappear { Task { await finish() } }
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
                Task { phase == .live ? await finish() : await begin() }
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

    private func begin() async {
        guard phase == .idle else { return }
        phase = .connecting
        errorMessage = nil
        heard = ""
        spoken = ""

        guard await requestMicrophoneAccess() else {
            errorMessage = "Sotto needs the microphone to translate what you say."
            phase = .idle
            return
        }

        do {
            let token = try await model.mintLiveToken(courseId: course.id, direction: direction)
            let session = LiveTranslateSession(token: token)
            self.session = session

            let events = await session.open()
            try audio.start { base64 in
                Task { await session.sendAudio(base64Pcm16k: base64) }
            }

            pump = Task { await consume(events) }
        } catch {
            errorMessage = SottoLiveFailure.message(for: error)
            phase = .idle
            audio.stop()
            self.session = nil
        }
    }

    private func consume(_ events: AsyncStream<LiveTranslateSession.Event>) async {
        for await event in events {
            switch event {
            case .opened:
                phase = .live
            case let .audio(base64):
                audio.enqueue(base64Pcm24k: base64)
            case let .inputTranscript(text, finished):
                heard += text
                if finished, !heard.isEmpty {
                    transcript.append("You: \(heard)")
                    heard = ""
                }
            case let .outputTranscript(text, finished):
                spoken += text
                if finished, !spoken.isEmpty {
                    transcript.append("Sotto: \(spoken)")
                    spoken = ""
                }
            case .interrupted:
                audio.flushPlayback()
            case let .closed(reason):
                if phase == .live, !reason.isEmpty {
                    errorMessage = "The live session ended: \(reason)"
                }
                await finish()
            case let .failed(message):
                errorMessage = SottoLiveFailure.message(for: SottoAPIError.message(message))
                await finish()
            }
        }
    }

    /// Ends the session and files the transcript, which is what feeds new
    /// vocabulary into the memory graph.
    private func finish() async {
        pump?.cancel()
        pump = nil
        audio.stop()
        await session?.close()
        session = nil
        phase = .idle

        let text = transcript.joined(separator: "\n")
        guard !text.isEmpty else { return }
        try? await model.saveLiveSession(courseId: course.id, transcript: String(text.prefix(20_000)))
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
