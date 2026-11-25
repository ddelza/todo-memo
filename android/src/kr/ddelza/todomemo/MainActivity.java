package kr.ddelza.todomemo;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.CalendarContract;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.TimeZone;

/**
 * 할일 메모 — 웹앱(https://my-todo-memo.web.app)을 WebView로 띄우고, 웹에서 못 하는 두 가지를 맡는다.
 *  1) 구글 캘린더: 휴대폰 캘린더(구글 계정과 동기화)에 일정 등록·수정·삭제 (CalendarContract)
 *  2) 구글 로그인: WebView 안에서는 구글이 막으므로 크롬에서 로그인 → todomemo://login?t=토큰 으로 받아 웹에 넘김
 * 할 일·메모 데이터는 웹앱이 Firestore로 실시간 동기화한다(웹과 같은 계정이면 같은 내용).
 */
public class MainActivity extends Activity {
    static final String HOST = "my-todo-memo.web.app";
    static final String START = "https://" + HOST + "/";
    static final int REQ_CAL = 11;

    WebView web;
    String pendingToken;
    boolean pageReady;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        if (BuildInfo.DEV) WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(245, 246, 248));
        setContentView(web);

        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setTextZoom(100);
        ws.setAllowFileAccess(false);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        ws.setUserAgentString(ws.getUserAgentString() + " TodoMemoApp/" + BuildInfo.VERSION);

        web.addJavascriptInterface(new Bridge(), "TodoApp");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(android.webkit.ConsoleMessage m) {   // adb logcat -s TodoJS
                android.util.Log.d("TodoJS", m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });
        handleIntent(getIntent());
        if (saved != null) web.restoreState(saved); else web.loadUrl(START);
    }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override protected void onResume() { super.onResume(); web.onResume(); }
    @Override protected void onPause() { web.onPause(); super.onPause(); }
    @Override protected void onNewIntent(Intent i) { super.onNewIntent(i); handleIntent(i); }

    void handleIntent(Intent i) {
        Uri u = i == null ? null : i.getData();
        if (u == null || !"todomemo".equals(u.getScheme())) return;
        String t = u.getQueryParameter("t");
        if (t == null || t.isEmpty()) return;
        pendingToken = t;
        deliverToken();
    }

    void deliverToken() {
        if (pendingToken == null || !pageReady) return;
        String js = "window.appLogin && window.appLogin(" + JSONObject.quote(pendingToken) + ")";
        pendingToken = null;
        web.evaluateJavascript(js, null);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("(window.appBack ? window.appBack() : false)", v -> { if (!"true".equals(v)) finish(); });
    }

    class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
            Uri u = req.getUrl();
            String path = u.getPath() == null ? "" : u.getPath();
            if (HOST.equals(u.getHost()) && !path.endsWith(".apk") && !path.startsWith("/app-login")) return false;
            openOutside(u);
            return true;
        }
        @Override public void onPageFinished(WebView v, String url) { pageReady = true; deliverToken(); }
        @Override
        public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
            if (!req.isForMainFrame()) return;
            pageReady = false;
            v.loadDataWithBaseURL(null, "<html><body style='font-family:sans-serif;text-align:center;padding:30vh 24px;background:#f5f6f8'>"
                    + "<h3>인터넷에 연결되지 않았어요</h3><p style='color:#666'>처음 한 번은 인터넷 연결이 필요해요.</p>"
                    + "<button style='font-size:16px;padding:12px 20px' onclick='TodoApp.retry()'>다시 시도</button></body></html>",
                    "text/html", "utf-8", null);
        }
    }

    void openOutside(Uri u) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { toast("열 수 있는 앱이 없어요"); }
    }

    void toast(String s) { runOnUiThread(() -> Toast.makeText(this, s, Toast.LENGTH_SHORT).show()); }

    boolean hasCal() {
        return checkSelfPermission(Manifest.permission.WRITE_CALENDAR) == PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        if (code != REQ_CAL) return;
        boolean ok = hasCal();
        web.evaluateJavascript("window.onCalPermission && window.onCalPermission(" + ok + ")", null);
    }

    // ---- 웹에서 부르는 기능 (window.TodoApp) ----
    class Bridge {
        @JavascriptInterface public String version() { return BuildInfo.VERSION; }
        @JavascriptInterface public void toast(String s) { MainActivity.this.toast(s); }
        @JavascriptInterface public void retry() { runOnUiThread(() -> web.loadUrl(START)); }
        @JavascriptInterface public void login() { openOutside(Uri.parse(START + "app-login.html")); }

        @JavascriptInterface public boolean calPermission() { return hasCal(); }
        @JavascriptInterface public void requestCalendarPermission() {
            runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR}, REQ_CAL));
        }

        /** 일정을 넣을 수 있는 캘린더 목록 [{id,name,account,type,primary}] */
        @JavascriptInterface
        public String calendars() {
            JSONArray out = new JSONArray();
            if (!hasCal()) return out.toString();
            String[] proj = {CalendarContract.Calendars._ID, CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
                    CalendarContract.Calendars.ACCOUNT_NAME, CalendarContract.Calendars.ACCOUNT_TYPE,
                    CalendarContract.Calendars.IS_PRIMARY, CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL};
            try (Cursor c = getContentResolver().query(CalendarContract.Calendars.CONTENT_URI, proj,
                    CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL + ">=" + CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR, null, null)) {
                while (c != null && c.moveToNext()) {
                    JSONObject o = new JSONObject();
                    String name = c.getString(1), acc = c.getString(2);
                    o.put("id", c.getLong(0));
                    o.put("name", name == null ? "(이름 없음)" : name);
                    o.put("account", acc == null ? "" : acc);
                    o.put("type", c.getString(3) == null ? "" : c.getString(3));
                    o.put("primary", c.getInt(4) == 1 || (acc != null && acc.equals(name)));
                    out.put(o);
                }
            } catch (Exception e) { android.util.Log.e("TodoCal", "calendars", e); }
            return out.toString();
        }

        /** 일정 만들기/고치기. date=YYYY-MM-DD, time=HH:MM 또는 ""(종일). 돌려주는 값: 일정 id, 실패면 "" */
        @JavascriptInterface
        public String calUpsert(String calId, String eventId, String title, String desc, String date, String time) {
            if (!hasCal()) return "";
            try {
                String[] d = date.split("-");
                int y = Integer.parseInt(d[0]), mo = Integer.parseInt(d[1]) - 1, da = Integer.parseInt(d[2]);
                ContentValues v = new ContentValues();
                v.put(CalendarContract.Events.TITLE, title);
                v.put(CalendarContract.Events.DESCRIPTION, desc);
                if (time == null || time.isEmpty()) {
                    Calendar s = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
                    s.clear(); s.set(y, mo, da);
                    v.put(CalendarContract.Events.DTSTART, s.getTimeInMillis());
                    v.put(CalendarContract.Events.DTEND, s.getTimeInMillis() + 86400000L);
                    v.put(CalendarContract.Events.ALL_DAY, 1);
                    v.put(CalendarContract.Events.EVENT_TIMEZONE, "UTC");
                } else {
                    String[] t = time.split(":");
                    Calendar s = Calendar.getInstance();
                    s.clear(); s.set(y, mo, da, Integer.parseInt(t[0]), Integer.parseInt(t[1]));
                    v.put(CalendarContract.Events.DTSTART, s.getTimeInMillis());
                    v.put(CalendarContract.Events.DTEND, s.getTimeInMillis() + 3600000L);
                    v.put(CalendarContract.Events.ALL_DAY, 0);
                    v.put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().getID());
                }
                ContentResolver cr = getContentResolver();
                if (eventId != null && !eventId.isEmpty() && exists(eventId)) {
                    cr.update(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, Long.parseLong(eventId)), v, null, null);
                    return eventId;
                }
                v.put(CalendarContract.Events.CALENDAR_ID, Long.parseLong(calId));
                Uri u = cr.insert(CalendarContract.Events.CONTENT_URI, v);
                return u == null ? "" : String.valueOf(ContentUris.parseId(u));
            } catch (Exception e) {
                android.util.Log.e("TodoCal", "upsert", e);
                return "";
            }
        }

        @JavascriptInterface
        public boolean calDelete(String eventId) {
            if (!hasCal() || eventId == null || eventId.isEmpty()) return false;
            try {
                return getContentResolver().delete(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, Long.parseLong(eventId)), null, null) > 0;
            } catch (Exception e) { return false; }
        }

        @JavascriptInterface public boolean calExists(String eventId) { return hasCal() && exists(eventId); }
    }

    boolean exists(String eventId) {
        try (Cursor c = getContentResolver().query(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, Long.parseLong(eventId)),
                new String[]{CalendarContract.Events._ID, CalendarContract.Events.DELETED}, null, null, null)) {
            return c != null && c.moveToFirst() && c.getInt(1) == 0;
        } catch (Exception e) { return false; }
    }
}
