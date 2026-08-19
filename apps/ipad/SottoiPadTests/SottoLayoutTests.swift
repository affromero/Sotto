import SwiftUI
import XCTest

@testable import SottoiPad

final class SottoLayoutTests: XCTestCase {
    func testCompactSizeClassStacksAndDropsHandwriting() {
        let layout = SottoLayoutMode(.compact)

        XCTAssertEqual(layout, .compact)
        XCTAssertFalse(layout.supportsHandwriting)
        XCTAssertEqual(layout.gridColumns, 1)
    }

    func testRegularSizeClassKeepsPanelsAndHandwriting() {
        let layout = SottoLayoutMode(.regular)

        XCTAssertEqual(layout, .regular)
        XCTAssertTrue(layout.supportsHandwriting)
        XCTAssertEqual(layout.gridColumns, 2)
    }

    /// SwiftUI reports a nil size class before the first layout pass. Falling
    /// back to compact there would flash the phone layout on an iPad.
    func testUnknownSizeClassFallsBackToRegular() {
        XCTAssertEqual(SottoLayoutMode(nil), .regular)
    }

    func testCompactUsesTighterMarginsAndFullWidthReading() {
        let compact = SottoLayoutMode(.compact)
        let regular = SottoLayoutMode(.regular)

        XCTAssertLessThan(compact.pagePadding, regular.pagePadding)
        XCTAssertLessThan(compact.heroTitleSize, regular.heroTitleSize)
        XCTAssertEqual(compact.readableWidth, .infinity)
        XCTAssertLessThan(regular.readableWidth, .infinity)
    }
}
