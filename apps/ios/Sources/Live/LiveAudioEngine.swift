import AVFoundation
import Foundation

/// Duplex audio for a live session: the microphone at 16 kHz going out, the
/// model's speech at 24 kHz coming back.
///
/// Both rates are fixed by the Live API. The hardware rarely runs at either, so
/// capture converts into 16 kHz mono Int16 and playback schedules 24 kHz
/// buffers on a player node, letting the engine resample on the way out.
final class LiveAudioEngine {
    private let makeEngine: () throws -> AVAudioEngine
    private let activateAudioSession: () throws -> AVAudioSession
    private let deactivateAudioSession: (AVAudioSession) throws -> Void
    private var engine: AVAudioEngine?
    private var player: AVAudioPlayerNode?
    private var tappedInput: AVAudioInputNode?
    private var activatedSession: AVAudioSession?
    private var converter: AVAudioConverter?
    private var onFrame: ((String) -> Void)?

    static let inputSampleRate: Double = 16_000
    static let outputSampleRate: Double = 24_000

    private lazy var captureFormat: AVAudioFormat? = AVAudioFormat(
        commonFormat: .pcmFormatInt16,
        sampleRate: Self.inputSampleRate,
        channels: 1,
        interleaved: true
    )

    private lazy var playbackFormat: AVAudioFormat? = AVAudioFormat(
        commonFormat: .pcmFormatInt16,
        sampleRate: Self.outputSampleRate,
        channels: 1,
        interleaved: true
    )

    init(
        makeEngine: @escaping () throws -> AVAudioEngine = { AVAudioEngine() },
        activateSession: (() throws -> AVAudioSession)? = nil,
        deactivateSession: ((AVAudioSession) throws -> Void)? = nil
    ) {
        self.makeEngine = makeEngine
        activateAudioSession = activateSession ?? Self.activateSession
        deactivateAudioSession = deactivateSession ?? {
            try $0.setActive(false, options: [.notifyOthersOnDeactivation])
        }
    }

    /// Mic in, speaker out, and keep working when the phone is on silent.
    /// A translation the learner cannot hear is useless.
    private static func activateSession() throws -> AVAudioSession {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothHFP])
        try session.setActive(true)
        return session
    }

    func start(onFrame: @escaping (String) -> Void) throws {
        guard engine == nil, activatedSession == nil else {
            throw SottoAPIError.message("Live audio is already running.")
        }
        self.onFrame = onFrame
        do {
            activatedSession = try activateAudioSession()
            let engine = try makeEngine()
            self.engine = engine
            let input = engine.inputNode
            let hardwareFormat = input.outputFormat(forBus: 0)
            guard hardwareFormat.sampleRate > 0, hardwareFormat.channelCount > 0,
                  let captureFormat,
                  let converter = AVAudioConverter(from: hardwareFormat, to: captureFormat) else {
                throw SottoAPIError.message("This device cannot record at the rate live translation needs.")
            }
            self.converter = converter
            let player = AVAudioPlayerNode()
            self.player = player
            if let playbackFormat {
                engine.attach(player)
                engine.connect(player, to: engine.mainMixerNode, format: playbackFormat)
            }
            input.installTap(onBus: 0, bufferSize: 2048, format: hardwareFormat) { [weak self] buffer, _ in
                self?.handleCaptured(buffer)
            }
            tappedInput = input
            engine.prepare()
            try engine.start()
            player.play()
        } catch {
            stop()
            throw error
        }
    }

    func stop() {
        tappedInput?.removeTap(onBus: 0)
        tappedInput = nil
        player?.stop()
        engine?.stop()
        player = nil
        engine = nil
        converter = nil
        onFrame = nil
        if let session = activatedSession {
            try? deactivateAudioSession(session)
            activatedSession = nil
        }
    }

    /// The model was interrupted, so anything still queued is stale.
    func flushPlayback() {
        guard let engine, engine.isRunning, let player else { return }
        player.stop()
        player.play()
    }

    func enqueue(base64Pcm24k: String) {
        guard
            let engine, engine.isRunning, let player,
            let data = Data(base64Encoded: base64Pcm24k),
            let playbackFormat,
            let buffer = Self.buffer(from: data, format: playbackFormat)
        else { return }

        player.scheduleBuffer(buffer, completionHandler: nil)
        if !player.isPlaying { player.play() }
    }

    private func handleCaptured(_ buffer: AVAudioPCMBuffer) {
        guard
            let converter,
            let captureFormat,
            let onFrame
        else { return }

        let ratio = captureFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1024
        guard let converted = AVAudioPCMBuffer(pcmFormat: captureFormat, frameCapacity: capacity) else {
            return
        }

        var consumed = false
        var conversionError: NSError?
        converter.convert(to: converted, error: &conversionError) { _, status in
            if consumed {
                status.pointee = .noDataNow
                return nil
            }
            consumed = true
            status.pointee = .haveData
            return buffer
        }

        guard conversionError == nil, converted.frameLength > 0 else { return }
        onFrame(Self.base64(from: converted))
    }

    static func base64(from buffer: AVAudioPCMBuffer) -> String {
        guard let channel = buffer.int16ChannelData else { return "" }
        let byteCount = Int(buffer.frameLength) * MemoryLayout<Int16>.size
        return Data(bytes: channel[0], count: byteCount).base64EncodedString()
    }

    static func buffer(from data: Data, format: AVAudioFormat) -> AVAudioPCMBuffer? {
        let frameCount = AVAudioFrameCount(data.count / MemoryLayout<Int16>.size)
        guard
            frameCount > 0,
            let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount),
            let channel = buffer.int16ChannelData
        else { return nil }

        buffer.frameLength = frameCount
        data.withUnsafeBytes { raw in
            guard let base = raw.bindMemory(to: Int16.self).baseAddress else { return }
            channel[0].update(from: base, count: Int(frameCount))
        }
        return buffer
    }
}
