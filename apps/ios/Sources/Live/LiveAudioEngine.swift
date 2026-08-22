import AVFoundation
import Foundation

/// Duplex audio for a live session: the microphone at 16 kHz going out, the
/// model's speech at 24 kHz coming back.
///
/// Both rates are fixed by the Live API. The hardware rarely runs at either, so
/// capture converts into 16 kHz mono Int16 and playback schedules 24 kHz
/// buffers on a player node, letting the engine resample on the way out.
final class LiveAudioEngine {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
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

    /// Mic in, speaker out, and keep working when the phone is on silent —
    /// a translation the learner cannot hear is useless.
    func activateSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothHFP])
        try session.setActive(true)
    }

    func start(onFrame: @escaping (String) -> Void) throws {
        self.onFrame = onFrame
        try activateSession()

        let input = engine.inputNode
        let hardwareFormat = input.outputFormat(forBus: 0)
        guard let captureFormat else {
            throw SottoAPIError.message("This device cannot record at the rate live translation needs.")
        }
        converter = AVAudioConverter(from: hardwareFormat, to: captureFormat)

        if let playbackFormat {
            engine.attach(player)
            engine.connect(player, to: engine.mainMixerNode, format: playbackFormat)
        }

        input.installTap(onBus: 0, bufferSize: 2048, format: hardwareFormat) { [weak self] buffer, _ in
            self?.handleCaptured(buffer)
        }

        engine.prepare()
        try engine.start()
        player.play()
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        player.stop()
        engine.stop()
        onFrame = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    /// The model was interrupted, so anything still queued is stale.
    func flushPlayback() {
        player.stop()
        player.play()
    }

    func enqueue(base64Pcm24k: String) {
        guard
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
