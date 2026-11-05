package io.jingtao.herdranywhere;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import com.longbridge.nsh.NshHostReply;
import com.longbridge.nsh.NshView;
import com.longbridge.nsh.Standalone;
import io.github.jtwang.tailpocket.TailPocketBridge;
import io.github.jtwang.tailpocket.nsh.TailPocketNsh;
import java.util.Collections;
import java.util.Map;
import kotlinx.coroutines.CoroutineScope;
import kotlinx.coroutines.CoroutineScopeKt;

/**
 * The app's screen: NSH's AppActivity (javap of nsh.aar 0.3.0), as a class of our own that can answer host calls.
 * TailPocket answers the app's tailPocket.* calls (src/tunnel.ts); this class answers the page.* calls of src/page.ts
 * that post the system's notifications, as web-host.js does in a browser. NSH 0.3.0 has no notification API of its
 * own, so there are no actions on them: a tap opens the pane, where the answer is.
 */
public class MainActivity extends Activity {
  /** A question or an approval: heads-up with sound. A finished agent: in the shade only, without sound. */
  private static final String NEEDS_YOU = "needs-you", FINISHED = "finished";
  private static final String TERMINAL = "terminal";
  private static final int ASK = 1;

  private NshView view;
  private final CoroutineScope scope = CoroutineScopeKt.MainScope();
  private TailPocketBridge tailPocket;
  private boolean front;
  /** A tapped notification's terminal, until the app is listening (it asks page.front once it starts). */
  private String opening;
  private NshHostReply asking;

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    Standalone.edgeToEdge(this);
    view = new NshView(this);
    Standalone.limits(view);
    setContentView(view);
    tailPocket = TailPocketNsh.INSTANCE.attach(view, scope);
    channels();
    opening = terminalOf(getIntent());
    view.handle("page.front", (data, reply) -> {
      reply.resolve(front);
      runOnUiThread(this::flushOpening);
    });
    view.handle("page.notify", (data, reply) -> reply.resolve(notify(data)));
    view.handle("page.notifications", (data, reply) -> reply.resolve(permission()));
    view.handle("page.allowNotifications", (data, reply) -> runOnUiThread(() -> allow(reply)));
    view.loadAssetBundle("nsh");
  }

  private void channels() {
    NotificationManager nm = getSystemService(NotificationManager.class);
    NotificationChannel needs = new NotificationChannel(NEEDS_YOU, getString(R.string.channel_needs_you), NotificationManager.IMPORTANCE_HIGH);
    needs.setDescription(getString(R.string.channel_needs_you_detail));
    NotificationChannel finished = new NotificationChannel(FINISHED, getString(R.string.channel_finished), NotificationManager.IMPORTANCE_LOW);
    finished.setDescription(getString(R.string.channel_finished_detail));
    nm.createNotificationChannel(needs);
    nm.createNotificationChannel(finished);
  }

  /** Posts one, only while the app is not in front (its toast shows otherwise). One per terminal: the newest replaces. */
  private boolean notify(Object data) {
    Map<?, ?> a = data instanceof Map ? (Map<?, ?>) data : Collections.emptyMap();
    if (front || !(a.get("title") instanceof String) || !"granted".equals(permission())) return false;
    String terminal = a.get(TERMINAL) instanceof String ? (String) a.get(TERMINAL) : "";
    String body = a.get("body") instanceof String ? (String) a.get("body") : null;
    boolean done = "done".equals(a.get("kind"));
    Intent tap = new Intent(this, MainActivity.class).putExtra(TERMINAL, terminal).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
    PendingIntent open = PendingIntent.getActivity(this, terminal.hashCode(), tap,
        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    Notification n = new Notification.Builder(this, done ? FINISHED : NEEDS_YOU)
        .setSmallIcon(R.drawable.ic_notify)
        .setContentTitle((String) a.get("title"))
        .setContentText(body)
        .setStyle(new Notification.BigTextStyle().bigText(body))
        .setCategory(done ? Notification.CATEGORY_STATUS : Notification.CATEGORY_MESSAGE)
        .setContentIntent(open)
        .setAutoCancel(true)
        .build();
    getSystemService(NotificationManager.class).notify(terminal, 1, n);
    return true;
  }

  /** The browser's words (src/page.ts Permission): Android 13+ asks once; before it, notifications are on unless turned off. */
  private String permission() {
    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      boolean asked = getPreferences(MODE_PRIVATE).getBoolean("asked", false);
      return !asked || shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS) ? "default" : "denied";
    }
    return getSystemService(NotificationManager.class).areNotificationsEnabled() ? "granted" : "denied";
  }

  private void allow(NshHostReply reply) {
    if (Build.VERSION.SDK_INT < 33 || !"default".equals(permission())) {
      reply.resolve(permission());
      return;
    }
    if (asking != null) asking.resolve(permission());
    asking = reply;
    getPreferences(MODE_PRIVATE).edit().putBoolean("asked", true).apply();
    requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, ASK);
  }

  @Override
  public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
    super.onRequestPermissionsResult(code, permissions, results);
    if (code == ASK && asking != null) {
      asking.resolve(permission());
      asking = null;
    }
  }

  private static String terminalOf(Intent intent) {
    String t = intent == null ? null : intent.getStringExtra(TERMINAL);
    return t == null || t.isEmpty() ? null : t;
  }

  private void flushOpening() {
    if (opening == null) return;
    view.send("page.open", Collections.singletonMap(TERMINAL, opening));
    opening = null;
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    String t = terminalOf(intent);
    if (t != null) view.send("page.open", Collections.singletonMap(TERMINAL, t));
  }

  @Override
  protected void onResume() {
    super.onResume();
    setFront(true);
  }

  @Override
  protected void onPause() {
    setFront(false);
    super.onPause();
  }

  private void setFront(boolean now) {
    if (front == now) return;
    front = now;
    view.send("page.front", Collections.singletonMap("front", now));
  }

  @Override
  public void onConfigurationChanged(Configuration config) {
    super.onConfigurationChanged(config);
    Standalone.systemBars(this);
  }

  @Override
  @SuppressWarnings("deprecation")
  public void onBackPressed() {
    if (!view.handleBack()) super.onBackPressed();
  }

  @Override
  protected void onDestroy() {
    tailPocket.close();
    CoroutineScopeKt.cancel(scope, null);
    view.destroy();
    super.onDestroy();
  }
}
