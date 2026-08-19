import Foundation

/// Exam and writing calls, split out of SottoAppModel to keep that file under
/// the repo's 1000-line limit. These are all thin pass-throughs: they resolve
/// the paired client and forward, with no state of their own.
extension SottoAppModel {
    // MARK: - Mock exams

    func fetchCourseExams(courseId: String) async throws -> SottoCourseExams {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before opening exams.")
        }
        return try await client.fetchCourseExams(courseId: courseId)
    }

    func startExam(courseId: String, level: String?) async throws -> String {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before starting an exam.")
        }
        return try await client.startExam(courseId: courseId, level: level)
    }

    func fetchExam(examId: String) async throws -> SottoExamDetail {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before opening an exam.")
        }
        return try await client.fetchExam(examId: examId)
    }

    func submitExam(examId: String, answers: [SottoSubmitAnswer]) async throws -> SottoExamScoreResult {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before submitting an exam.")
        }
        return try await client.submitExam(examId: examId, answers: answers)
    }

    func submitExamWriting(
        examId: String,
        promptId: String,
        text: String
    ) async throws -> SottoWritingGrade {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before submitting writing.")
        }
        return try await client.submitExamWriting(examId: examId, promptId: promptId, text: text)
    }

    func uploadExamSpeakingRecording(
        examId: String,
        promptId: String,
        audioURL: URL
    ) async throws -> SottoSpeakingUploadResponse {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before recording speaking feedback.")
        }
        return try await client.uploadExamSpeakingRecording(
            examId: examId,
            promptId: promptId,
            audioURL: audioURL
        )
    }

    func pollExamSpeakingRecording(
        examId: String,
        promptId: String,
        recordingId: String
    ) async throws -> SottoSpeakingPollResponse {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before recording speaking feedback.")
        }
        return try await client.pollExamSpeakingRecording(
            examId: examId,
            promptId: promptId,
            recordingId: recordingId
        )
    }

    func submitClassWriting(
        classId: String,
        promptId: String,
        text: String
    ) async throws -> SottoWritingGrade {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before submitting writing.")
        }
        return try await client.submitClassWriting(classId: classId, promptId: promptId, text: text)
    }

    func submitPracticeWriting(
        sessionId: String,
        promptId: String,
        text: String
    ) async throws -> SottoWritingGrade {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before submitting writing.")
        }
        return try await client.submitPracticeWriting(
            sessionId: sessionId,
            promptId: promptId,
            text: text
        )
    }
}
