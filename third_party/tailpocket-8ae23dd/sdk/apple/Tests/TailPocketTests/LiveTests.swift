#if os(macOS)
import XCTest
@testable import TailPocket

/// Real helper, real Tailcat relays, an HTTP server on the "computer". Opt in with TAILPOCKET_LIVE=1 after
/// scripts/build-host.sh.
final class LiveTests: XCTestCase {
    var helper: Helper!
    var web: Process!

    override func setUp() async throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["TAILPOCKET_LIVE"] == "1", "set TAILPOCKET_LIVE=1")
        let port = try startWeb()
        helper = try Helper(forward: "127.0.0.1:\(port)")
    }

    override func tearDown() {
        helper?.stop()
        web?.terminate()
    }

    func startWeb() throws -> Int {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tailPocket-web-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try "hello from the computer\n".write(to: dir.appendingPathComponent("hello.txt"), atomically: true, encoding: .utf8)
        let port = Int.random(in: 20000...40000)
        web = Process()
        web.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        web.arguments = ["-m", "http.server", "\(port)", "--bind", "127.0.0.1", "--directory", dir.path]
        web.standardOutput = FileHandle.nullDevice
        web.standardError = FileHandle.nullDevice
        try web.run()
        Thread.sleep(forTimeInterval: 1)
        return port
    }

    func fetchHello(_ link: TailPocketHostLink) async throws -> String {
        let connection = try TailPocket.connect(link)
        defer { connection.close() }
        var lastError: Error?
        for _ in 0..<6 {
            do {
                var request = URLRequest(url: connection.baseURL.appendingPathComponent("hello.txt"))
                request.timeoutInterval = 20
                let (data, _) = try await URLSession.shared.data(for: request)
                return String(decoding: data, as: UTF8.self)
            } catch { lastError = error }
        }
        throw lastError!
    }

    func testPairByQRAndFetchOverTheTunnel() async throws {
        let qr = try helper.pair(payload: "swift-token")
        let invite = try TailPocket.decodeInvite(qr)
        let key = TailPocket.newKey()
        let link = try await TailPocket.pair(invite, phoneKey: key, device: "swift phone")
        XCTAssertEqual(link.payload, "swift-token")
        let body = try await fetchHello(link)
        XCTAssertEqual(body, "hello from the computer\n")
    }

    /// Writes to the login keychain under a throwaway service and removes it again.
    func testKeychainStoreKeepsKeyAndLink() throws {
        let store = TailPocketKeychainStore(service: "tailPocket-test-\(UUID().uuidString)")
        defer { try? store.deleteLink(); try? store.deleteKey() }
        let key: String
        do { key = try store.phoneKey() } catch let error as TailPocketKeychainError where [-25308, -34018].contains(error.status) {
            // A locked keychain, or a process without keychain access (seen 2026-10-29 from a terminal session).
            throw XCTSkip("NOT TESTED HERE: keychain refused this process (\(error.status))")
        }
        XCTAssertNotNil(TailPocket.publicKey(for: key))
        XCTAssertEqual(try store.phoneKey(), key)
        XCTAssertNil(try store.link())
        let link = TailPocketHostLink(address: "fd7a:115c:a1e0::1", port: 48931, name: "Mac", payload: "p", key: "nodekey:x")
        try store.saveLink(link)
        XCTAssertEqual(try store.link(), link)
        try store.deleteLink()
        XCTAssertNil(try store.link())
    }

    func testBridgePairsAndConnects() async throws {
        let qr = try helper.pair(payload: "bridge-token")
        let bridge = TailPocketBridge(store: BridgeTests.MemoryStore(key: TailPocket.newKey()), emit: { _, _ in })
        let link = try await bridge.call("tailPocket.pair", ["invite": qr, "device": "swift bridge", "save": true]) as? [String: Any]
        XCTAssertEqual(link?["payload"] as? String, "bridge-token")
        let opened = try await bridge.call("tailPocket.connect", [:]) as? [String: Any]
        let base = try XCTUnwrap(opened?["baseUrl"] as? String)
        var body = ""
        for _ in 0..<6 where body.isEmpty {
            var request = URLRequest(url: URL(string: base + "/hello.txt")!)
            request.timeoutInterval = 20
            if let (data, _) = try? await URLSession.shared.data(for: request) { body = String(decoding: data, as: UTF8.self) }
        }
        XCTAssertEqual(body, "hello from the computer\n")
        _ = try await bridge.call("tailPocket.disconnect", ["handle": opened?["handle"] as Any])
    }

    func testPairOverSameWiFiWithNWBrowser() async throws {
        let qr = try helper.pair(payload: "")
        _ = qr
        let service = "_tailpocket-mac._tcp"
        helper.send(["cmd": "local", "id": helper.lastPairing, "service": service])
        var found: TailPocketNearbyHost?
        let deadline = Date().addingTimeInterval(20)
        for await hosts in TailPocketNearbyHosts.stream(service: service) {
            if let h = hosts.first(where: { $0.name == "swift host" }) { found = h; break }
            if Date() > deadline { break }
        }
        let host = try XCTUnwrap(found, "NWBrowser did not list the computer")
        let pending = try await TailPocketLocalPairing.begin(with: host, device: "swift wifi phone")
        let hostCode = try helper.waitEvent("localCode")
        XCTAssertEqual(hostCode["code"] as? String, pending.code)
        helper.send(["cmd": "confirm", "id": helper.lastPairing, "approve": true])
        let invite = try await pending.finish()
        let link = try await TailPocket.pair(invite, phoneKey: TailPocket.newKey(), device: "swift wifi phone")
        let body = try await fetchHello(link)
        XCTAssertEqual(body, "hello from the computer\n")
    }
}

/// Drives tailpocket-host over stdin/stdout. A background thread reads events and
/// acknowledges every save at once, as a real host app must.
final class Helper: @unchecked Sendable {
    let process = Process()
    let input = Pipe()
    let output = Pipe()
    var lastPairing = ""
    private var serial = 0
    private let lock = NSCondition()
    private var events: [[String: Any]] = []
    private var ended = false

    init(forward: String) throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../..").standardized
        #if arch(arm64)
        let arch = "arm64"
        #else
        let arch = "amd64"
        #endif
        process.executableURL = root.appendingPathComponent("sdk/node/bin/tailpocket-host-darwin-\(arch)")
        process.standardInput = input
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        try process.run()
        Thread { [self] in readLoop() }.start()
        send(["v": 1, "name": "swift host", "forward": forward])
        _ = try waitEvent("ready")
    }

    private func readLoop() {
        var buffer = Data()
        while true {
            let chunk = output.fileHandleForReading.availableData
            if chunk.isEmpty { break }
            buffer.append(chunk)
            while let newline = buffer.firstIndex(of: 0x0a) {
                let line = buffer[buffer.startIndex..<newline]
                buffer.removeSubrange(buffer.startIndex...newline)
                guard let event = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any] else { continue }
                if event["event"] as? String == "save" { send(["cmd": "saved", "id": event["id"]!, "ok": true]) }
                lock.lock(); events.append(event); lock.broadcast(); lock.unlock()
            }
        }
        lock.lock(); ended = true; lock.broadcast(); lock.unlock()
    }

    func send(_ value: [String: Any]) {
        var data = try! JSONSerialization.data(withJSONObject: value)
        data.append(0x0a)
        input.fileHandleForWriting.write(data)
    }

    func pair(payload: String) throws -> String {
        serial += 1
        lastPairing = "p\(serial)"
        send(["cmd": "pair", "id": lastPairing, "ttl": 180, "payload": payload])
        return try waitEvent("pairing")["qr"] as! String
    }

    /// Waits for the next event of `kind` (earlier events of other kinds are dropped).
    func waitEvent(_ kind: String, timeout: TimeInterval = 120) throws -> [String: Any] {
        let deadline = Date().addingTimeInterval(timeout)
        lock.lock(); defer { lock.unlock() }
        while true {
            while !events.isEmpty {
                let event = events.removeFirst()
                if event["event"] as? String == kind { return event }
                if event["event"] as? String == "error" { throw TailPocketError(code: "helper: \(event["code"] ?? "")") }
            }
            if ended || !lock.wait(until: deadline) { throw TailPocketError(code: "helper: no \(kind)") }
        }
    }

    func stop() {
        try? input.fileHandleForWriting.close()
        process.waitUntilExit()
    }
}
#endif
