import Foundation

extension PlayCoordinator {
    func loadPhrases(older: Bool = false) async throws {
        guard let connection = model?.credentials else { return }
        let generation = epoch
        let cursor = older ? phrasesCursor : nil
        let query = try cursor.map { "?beforeId=\(try SottoAPIClient.playID($0))" } ?? ""
        do {
            let result: PlayPhraseList = try await client(connection).play("/api/v1/play/phrases\(query)")
            try requireCurrent(generation, connection: connection)
            phrases = older ? phrases + result.phrases.filter { value in !phrases.contains(where: { $0.id == value.id }) } : result.phrases
            phrasesCursor = result.nextCursor
        } catch { try handleMemberFailure(error, generation: generation, connection: connection) }
    }

    func loadOlderRooms() async throws {
        guard let connection = model?.credentials, let cursor = roomsCursor else { return }
        let generation = epoch
        let result: PlayRoomList = try await client(connection).play("/api/v1/play/rooms?beforeId=\(SottoAPIClient.playID(cursor))")
        try requireCurrent(generation, connection: connection)
        let added = result.rooms.filter { value in !rooms.contains(where: { $0.id == value.id }) }
        olderRooms += added
        rooms += added
        openedOlderRooms = true
        roomsCursor = result.nextCursor
    }

    func keep(text: String, context: String, kind: PlayPhraseKind, round: PlayRound) async throws {
        guard let room, [room.round].compactMap({ $0 }).contains(where: { $0.id == round.id })
                || room.completedRounds.contains(where: { $0.id == round.id }) else { return }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 500,
              round.visibleTexts.contains(where: { $0.contains(trimmed) }) else {
            throw SottoAPIError.message("Choose a word or sentence from the visible game text.")
        }
        struct Body: Encodable {
            let roomId: String; let roundId: String; let kind: PlayPhraseKind
            let text: String; let contextText: String?
            enum CodingKeys: String, CodingKey { case roomId, roundId, kind, text, contextText }
            func encode(to encoder: Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                try container.encode(roomId, forKey: .roomId)
                try container.encode(roundId, forKey: .roundId)
                try container.encode(kind, forKey: .kind)
                try container.encode(text, forKey: .text)
                try container.encode(contextText, forKey: .contextText)
            }
        }
        try await operation(path: "/api/v1/play/phrases",
            body: Body(roomId: room.id, roundId: round.id, kind: kind, text: trimmed,
                contextText: context.isEmpty ? nil : context), response: .phrase)
    }

    func studyCourses() async throws -> [SottoCourse] {
        guard let connection = model?.credentials else { return [] }
        let generation = epoch
        let result = try await client(connection).listCourses()
        try requireCurrent(generation, connection: connection)
        return result
    }

    func addToStudy(_ phrase: PlayPhrase, course: SottoCourse) async throws {
        guard course.targetLang == phrase.targetLang, let connection = model?.credentials else { return }
        let generation = epoch
        let api = client(connection)
        let courses = try await api.listCourses()
        try requireCurrent(generation, connection: connection)
        guard courses.contains(where: { $0.id == course.id && $0.targetLang == phrase.targetLang }) else {
            throw SottoAPIError.message("Choose one of your courses in this language.")
        }
        struct Body: Encodable {
            let text: String; let kind: PlayPhraseKind; let contextText: String?
            let sourceType = "MANUAL"; let sourceId: String; let sourceLabel = "Partner play"
        }
        struct Saved: Decodable { let id: String; let text: String }
        var request = try api.makeRequest(path: "/api/v1/courses/\(SottoAPIClient.playID(course.id))/learning-targets",
            method: "POST", authorized: true)
        request.httpShouldHandleCookies = false
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.httpBody = try JSONEncoder().encode(Body(text: phrase.text, kind: phrase.kind,
            contextText: phrase.contextText, sourceId: phrase.id))
        let _: Saved = try await api.send(request, acceptedStatuses: [200, 201], policy: .play)
        try requireCurrent(generation, connection: connection)
        notice = "Added to study."
    }
}
