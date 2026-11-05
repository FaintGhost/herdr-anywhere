// What the desktop e2e cannot do from a shell: read a screenshot and press inside one window.
//   scan <png>                 QR payloads as "qr <payload>", then the text it reads as "text <line>"
//   find <png> <text>          the middle of that text in the picture, in window points: x y
//   click <pid> <x> <y>        a click at window points, delivered to that process only
//   key <pid> <keycode> [cmd-shift]   a key press, delivered to that process only
//   frame <pid>                the window's frame on screen: x y width height
//   locked                     exits 0 when the screen is locked
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
  for r in text.results ?? [] where r.topCandidates(1).first?.string == a[3] {
    let scale = 2.0, b = r.boundingBox  // screenshots are at 2x; Vision's origin is bottom left
    print(Int(b.midX * Double(cg.width) / scale), Int((1 - b.midY) * Double(cg.height) / scale))
    exit(0)
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
default: exit(2)
}
