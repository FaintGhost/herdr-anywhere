package com.longbridge.nsh;

import android.app.Activity;

/**
 * What NSH 0.3.0's AppActivity does that is package-private in nsh.aar: edge-to-edge system bars and the limits of a
 * standalone app (set in native code, so their values cannot be copied). It lives in NSH's package to reach them; a
 * newer nsh.aar that renames them fails the build here.
 */
public final class Standalone {
  private Standalone() {}

  public static void edgeToEdge(Activity activity) { DevActivity.edgeToEdge(activity); }

  public static void systemBars(Activity activity) { DevActivity.systemBars(activity); }

  public static void limits(NshView view) { view.useStandaloneLimits(); }
}
