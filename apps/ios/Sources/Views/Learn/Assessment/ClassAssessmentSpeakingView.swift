import AVFoundation
import SwiftUI

struct ClassAssessmentSpeakingView: View {
    @Environment(\.scenePhase) private var scenePhase
    let client: SottoAPIClient
    let classId: String
    let attempt: Int
    let assessmentId: String
    let revision: String
    let promptId: String
    let allowed: () -> Bool
    let onRecording: (Bool) -> Void
    let onChanged: () -> Void

    @State private var recorder: AVAudioRecorder?
    @State private var timeout: Task<Void, Never>?
    @State private var saved: RetainedAssessmentSpeaking?
    @State private var hasCapture = false
    @State private var response: SottoClassAssessmentSpeakingStatus?
    @State private var busy = false
    @State private var visible = false
    @State private var message: String?
    @State private var confirmDiscard = false
    @State private var confirmSuperseded = false

    private func store() throws -> AssessmentSpeakingStore {
        try AssessmentSpeakingStore(client: client, classId: classId, classAttempt: attempt,
                                    assessmentId: assessmentId, revision: revision, promptId: promptId)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let message { Text(message).foregroundStyle(.red) }
            if recorder != nil {
                Button("Stop recording") { stop() }.buttonStyle(SottoPrimaryButtonStyle())
            } else if saved != nil {
                Button("Send saved recording") { Task { await send() } }
                    .buttonStyle(SottoPrimaryButtonStyle()).disabled(busy || !allowed())
                if response?.status == .failed,
                   response?.requestId?.lowercased() == saved?.requestId.uuidString.lowercased() {
                    Button("Discard failed recording", role: .destructive) { confirmDiscard = true }.disabled(busy)
                }
                if response?.status == .completed,
                   response?.requestId?.lowercased() != saved?.requestId.uuidString.lowercased() {
                    Text("A different response is already complete. Save this local recording if you want to keep it.")
                    Button("Discard local recording", role: .destructive) { confirmSuperseded = true }.disabled(busy)
                }
            } else if hasCapture {
                Button("Use saved recording") { recover() }
                    .buttonStyle(SottoPrimaryButtonStyle()).disabled(busy || !allowed())
            } else if response?.status == .completed {
                Text("Speaking response saved.")
            } else if response?.status == .running || response?.status == .unresolved {
                Text("Check the saved speaking response before continuing.")
            } else {
                Button("Record") { Task { await start() } }
                    .buttonStyle(SottoPrimaryButtonStyle()).disabled(busy || !allowed() || response == nil)
            }
            Button("Check saved speaking") { Task { await check() } }.disabled(busy || !allowed())
        }
        .task { visible = true; await check() }
        .onDisappear { visible = false; stop() }
        .onChange(of: scenePhase) { _, phase in if phase != .active { stop() } }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { notification in
            if let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
               AVAudioSession.InterruptionType(rawValue: raw) == .began { stop() }
        }
        .confirmationDialog("Discard this failed recording?", isPresented: $confirmDiscard) {
            Button("Discard recording", role: .destructive) { Task { await discard(superseded: false) } }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Save a copy first if you want to keep it.") }
        .confirmationDialog("Discard this local recording?", isPresented: $confirmSuperseded) {
            Button("Discard recording", role: .destructive) { Task { await discard(superseded: true) } }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Another response is complete. Save this recording first if you want to keep it.") }
    }

    private func currentAssessment() async throws {
        guard visible, allowed() else { throw CancellationError() }
        let status = try await client.fetchClassAssessmentStatus(classId: classId, attempt: attempt)
        guard visible, allowed(), status.status == .ready, status.assessmentId == assessmentId,
              status.revision == revision else {
            throw SottoAPIError.message("The assessment changed. Check its saved status.")
        }
    }

    private func check() async {
        guard !busy, visible, allowed() else { return }
        busy = true
        defer { busy = false }
        do {
            let local = try store().load()
            hasCapture = try store().recoverCapture() != nil
            saved = local
            try await currentAssessment()
            let status = try await client.fetchAssessmentSpeaking(classId: classId, assessmentId: assessmentId, promptId: promptId)
            guard visible, allowed() else { return }
            if let local, status.status == .completed,
               status.requestId?.lowercased() == local.requestId.uuidString.lowercased() {
                try await currentAssessment()
                try store().clearConfirmed(local, status: status)
                saved = nil
                onChanged()
            } else {
                saved = local
            }
            response = status
            message = nil
        } catch {
            if visible && allowed() { message = error.localizedDescription }
        }
    }

    private func recover() {
        guard visible, allowed() else { return }
        do {
            saved = try store().finishCapture()
            message = nil
            onChanged()
        } catch { message = error.localizedDescription }
    }

    private func start() async {
        guard !busy, visible, allowed() else { return }
        busy = true
        defer { busy = false }
        do {
            try await currentAssessment()
            let status = try await client.fetchAssessmentSpeaking(classId: classId, assessmentId: assessmentId, promptId: promptId)
            guard visible, allowed(), [.notStarted, .failed].contains(status.status), try store().load() == nil else {
                throw SottoAPIError.message("Check the saved speaking response before recording.")
            }
            let granted = await withCheckedContinuation { continuation in
                AVAudioApplication.requestRecordPermission { continuation.resume(returning: $0) }
            }
            guard granted else { throw SottoAPIError.message("Microphone access is required to record.") }
            try await currentAssessment()
            let confirmed = try await client.fetchAssessmentSpeaking(classId: classId, assessmentId: assessmentId, promptId: promptId)
            guard visible, allowed(), [.notStarted, .failed].contains(confirmed.status) else {
                throw SottoAPIError.message("The speaking response changed. Check its saved status.")
            }
            guard try ClassAssessmentWorkStore.pending(client: client, classId: classId, classAttempt: attempt).isEmpty else {
                throw SottoAPIError.message("An assessment submission needs recovery before recording.")
            }
            let local = try store()
            let url = try local.beginCapture()
            do {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.defaultToSpeaker, .allowBluetoothHFP])
                try session.setActive(true)
                let settings: [String: Any] = [AVFormatIDKey: Int(kAudioFormatLinearPCM), AVSampleRateKey: 16_000,
                                               AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 16,
                                               AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false]
                let next = try AVAudioRecorder(url: url, settings: settings)
                guard next.record(forDuration: 240) else { throw SottoAPIError.message("Recording could not start.") }
                recorder = next
                onRecording(true)
                message = nil
                timeout = Task { @MainActor in
                    do { try await Task.sleep(for: .seconds(240)) } catch { return }
                    stop()
                }
            } catch {
                local.endCapture()
                onChanged()
                throw error
            }
        } catch { if visible && allowed() { message = error.localizedDescription } }
    }

    private func stop() {
        guard let recorder else { return }
        recorder.stop()
        self.recorder = nil
        timeout?.cancel()
        timeout = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        do {
            let local = try store()
            local.endCapture()
            saved = try local.finishCapture()
            message = nil
        } catch { message = "Your recording is saved locally. \(error.localizedDescription)" }
        onRecording(false)
        onChanged()
    }

    private func send() async {
        guard !busy, let saved, visible, allowed() else { return }
        busy = true
        defer { busy = false }
        do {
            try await currentAssessment()
            let status = try await client.fetchAssessmentSpeaking(classId: classId, assessmentId: assessmentId, promptId: promptId)
            guard visible, allowed() else { return }
            if status.status == .completed || status.status == .running || status.status == .unresolved {
                response = status
                guard status.requestId?.lowercased() == saved.requestId.uuidString.lowercased() else {
                    throw SottoAPIError.message("Another recording is saved for this task. Keep your local copy.")
                }
                if status.status == .completed {
                    try await currentAssessment()
                    try store().clearConfirmed(saved, status: status)
                    self.saved = nil
                    onChanged()
                }
                return
            }
            if status.status == .failed, status.requestId?.lowercased() == saved.requestId.uuidString.lowercased() {
                response = status
                return
            }
            response = try await client.uploadAssessmentSpeaking(classId: classId, assessmentId: assessmentId,
                                                                   promptId: promptId, recording: saved)
            guard visible, allowed() else { return }
            message = "Recording saved. Check its status before continuing."
            onChanged()
        } catch { if visible && allowed() { message = error.localizedDescription } }
    }

    private func discard(superseded: Bool) async {
        guard !busy, visible, allowed(), let saved, let expected = response else { return }
        busy = true
        defer { busy = false }
        do {
            try await currentAssessment()
            let checked = try await client.fetchAssessmentSpeaking(classId: classId, assessmentId: assessmentId, promptId: promptId)
            guard checked == expected else { throw SottoAPIError.message("The saved speaking response changed. Check its status again.") }
            try await currentAssessment()
            if superseded {
                try store().discardSuperseded(saved, status: checked)
            } else {
                try store().discardConfirmedFailure(saved, status: checked)
            }
            self.saved = nil
            onChanged()
        } catch { if visible && allowed() { message = error.localizedDescription } }
    }
}
