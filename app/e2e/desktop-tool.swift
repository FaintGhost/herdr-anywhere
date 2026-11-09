// What the desktop e2e cannot do from a shell: read a screenshot and press inside one window.
//   scan <png>                 QR payloads as "qr <payload>", then the text it reads as "text <line>"
//   find <png> <text> [scale]  the middle of that text in the picture, in window points: x y (pixels per point, default 2)
//   click <pid> <x> <y>        a click at window points, delivered to that process only
//   hidclick <pid> <x> <y>     a click at window points through the window server, as a mouse makes it: the
//                              cursor moves there, rests, and the click goes to whatever is on top at that point
//   cursor                     where the cursor is on screen: x y
//   front                      the frontmost app's pid
//   key <pid> <keycode> [cmd-shift]   a key press, delivered to that process only
//   frame <pid>                the window's frame on screen: x y width height
//   locked                     exits 0 when the screen is locked
//   trusted                    whether macOS lets this program post events (Accessibility): yes or no
import AppKit
import Vision

func frame(_ pid: Int32) -> CGRect? {
  let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
  for w in list where (w[kCGWindowOwnerPID as String] as? Int32) == pid && (w[kCGWindowLayer as String] as? Int) == 0 {
    if let b = w[kCGWindowBounds as String] as? [String: CGFloat], let width = b["Width"], width > 100 {
      return CGRect(x: b["X"]!, y: b["Y"]!, width: width, height: b["Height"]!)
    }
  }
  return nil
}

let a = CommandLine.arguments
switch a[1] {
case "scan":
  guard let img = NSImage(contentsOfFile: a[2]), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { exit(2) }
  let qr = VNDetectBarcodesRequest(); qr.symbologies = [.qr]
  let text = VNRecognizeTextRequest(); text.recognitionLevel = .accurate
  // Text recognition sometimes fails on a busy machine; the script asks for another frame.
  let handler = VNImageRequestHandler(cgImage: cg)
  try? handler.perform([qr])
  try? handler.perform([text])
  for r in qr.results ?? [] { print("qr", r.payloadStringValue ?? "") }
  for r in text.results ?? [] { print("text", r.topCandidates(1).first?.string ?? "") }
case "find":
  guard let img = NSImage(contentsOfFile: a[2]), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { exit(2) }
  let text = VNRecognizeTextRequest(); text.recognitionLevel = .accurate
  try VNImageRequestHandler(cgImage: cg).perform([text])
  let scale = a.count > 4 ? Double(a[4])! : 2.0
  func put(_ b: CGRect) -> Never {  // Vision's origin is bottom left
    print(Int(b.midX * Double(cg.width) / scale), Int((1 - b.midY) * Double(cg.height) / scale))
    exit(0)
  }
  let lines = (text.results ?? []).compactMap { $0.topCandidates(1).first }
  for c in lines where c.string == a[3] { put((try? c.boundingBox(for: c.string.startIndex..<c.string.endIndex))?.boundingBox ?? .zero) }
  // Or the text as the last words of a line, where an icon beside it was read as a letter ("฿ Settings").
  for c in lines where c.string.hasSuffix(" " + a[3]) {
    if let r = c.string.range(of: a[3], options: .backwards), let b = try? c.boundingBox(for: r) { put(b.boundingBox) }
  }
  exit(1)
case "frame":
  guard let f = frame(Int32(a[2])!) else { exit(1) }
  print(Int(f.minX), Int(f.minY), Int(f.width), Int(f.height))
case "click":
  let pid = Int32(a[2])!
  guard let f = frame(pid) else { exit(1) }
  let p = CGPoint(x: f.minX + Double(a[3])!, y: f.minY + Double(a[4])!)
  CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)!.postToPid(pid)
  usleep(150_000)
  for t in [CGEventType.leftMouseDown, .leftMouseUp] {
    CGEvent(mouseEventSource: nil, mouseType: t, mouseCursorPosition: p, mouseButton: .left)!.postToPid(pid)
    usleep(60_000)
  }
case "hidclick":
  let pid = Int32(a[2])!
  guard let f = frame(pid) else { exit(1) }
  let p = CGPoint(x: f.minX + Double(a[3])!, y: f.minY + Double(a[4])!)
  // As a hand does it: the cursor comes in from a few points away and rests on the button before the press. A click
  // whose cursor jumped in from outside the window did nothing on CI's runner; one made with the cursor already in the
  // window worked.
  for d in [12.0, 6.0, 0.0] {
    let q = CGPoint(x: p.x - d, y: p.y)
    CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: q, mouseButton: .left)!.post(tap: .cghidEventTap)
    usleep(250_000)
  }
  usleep(500_000)
  for t in [CGEventType.leftMouseDown, .leftMouseUp] {
    CGEvent(mouseEventSource: nil, mouseType: t, mouseCursorPosition: p, mouseButton: .left)!.post(tap: .cghidEventTap)
    usleep(100_000)
  }
case "cursor":
  let p = CGEvent(source: nil)!.location
  print(Int(p.x), Int(p.y))
case "front":
  print(NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0)
case "key":
  let pid = Int32(a[2])!
  for down in [true, false] {
    let e = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(a[3])!, keyDown: down)!
    if a.count > 4 { e.flags = [.maskCommand, .maskShift] }
    e.postToPid(pid)
  }
case "locked":
  let session = CGSessionCopyCurrentDictionary() as? [String: Any] ?? [:]
  exit(session["CGSSessionScreenIsLocked"] != nil ? 0 : 1)
case "trusted":
  print(AXIsProcessTrusted() ? "yes" : "no")
default: exit(2)
}
