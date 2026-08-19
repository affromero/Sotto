import XCTest

@testable import Sotto

final class MemoryGraphTests: XCTestCase {
    private func graph(from json: String) throws -> SottoMemoryGraph {
        try JSONDecoder().decode(SottoMemoryGraph.self, from: Data(json.utf8))
    }

    private let sample = """
    {
      "nodes": [
        {
          "id": "v1", "kind": "vocab", "label": "die Katze", "translation": "the cat",
          "strength": 0.9, "due": false, "createdAt": null, "updatedAt": null,
          "dueAt": null, "lastReviewed": null, "cefrLevel": "A1",
          "reviewCount": 5, "lapseCount": 0, "partOfSpeech": "noun", "pronunciation": null
        },
        {
          "id": "g1", "kind": "grammar", "label": "Dative case",
          "strength": 0.2, "due": true, "createdAt": null, "updatedAt": null,
          "dueAt": null, "lastReviewed": null, "cefrLevel": "A2",
          "reviewCount": 1, "lapseCount": 3, "topicKey": "dative"
        }
      ],
      "edges": [
        { "source": "v1", "target": "g1", "type": "RELATED", "weight": 1, "createdAt": null }
      ]
    }
    """

    func testGraphDecodesBothNodeKinds() throws {
        let graph = try graph(from: sample)

        XCTAssertEqual(graph.nodes.count, 2)
        XCTAssertTrue(graph.nodes.first?.isVocab == true)
        XCTAssertFalse(graph.nodes.last?.isVocab == true)
    }

    /// The list leads with what needs work, so the weakest item comes first.
    func testNodesSortWeakestFirst() throws {
        let graph = try graph(from: sample)

        XCTAssertEqual(graph.byStrength.first?.id, "g1")
    }

    func testDueNodesAreSelected() throws {
        let graph = try graph(from: sample)

        XCTAssertEqual(graph.dueNodes.map(\.id), ["g1"])
    }

    /// Vocabulary nodes carry a part of speech and grammar nodes carry a topic
    /// key; neither field appears on the other kind.
    func testOptionalPerKindFieldsDecode() throws {
        let graph = try graph(from: sample)
        let vocab = try XCTUnwrap(graph.nodes.first { $0.isVocab })
        let grammar = try XCTUnwrap(graph.nodes.first { !$0.isVocab })

        XCTAssertEqual(vocab.partOfSpeech, "noun")
        XCTAssertNil(vocab.topicKey)
        XCTAssertEqual(grammar.topicKey, "dative")
        XCTAssertNil(grammar.partOfSpeech)
    }

    func testEmptyGraphHasNothingDue() throws {
        let graph = try graph(from: #"{ "nodes": [], "edges": [] }"#)

        XCTAssertTrue(graph.dueNodes.isEmpty)
    }
}
