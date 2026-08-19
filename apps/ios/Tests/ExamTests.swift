import XCTest

@testable import Sotto

final class ExamTests: XCTestCase {
    private func decode<T: Decodable>(_ json: String, as type: T.Type) throws -> T {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }

    private func examJSON(sectionStatuses: [String]) -> String {
        let sections = sectionStatuses.enumerated().map { index, status in
            """
            {
              "id": "sec_\(index)",
              "skill": "READING",
              "part": "Part \(index + 1)",
              "order": \(index + 1),
              "format": "MCQ",
              "weight": 0.25,
              "status": "\(status)",
              "score": null,
              "episode": null,
              "questions": [],
              "speakingPrompts": [],
              "writingPrompts": []
            }
            """
        }.joined(separator: ",")

        return """
        {
          "id": "exam_1",
          "institution": "DELE",
          "institutionLabel": "Instituto Cervantes",
          "level": "B1",
          "status": "IN_PROGRESS",
          "examName": "DELE B1",
          "sections": [\(sections)],
          "result": null
        }
        """
    }

    func testCourseExamsDecodes() throws {
        let exams = try decode(
            """
            {
              "available": {
                "institution": "DELF",
                "institutionLabel": "France Education International",
                "examName": "DELF B2",
                "level": "B2",
                "sectionCount": 4
              },
              "history": [
                {
                  "id": "exam_9",
                  "examName": "DELF B2",
                  "level": "B2",
                  "status": "SCORED",
                  "band": "B2",
                  "overallScore": 0.71,
                  "createdAt": "2026-08-01T10:00:00.000Z"
                }
              ]
            }
            """,
            as: SottoCourseExams.self
        )

        XCTAssertEqual(exams.available.sectionCount, 4)
        XCTAssertEqual(exams.history.first?.band, "B2")
    }

    /// createMockExam is best-effort per section and never rethrows, so a
    /// server missing its model key still answers 201 with an exam whose
    /// sections all failed. The runner has to treat that as a broken exam
    /// rather than an empty one.
    func testExamWithEverySectionFailedIsRecognised() throws {
        let exam = try decode(examJSON(sectionStatuses: ["FAILED", "FAILED"]), as: SottoExamDetail.self)

        XCTAssertTrue(exam.allSectionsFailed)
    }

    func testExamWithOneFailedSectionStillRuns() throws {
        let exam = try decode(examJSON(sectionStatuses: ["READY", "FAILED"]), as: SottoExamDetail.self)

        XCTAssertFalse(exam.allSectionsFailed)
    }

    func testExamWithNoSectionsIsNotReportedAsFailed() throws {
        let exam = try decode(examJSON(sectionStatuses: []), as: SottoExamDetail.self)

        XCTAssertFalse(exam.allSectionsFailed)
    }

    /// The answer key only ships once the exam is scored.
    func testScoredQuestionCarriesAnswerKey() throws {
        let question = try decode(
            """
            {
              "id": "q1",
              "order": 1,
              "question": "Choisissez la bonne réponse.",
              "options": ["a", "b"],
              "passageRef": null,
              "passageText": null,
              "correctIndex": 1,
              "explanation": "Because b agrees."
            }
            """,
            as: SottoExamQuestion.self
        )

        XCTAssertEqual(question.correctIndex, 1)
    }

    func testUnscoredQuestionOmitsAnswerKey() throws {
        let question = try decode(
            """
            {
              "id": "q1",
              "order": 1,
              "question": "Choisissez la bonne réponse.",
              "options": ["a", "b"],
              "passageRef": null,
              "passageText": null
            }
            """,
            as: SottoExamQuestion.self
        )

        XCTAssertNil(question.correctIndex)
        XCTAssertNil(question.explanation)
    }

    func testSubmitResultDecodes() throws {
        let result = try decode(
            """
            {
              "overallScore": 0.66,
              "band": "B1",
              "feedback": "Solid reading, weaker listening.",
              "sections": [
                { "sectionId": "sec_0", "skill": "READING", "weight": 0.25, "score": 0.8 }
              ]
            }
            """,
            as: SottoExamScoreResult.self
        )

        XCTAssertEqual(result.band, "B1")
        XCTAssertEqual(result.sections.first?.score, 0.8)
    }
}
