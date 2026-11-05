#if os(iOS) && canImport(VisionKit)
import SwiftUI
import VisionKit
import TailPocket

/// A camera view that reports the first QR code containing invite text. Needs
/// `NSCameraUsageDescription`; check `TailPocketQRScanner.isAvailable` first (iOS 16+, devices with a camera).
@available(iOS 16.0, *)
public struct TailPocketQRScanner: UIViewControllerRepresentable {
    public static var isAvailable: Bool { DataScannerViewController.isSupported && DataScannerViewController.isAvailable }

    private let prefix: String
    private let onInvite: (String) -> Void

    public init(prefix: String = TailPocket.defaultPrefix, onInvite: @escaping (String) -> Void) {
        self.prefix = prefix
        self.onInvite = onInvite
    }

    public func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced,
                                                isHighlightingEnabled: true)
        scanner.delegate = context.coordinator
        try? scanner.startScanning()
        return scanner
    }

    public func updateUIViewController(_ controller: DataScannerViewController, context: Context) {}

    public static func dismantleUIViewController(_ controller: DataScannerViewController, coordinator: Coordinator) {
        controller.stopScanning()
    }

    public func makeCoordinator() -> Coordinator { Coordinator(prefix: prefix, onInvite: onInvite) }

    public final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let prefix: String
        let onInvite: (String) -> Void
        var reported = false

        init(prefix: String, onInvite: @escaping (String) -> Void) { self.prefix = prefix; self.onInvite = onInvite }

        public func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            for item in items {
                guard !reported, case let .barcode(code) = item, let text = code.payloadStringValue,
                      let invite = TailPocket.inviteText(in: text, prefix: prefix) else { continue }
                reported = true
                onInvite(invite)
            }
        }
    }
}
#endif

#if os(iOS) && canImport(VisionKit)
@available(iOS 16.0, *)
extension TailPocketQRScanner {
    /// Presents the scanner full screen with a Cancel button and returns the first invite seen.
    /// Throws `unsupported` without a usable camera and `cancelled` when the person cancels.
    @MainActor
    public static func scan(from presenter: UIViewController?, prefix: String = TailPocket.defaultPrefix) async throws -> String {
        guard isAvailable, let presenter = presenter.map(topmost) else { throw TailPocketError(code: "unsupported") }
        return try await withCheckedThrowingContinuation { continuation in
            var done = false
            weak var shown: UIViewController?
            let finish: (Result<String, Error>) -> Void = { result in
                guard !done else { return }
                done = true
                shown?.dismiss(animated: true)
                continuation.resume(with: result)
            }
            let screen = NavigationView {
                TailPocketQRScanner(prefix: prefix) { finish(.success($0)) }
                    .ignoresSafeArea()
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { finish(.failure(TailPocketError(code: "cancelled"))) } } }
            }
            let controller = UIHostingController(rootView: screen)
            controller.modalPresentationStyle = .fullScreen
            shown = controller
            presenter.present(controller, animated: true)
        }
    }

    @MainActor
    private static func topmost(_ controller: UIViewController) -> UIViewController {
        var top = controller
        while let next = top.presentedViewController { top = next }
        return top
    }
}
#endif
