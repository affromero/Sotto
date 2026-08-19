import Foundation

/// A Gemini Live session, spoken directly over the wire.
///
/// The web client uses @google/genai; there is no Swift SDK, so this speaks the
/// v1alpha BidiGenerateContent protocol itself. The frame shapes here are taken
/// from the JS SDK's own wire format so the two clients stay interchangeable:
///
///   - ephemeral tokens (`auth_tokens/...`) connect to the *Constrained* method
///     and authenticate with `access_token=`, not `key=`
///   - the opening frame is `{"setup": {...}}`, with translation living at
///     `setup.generationConfig.translationConfig`
///   - microphone audio is `{"realtimeInput": {"audio": {data, mimeType}}}`
///   - the model answers with `serverContent`, whose `modelTurn.parts[]` carry
///     base64 24 kHz PCM and whose transcriptions carry the captions
///
/// The token is minted server-side and is single-use with a short TTL, so a
/// dropped connection needs a fresh one rather than a reconnect.
actor LiveTranslateSession {
    struct Token: Decodable, Equatable, Sendable {
        let token: String
        let model: String
        let apiVersion: String
        let targetLanguageCode: String
        let nativeLanguageCode: String
        let direction: String
        let expiresAt: String
    }

    enum Event: Sendable, Equatable {
        case opened
        /// Base64 24 kHz Int16 PCM from the model.
        case audio(String)
        case inputTranscript(String, finished: Bool)
        case outputTranscript(String, finished: Bool)
        /// The model was cut off; drop whatever is still queued for playback.
        case interrupted
        case closed(String)
        case failed(String)
    }

    private let token: Token
    private var task: URLSessionWebSocketTask?
    private var continuation: AsyncStream<Event>.Continuation?

    init(token: Token) {
        self.token = token
    }

    /// Ephemeral tokens are constrained at mint time, so the method name and the
    /// query parameter both differ from a plain API key.
    static func endpoint(for token: Token) -> URL? {
        let isEphemeral = token.token.hasPrefix("auth_tokens/")
        let method = isEphemeral ? "BidiGenerateContentConstrained" : "BidiGenerateContent"
        let parameter = isEphemeral ? "access_token" : "key"
        var components = URLComponents(
            string: "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.\(token.apiVersion).GenerativeService.\(method)"
        )
        components?.queryItems = [URLQueryItem(name: parameter, value: token.token)]
        return components?.url
    }

    /// The SDK qualifies bare model ids; the server rejects them otherwise.
    static func qualifiedModel(_ model: String) -> String {
        model.hasPrefix("models/") || model.hasPrefix("tunedModels/") ? model : "models/\(model)"
    }

    static func setupFrame(for token: Token) -> [String: Any] {
        [
            "setup": [
                "model": qualifiedModel(token.model),
                "generationConfig": [
                    "responseModalities": ["AUDIO"],
                    // Pure translation mode: the model only ever speaks back a
                    // translation. No affective dialog, no proactivity, so it
                    // never starts a conversation of its own.
                    "translationConfig": ["targetLanguageCode": token.targetLanguageCode],
                ],
                "inputAudioTranscription": [:],
                "outputAudioTranscription": [:],
            ],
        ]
    }

    static func audioFrame(base64Pcm16k: String) -> [String: Any] {
        [
            "realtimeInput": [
                "audio": ["data": base64Pcm16k, "mimeType": "audio/pcm;rate=16000"],
            ],
        ]
    }

    /// Decodes one server frame into the events the UI reacts to. Static and
    /// pure so the protocol handling is testable without a socket.
    static func events(from json: [String: Any]) -> [Event] {
        guard let content = json["serverContent"] as? [String: Any] else { return [] }
        var events: [Event] = []

        if content["interrupted"] as? Bool == true {
            events.append(.interrupted)
        }

        let parts = (content["modelTurn"] as? [String: Any])?["parts"] as? [[String: Any]] ?? []
        for part in parts {
            if let inline = part["inlineData"] as? [String: Any],
               let data = inline["data"] as? String, !data.isEmpty {
                events.append(.audio(data))
            }
        }

        if let input = content["inputTranscription"] as? [String: Any],
           let text = input["text"] as? String, !text.isEmpty {
            events.append(.inputTranscript(text, finished: input["finished"] as? Bool ?? false))
        }

        if let output = content["outputTranscription"] as? [String: Any],
           let text = output["text"] as? String, !text.isEmpty {
            events.append(.outputTranscript(text, finished: output["finished"] as? Bool ?? false))
        }

        return events
    }

    func open() -> AsyncStream<Event> {
        AsyncStream { continuation in
            self.continuation = continuation

            guard let url = Self.endpoint(for: token) else {
                continuation.yield(.failed("Could not build the live session address."))
                continuation.finish()
                return
            }

            let task = URLSession.shared.webSocketTask(with: url)
            self.task = task
            task.resume()

            Task { await self.start() }

            continuation.onTermination = { _ in
                Task { await self.close() }
            }
        }
    }

    private func start() async {
        do {
            try await send(Self.setupFrame(for: token))
            continuation?.yield(.opened)
            await receiveLoop()
        } catch {
            continuation?.yield(.failed(error.localizedDescription))
            continuation?.finish()
        }
    }

    private func receiveLoop() async {
        guard let task else { return }
        while true {
            do {
                let message = try await task.receive()
                let data: Data?
                switch message {
                case let .data(payload): data = payload
                case let .string(text): data = Data(text.utf8)
                @unknown default: data = nil
                }

                guard
                    let data,
                    let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                else { continue }

                for event in Self.events(from: json) {
                    continuation?.yield(event)
                }
            } catch {
                continuation?.yield(.closed(error.localizedDescription))
                continuation?.finish()
                return
            }
        }
    }

    func sendAudio(base64Pcm16k: String) async {
        try? await send(Self.audioFrame(base64Pcm16k: base64Pcm16k))
    }

    private func send(_ frame: [String: Any]) async throws {
        guard let task else { return }
        let data = try JSONSerialization.data(withJSONObject: frame)
        try await task.send(.string(String(decoding: data, as: UTF8.self)))
    }

    func close() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        continuation?.finish()
        continuation = nil
    }
}
