// The app: one window showing the NSH app full screen, as `nsh package` builds it; the app keeps clear of the
// notch and home bar itself (safeAreaInsets). TailPocket answers the app's tailPocket.* host calls (src/tunnel.ts).
import NativeShell
import TailPocketNSH
import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    window = UIWindow(frame: UIScreen.main.bounds)
    window?.rootViewController = AppController()
    window?.makeKeyAndVisible()
    return true
  }
}

final class AppController: UIViewController {
  private let app = NshAppView()
  private var tailPocket: AnyObject?

  override func viewDidLoad() {
    super.viewDidLoad()
    app.frame = view.bounds
    app.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    app.onError = { message in NSLog("nsh error: %@", message) }
    view.addSubview(app)
    tailPocket = TailPocketNsh.attach(app)
    guard let url = Bundle.main.url(forResource: "bundle", withExtension: "nshc", subdirectory: "nsh") else {
      NSLog("nsh: no bundle in the app")
      return
    }
    do { try app.loadBundle(at: url) } catch { NSLog("nsh: cannot load: %@", "\(error)") }
  }

  override var preferredStatusBarStyle: UIStatusBarStyle { NshAppView.preferredStatusBarStyle }
  override var prefersStatusBarHidden: Bool { NshAppView.prefersStatusBarHidden }
  override var preferredStatusBarUpdateAnimation: UIStatusBarAnimation { NshAppView.preferredStatusBarUpdateAnimation }
}
