import XCTest
// Run by e2e/ios-keyboard.sh. The menu's Type in the terminal brings the software keyboard up, on a fresh start and
// after the key bar's hide button put it away. Writes what it saw to $OUT (one line per step) as well as asserting.
final class TypeIn: XCTestCase {
  func test() {
    let out = ProcessInfo.processInfo.environment["OUT"] ?? "/tmp/typein.txt"
    var lines: [String] = []
    func note(_ s: String) { lines.append(s); try? (lines.joined(separator: "\n") + "\n").write(toFile: out, atomically: true, encoding: .utf8) }
    let app = XCUIApplication(bundleIdentifier: "io.jingtao.herdranywhere")
    app.activate()
    let el = { (id: String) in app.descendants(matching: .any)[id].firstMatch }
    let kbd = { app.keyboards.firstMatch.waitForExistence(timeout: 5) }
    func typeIn() {
      XCTAssertTrue(el("space-more").waitForExistence(timeout: 10), "no space-more")
      el("space-more").tap()
      let item = app.descendants(matching: .any)["Type in the terminal"].firstMatch
      XCTAssertTrue(item.waitForExistence(timeout: 5), "no Type in the terminal")
      item.tap()
    }
    XCTAssertTrue(el("space-spios").waitForExistence(timeout: 40), "home does not list the space")
    el("space-spios").tap()
    sleep(5)
    note("opened, keyboard up: \(app.keyboards.count > 0)")
    typeIn()
    let fresh = kbd(); note("type-in fresh, keyboard up: \(fresh)")
    if fresh {
      XCTAssertTrue(el("hide-keyboard").waitForExistence(timeout: 5), "no hide-keyboard")
      el("hide-keyboard").tap()
      sleep(2); note("after hide, keyboard up: \(app.keyboards.count > 0)")
      typeIn()
      let again = kbd(); note("type-in after hide, keyboard up: \(again)")
      XCTAssertTrue(again, "Type in the terminal after the hide button brings no keyboard")
    }
    XCTAssertTrue(fresh, "Type in the terminal brings no keyboard")
  }
}
