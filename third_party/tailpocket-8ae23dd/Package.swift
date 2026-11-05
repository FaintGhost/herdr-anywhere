// swift-tools-version:5.10
import PackageDescription

// TailPocketMobile.xcframework comes from scripts/build-mobile.sh apple (a release attaches it as a zip; point
// the binaryTarget at that URL and checksum to consume this package remotely).
let package = Package(
    name: "TailPocket",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [
        .library(name: "TailPocket", targets: ["TailPocket"]),
        .library(name: "TailPocketUI", targets: ["TailPocketUI"]),
    ],
    targets: [
        .binaryTarget(name: "TailPocketMobile", path: "build/apple/TailPocketMobile.xcframework"),
        .target(name: "TailPocket", dependencies: ["TailPocketMobile"], path: "sdk/apple/Sources/TailPocket",
                linkerSettings: [.linkedFramework("Security"), .linkedFramework("Network"), .linkedLibrary("resolv")]),
        .target(name: "TailPocketUI", dependencies: ["TailPocket"], path: "sdk/apple/Sources/TailPocketUI"),
        .testTarget(name: "TailPocketTests", dependencies: ["TailPocket"], path: "sdk/apple/Tests/TailPocketTests"),
    ]
)
