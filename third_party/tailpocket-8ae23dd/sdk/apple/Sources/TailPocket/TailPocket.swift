import Foundation
import TailPocketMobile

/// A pairing invite, decoded from a QR code, a link, or same-Wi-Fi delivery. Holding it lets a phone
/// pair until `expiresAt`, so do not log or share it.
public struct TailPocketInvite: Codable, Sendable, Equatable {
    public let v: Int
    public let address: String
    public let port: Int
    public let key: String
    public let proof: String
    public let expiresAt: Int64
    public let name: String?

    public init(v: Int, address: String, port: Int, key: String, proof: String, expiresAt: Int64, name: String?) {
        self.v = v; self.address = address; self.port = port; self.key = key; self.proof = proof
        self.expiresAt = expiresAt; self.name = name
    }

    /// The computer's name, as its app set it.
    public var hostName: String { name ?? "" }
}

/// Everything a paired phone needs to reach its computer. Contains the phone's private key: store it
/// in the Keychain (see `TailPocketKeychainStore`).
public struct TailPocketHostLink: Codable, Sendable, Equatable {
    public let address: String
    public let port: Int
    public let name: String
    /// What the computer's app sent along (a token, settings…), or nil.
    public let payload: String?
    public let key: String

    public init(address: String, port: Int, name: String, payload: String?, key: String) {
        self.address = address; self.port = port; self.name = name; self.payload = payload; self.key = key
    }
}

/// A failure with a fixed code: invalid-invite, invalid-key, invalid-link, expired, unauthorized,
/// taken, unreachable, denied, local-failed, cancelled, timeout, failed.
public struct TailPocketError: Error, Equatable, Sendable, CustomStringConvertible {
    public let code: String
    public init(code: String) { self.code = code }
    public var description: String { "TailPocketError(\(code))" }
}

/// An open route to the computer: point any HTTP or WebSocket client at `baseURL`.
public final class TailPocketConnection: @unchecked Sendable {
    public let port: Int
    private let handle: Int64
    private let lock = NSLock()
    private var closed = false

    init(handle: Int64, port: Int) { self.handle = handle; self.port = port }

    /// http://127.0.0.1:<port> — traffic continues to the computer inside the encrypted tunnel.
    public var baseURL: URL { URL(string: "http://127.0.0.1:\(port)")! }

    /// How the tunnel reaches the computer now: `["route": "direct"]`, `["route": "relay", "relay": code]`
    /// or `["route": "unknown"]`. Up to three seconds, off the caller's thread.
    public func path() async -> [String: String] {
        let handle = self.handle
        return await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .utility).async { continuation.resume(returning: Self.routeFields(ConnectmobilePath(handle))) }
        }
    }

    static func routeFields(_ text: String) -> [String: String] {
        struct Answer: Decodable { let route: String?; let relay: String? }
        guard let answer = try? JSONDecoder().decode(Answer.self, from: Data(text.utf8)), let route = answer.route else { return ["route": "unknown"] }
        if let relay = answer.relay, !relay.isEmpty { return ["route": route, "relay": relay] }
        return ["route": route]
    }

    public func close() {
        lock.lock(); defer { lock.unlock() }
        guard !closed else { return }
        closed = true
        ConnectmobileStop(handle)
    }

    deinit { close() }
}

public enum TailPocket {
    public static let defaultPrefix = "tailpocket1:"

    /// A new phone identity. Create it once and keep it (`TailPocketKeychainStore.phoneKey()` does both).
    public static func newKey() -> String { ConnectmobileNewKey() }

    /// The "nodekey:…" the computer lists for this phone, or nil for an invalid key.
    public static func publicKey(for key: String) -> String? {
        let p = ConnectmobilePublicKey(key)
        return p.isEmpty ? nil : p
    }

    /// Finds invite text inside scanned or pasted text (a bare code, or a link that contains it).
    public static func inviteText(in text: String, prefix: String = defaultPrefix) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let range = trimmed.range(of: prefix) else { return nil }
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
        let tail = trimmed[range.upperBound...].unicodeScalars.prefix { allowed.contains($0) }
        return tail.isEmpty ? nil : prefix + String(String.UnicodeScalarView(tail))
    }

    public static func decodeInvite(_ text: String, prefix: String = defaultPrefix) throws -> TailPocketInvite {
        try decode(ConnectmobileDecodeInvite(text, prefix))
    }

    /// Joins the computer's pairing window and returns the TailPocketHostLink to store. Cancelling the task cancels it.
    public static func pair(_ invite: TailPocketInvite, phoneKey: String, device: String, derpMapURL: String = "",
                            timeout: TimeInterval = 90) async throws -> TailPocketHostLink {
        let json = String(decoding: try JSONEncoder().encode(invite), as: UTF8.self)
        let op = Operation.next()
        return try await blocking(cancel: { ConnectmobileCancel(op) }) {
            ConnectmobilePair(op, json, phoneKey, device, derpMapURL, Int(timeout * 1000))
        }
    }

    /// Opens a local route to the computer. Nothing goes over the network until a client connects.
    public static func connect(_ link: TailPocketHostLink, derpMapURL: String = "") throws -> TailPocketConnection {
        let json = String(decoding: try JSONEncoder().encode(link), as: UTF8.self)
        struct Opened: Decodable { let handle: Int64; let port: Int }
        let opened: Opened = try decode(ConnectmobileConnect(json, derpMapURL))
        return TailPocketConnection(handle: opened.handle, port: opened.port)
    }

    // MARK: - plumbing

    struct Failure: Decodable { let error: String }

    static func decode<T: Decodable>(_ text: String) throws -> T {
        let data = Data(text.utf8)
        if let failure = try? JSONDecoder().decode(Failure.self, from: data) {
            throw TailPocketError(code: failure.error)
        }
        do { return try JSONDecoder().decode(T.self, from: data) } catch { throw TailPocketError(code: "failed") }
    }

    /// Runs a blocking Go call off the cooperative pool, cancelling it when the task is cancelled.
    static func blocking<T: Decodable>(cancel: @escaping @Sendable () -> Void, _ call: @escaping @Sendable () -> String) async throws -> T {
        try await withTaskCancellationHandler {
            let text: String = await withCheckedContinuation { continuation in
                DispatchQueue.global(qos: .userInitiated).async { continuation.resume(returning: call()) }
            }
            return try decode(text)
        } onCancel: {
            cancel()
        }
    }

    enum Operation {
        private static let lock = NSLock()
        private static var counter: Int64 = 0
        static func next() -> Int64 {
            lock.lock(); defer { lock.unlock() }
            counter += 1
            return counter
        }
    }
}
