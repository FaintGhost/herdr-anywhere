import XCTest
@testable import TailPocket

final class UnitTests: XCTestCase {
    func testKeys() {
        let key = TailPocket.newKey()
        XCTAssertTrue(key.hasPrefix("privkey:"))
        XCTAssertEqual(TailPocket.publicKey(for: key)?.hasPrefix("nodekey:"), true)
        XCTAssertNil(TailPocket.publicKey(for: "junk"))
    }

    func testDecodeInviteRejectsJunk() {
        XCTAssertThrowsError(try TailPocket.decodeInvite("tailpocket1:junk")) { error in
            XCTAssertEqual(error as? TailPocketError, TailPocketError(code: "invalid-invite"))
        }
    }

    func testPairRejectsExpiredInviteWithoutNetwork() async {
        let invite = TailPocketInvite(v: 1, address: "tcAAAA", port: 48932, key: TailPocket.newKey(),
                            proof: String(repeating: "A", count: 43), expiresAt: 1, name: nil)
        do {
            _ = try await TailPocket.pair(invite, phoneKey: TailPocket.newKey(), device: "test")
            XCTFail("paired")
        } catch {
            XCTAssertEqual(error as? TailPocketError, TailPocketError(code: "invalid-invite"))
        }
    }

    func testConnectRejectsBadLink() {
        let link = TailPocketHostLink(address: "nope", port: 1, name: "x", payload: nil, key: "k")
        XCTAssertThrowsError(try TailPocket.connect(link))
    }

    func testLinkRoundTripsThroughJSON() throws {
        let link = TailPocketHostLink(address: "tcX", port: 48931, name: "Mac", payload: "p", key: "privkey:x")
        let data = try JSONEncoder().encode(link)
        XCTAssertEqual(try JSONDecoder().decode(TailPocketHostLink.self, from: data), link)
    }

    func testScannedTextFilter() {
        XCTAssertEqual(TailPocket.inviteText(in: "  tailpocket1:abc \n", prefix: "tailpocket1:"), "tailpocket1:abc")
        XCTAssertEqual(TailPocket.inviteText(in: "myapp://pair?c=tailpocket1:abc", prefix: "tailpocket1:"), "tailpocket1:abc")
        XCTAssertNil(TailPocket.inviteText(in: "https://example.com", prefix: "tailpocket1:"))
    }
}
