package io.jingtao.herdranywhere;

import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import com.longbridge.nsh.NshHostReply;
import com.longbridge.nsh.NshView;
import com.longbridge.nsh.Standalone;
import io.github.jtwang.tailpocket.TailPocketBridge;
import io.github.jtwang.tailpocket.nsh.TailPocketNsh;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import kotlinx.coroutines.CoroutineScope;
import kotlinx.coroutines.CoroutineScopeKt;

/**
 * The app's screen: NSH's AppActivity (javap of nsh.aar 0.3.0), as a class of our own that can answer host calls.
 * TailPocket answers the app's tailPocket.* calls (src/tunnel.ts); this class answers the page.* calls of src/page.ts
 * that post the system's notifications, as web-host.js does in a browser. NSH 0.3.0 has no notification API of its
 * own, so there are no actions on them: a tap opens the pane, where the answer is. It also answers page.pickFiles and
 * page.uploadFile (src/link.ts): NSH 0.3.0 has a picker for photos and none for other files.
 */
public class MainActivity extends Activity {
  /** A question or an approval: heads-up with sound. A finished agent: in the shade only, without sound. */
  private static final String NEEDS_YOU = "needs-you", FINISHED = "finished";
  private static final String TERMINAL = "terminal";
  private static final int ASK = 1, PICK = 2;

  private NshView view;
  private final CoroutineScope scope = CoroutineScopeKt.MainScope();
  private TailPocketBridge tailPocket;
  private boolean front;
  /** A tapped notification's terminal, until the app is listening (it asks page.front once it starts). */
  private String opening;
  private NshHostReply asking, picking;
  private int pickLimit = 9;
  private boolean keepAlive;

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
    view.handle("page.pickFiles", (data, reply) -> runOnUiThread(() -> pickFiles(data, reply)));
    view.handle("page.uploadFile", this::uploadFile);
    view.handle("page.keepAlive", (data, reply) -> runOnUiThread(() -> {
      keepAlive = data instanceof Map && Boolean.TRUE.equals(((Map<?, ?>) data).get("on"));
      applyKeepAlive();
      reply.resolve(keepAlive);
    }));
    view.handle("page.focusTerminal", (data, reply) -> runOnUiThread(() -> {
      WebView web = webViewIn(view);
      reply.resolve(web != null && web.requestFocus());
    }));
    view.loadAssetBundle("nsh");
  }

  /** Android lets an app start a foreground service only while it is on screen; onResume starts it if it couldn't. */
  private void applyKeepAlive() {
    Intent service = new Intent(this, KeepAlive.class);
    if (!keepAlive) { stopService(service); return; }
    if (!front) return;
    try { startForegroundService(service); } catch (RuntimeException e) { Log.w("HerdrAnywhere", "no foreground service: " + e); }
  }

  /** The shown terminal's page. A phone shows one at a time. */
  private static WebView webViewIn(View v) {
    if (v instanceof WebView && v.isShown()) return (WebView) v;
    if (!(v instanceof ViewGroup)) return null;
    ViewGroup g = (ViewGroup) v;
    for (int i = 0; i < g.getChildCount(); i++) { WebView w = webViewIn(g.getChildAt(i)); if (w != null) return w; }
    return null;
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

  private void pickFiles(Object data, NshHostReply reply) {
    if (picking != null) picking.resolve(Collections.emptyList());
    picking = reply;
    Map<?, ?> a = data instanceof Map ? (Map<?, ?>) data : Collections.emptyMap();
    if (a.get("limit") instanceof Number) pickLimit = ((Number) a.get("limit")).intValue();
    startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
        .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true), PICK);
  }

  @Override
  protected void onActivityResult(int code, int result, Intent data) {
    super.onActivityResult(code, result, data);
    if (code != PICK || picking == null) return;
    NshHostReply reply = picking;
    picking = null;
    List<Uri> uris = new ArrayList<>();
    if (result == RESULT_OK && data != null) {
      ClipData many = data.getClipData();
      if (many != null) for (int i = 0; i < many.getItemCount(); i++) uris.add(many.getItemAt(i).getUri());
      else if (data.getData() != null) uris.add(data.getData());
    }
    List<Map<String, Object>> files = new ArrayList<>();
    for (Uri uri : uris.subList(0, Math.min(pickLimit, uris.size()))) files.add(describe(uri));
    reply.resolve(files);
  }

  /** The id page.uploadFile sends it by (its URI), its name and its size; -1 when the provider doesn't say. */
  private Map<String, Object> describe(Uri uri) {
    Map<String, Object> file = new HashMap<>();
    file.put("id", uri.toString());
    file.put("name", "file");
    file.put("size", -1L);
    try (Cursor c = getContentResolver().query(uri, new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
      if (c != null && c.moveToFirst()) {
        if (!c.isNull(0)) file.put("name", c.getString(0));
        if (!c.isNull(1)) file.put("size", c.getLong(1));
      }
    }
    return file;
  }

  /** Streams the picked file to the companion, read as it goes: it may be far bigger than the app's memory. */
  private void uploadFile(Object data, NshHostReply reply) {
    Map<?, ?> a = data instanceof Map ? (Map<?, ?>) data : Collections.emptyMap();
    new Thread(() -> {
      HttpURLConnection http = null;
      try (InputStream in = getContentResolver().openInputStream(Uri.parse((String) a.get("id")))) {
        http = (HttpURLConnection) new URL((String) a.get("url")).openConnection();
        http.setRequestMethod("POST");
        http.setDoOutput(true);
        http.setChunkedStreamingMode(64 * 1024);
        http.setRequestProperty("Authorization", "Bearer " + a.get("token"));
        http.setRequestProperty("Content-Type", "application/octet-stream");
        try (OutputStream out = http.getOutputStream()) {
          byte[] chunk = new byte[64 * 1024];
          for (int n; (n = in.read(chunk)) >= 0; ) out.write(chunk, 0, n);
        }
        int status = http.getResponseCode();
        Map<String, Object> answer = new HashMap<>();
        answer.put("status", status);
        InputStream body = status < 400 ? http.getInputStream() : http.getErrorStream();
        ByteArrayOutputStream text = new ByteArrayOutputStream();
        if (body != null) {
          byte[] chunk = new byte[4096];
          for (int n; (n = body.read(chunk)) >= 0; ) text.write(chunk, 0, n);
        }
        answer.put("body", text.toString("UTF-8"));
        reply.resolve(answer);
      } catch (Exception e) {
        reply.reject(String.valueOf(e.getMessage()));
      } finally {
        if (http != null) http.disconnect();
      }
    }).start();
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
    if (keepAlive) applyKeepAlive();
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
    stopService(new Intent(this, KeepAlive.class));
    tailPocket.close();
    CoroutineScopeKt.cancel(scope, null);
    view.destroy();
    super.onDestroy();
  }
}
