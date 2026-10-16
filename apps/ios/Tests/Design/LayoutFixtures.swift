import SwiftUI
import UIKit

@testable import Sotto

enum LayoutFixtures {
    static let server = URL(string: "https://layout-fixture.example")!

    @MainActor
    static func model() -> SottoAppModel {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [LayoutFixtureHTTP.self]
        return SottoAppModel(
            credentials: SottoCredentials(
                serverURL: server, apiKey: "synthetic-layout-key", user: nil,
                selectedProfile: SottoProfile(
                    id: "layout-learner", name: "Synthetic learner", avatarUrl: "",
                    isOwner: true, role: "ADMIN", courseCount: nil,
                    primaryCourse: nil, isActive: nil
                )
            ),
            session: URLSession(configuration: configuration),
            credentialStore: LayoutFixtureCredentials()
        )
    }

    static func classDetail() throws -> SottoClassDetail {
        try JSONDecoder().decode(SottoClassDetail.self, from: Data(classJSON.utf8))
    }

    static func course() throws -> SottoCourse {
        try JSONDecoder().decode(SottoCourse.self, from: Data(
            #"{"id":"synthetic-layout-course","nativeLang":"es","targetLang":"de","currentLevel":"A2","startLevel":"A2","classes":[]}"#.utf8
        ))
    }

    static func practiceOverview() throws -> SottoPracticeOverview {
        try JSONDecoder().decode(SottoPracticeOverview.self, from: Data(
            #"{"due":{"vocab":4,"grammar":2},"totalVocab":40,"recent":[{"id":"synthetic-practice","kind":"FULL","status":"ACTIVE","score":null,"startedAt":null,"completedAt":null}]}"#.utf8
        ))
    }

    static func readyPractice() throws -> SottoPracticeStart {
        try JSONDecoder().decode(SottoPracticeStart.self, from: Data(
            #"{"status":"ready_full","sessionId":"synthetic-ready-practice","kind":"FULL","items":[],"speakingPrompts":[],"writingPrompts":[]}"#.utf8
        ))
    }

    static let classJSON = #"""
    {
      "id":"synthetic-layout-class","courseId":"synthetic-layout-course",
      "status":"AVAILABLE","order":2,"attempt":1,"passThreshold":0.7,
      "submitted":false,"sourceTitle":"A learner's notes about travel and everyday plans",
      "lesson":{"title":"Talking about yesterday and making plans together",
        "level":"A2","objective":"Describe a completed journey and explain the next plan clearly."},
      "intro":{
        "purpose":"Learn to connect past events with a clear plan for tomorrow.",
        "about":"Compare the examples, read the short explanation, then answer each section.",
        "focus":["Choose the helping verb that matches the action.","Keep the important event at the end of the sentence."],
        "examples":[{"target":"Gestern bin ich mit dem Zug nach Berlin gefahren.",
          "meaning":"Yesterday I travelled to Berlin by train.",
          "note":"Movement to a destination uses sein in this example."}],
        "tips":["Read the complete sentence before choosing."],
        "visuals":{
          "timeline":{"title":"Connect the events","steps":["Yesterday: the journey","Today: the explanation","Tomorrow: the next plan"]},
          "contrast":{"title":"Compare the helping verbs","leftLabel":"Movement",
            "leftItems":["Ich bin nach Berlin gefahren."],"rightLabel":"An activity",
            "rightItems":["Ich habe einen Brief geschrieben."]},
          "callouts":[{"label":"Remember the meaning","text":"The helping verb and the final verb belong together.","tone":"teal"}],
          "links":[]}
      },
      "sections":[
        {"id":"layout-grammar","skill":"GRAMMAR","status":"AVAILABLE","attempt":1,
         "questions":[{"id":"layout-choice","order":0,
           "question":"Gestern ___ ich mit meiner Freundin nach Berlin gefahren.",
           "options":["bin","habe","werde","hatte"]}],"prompts":[],"writingPrompts":[]},
        {"id":"layout-reading","skill":"READING","status":"AVAILABLE","attempt":1,
         "questions":[{"id":"layout-reading-choice","order":0,
           "question":"How did Lea travel to Berlin?",
           "passageRef":"layout-reading-passage",
           "passageText":"Gestern ist Lea mit dem Zug nach Berlin gefahren. Heute schreibt sie ihrer Freundin einen Brief. Morgen besuchen sie gemeinsam ein Museum.",
           "options":["By train","By bicycle","By bus","On foot"]}],
         "prompts":[],"writingPrompts":[]},
        {"id":"layout-listening","skill":"LISTENING","status":"AVAILABLE","attempt":1,
         "questions":[],"prompts":[],"writingPrompts":[]},
        {"id":"layout-speaking","skill":"SPEAKING","status":"AVAILABLE","attempt":1,
         "questions":[],"prompts":[{"id":"layout-speaking-prompt","order":0,
           "targetPhrase":"Gestern bin ich mit dem Zug nach Berlin gefahren.",
           "translation":"Yesterday I travelled to Berlin by train."}],"writingPrompts":[]},
        {"id":"layout-writing","skill":"WRITING","status":"AVAILABLE","attempt":1,
         "questions":[],"prompts":[],"writingPrompts":[{
           "id":"layout-writing-prompt","order":0,
           "task":"Translate into German: Yesterday I travelled to Berlin by train.",
           "guidance":"Preserve the destination and the time. Choose the correct helping verb.","responses":[]}]}
      ]
    }
    """#
}

private final class LayoutFixtureCredentials: SottoCredentialPersistence {
    private var saved: SottoCredentials?
    func load() throws -> SottoCredentials? { saved }
    func save(_ credentials: SottoCredentials) throws { saved = credentials }
    func delete() throws { saved = nil }
}

private final class LayoutFixtureHTTP: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url else { return }
        let body: String
        let status: Int
        switch (request.httpMethod ?? "GET", url.path) {
        case ("GET", "/api/v1/users/me"):
            status = 200
            body = #"{"id":"layout-learner","name":"Synthetic learner","role":"ADMIN","image":null,"preferredLanguage":"English","preferredAiModel":null,"preferredTtsModel":"Fish Audio s2.1-pro-free","preferredSttModel":"Local Whisper small (CPU)","showAgentUsageStatus":true}"#
        case ("GET", "/api/v1/ai-models"):
            status = 200
            body = #"{"models":[]}"#
        case ("GET", "/api/v1/courses"):
            status = 200
            body = #"{"courses":[]}"#
        case ("PATCH", "/api/v1/classes/synthetic-layout-class"):
            status = 200
            body = #"{"progressRevision":1}"#
        case ("GET", "/api/v1/practice/synthetic-attempt"):
            status = 200
            body = #"{"status":"ready","sessionId":"synthetic-attempt","kind":"VOCAB","items":[]}"#
        default:
            status = 404
            body = #"{"error":"No live service exists in the layout fixture."}"#
        }
        let response = HTTPURLResponse(
            url: url, statusCode: status, httpVersion: nil,
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
