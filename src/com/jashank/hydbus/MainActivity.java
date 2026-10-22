package com.jashank.hydbus;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.InputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.provider.Settings;

public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final int REQ_LOC = 11, REQ_NOTIF = 12;
    WebView web;
    Handler ui = new Handler(Looper.getMainLooper());
    GeolocationPermissions.Callback pendingGeo;
    String pendingOrigin;
    boolean jsAskedLocation = false;
    int userTextZoom = -1;
    LocationManager lm;
    LocationListener locL;
    Location best;
    int fixes = 0;
    String diagProv = "";
    static final String UA = "BusBhaiHyderabad/1.0.1 (Android; com.jashank.hydbus)";

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        Window w = getWindow();
        w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        w.setStatusBarColor(0x00000000);
        applyBars(isDarkNow());

        web = new WebView(this);
        web.setBackgroundColor(isDarkNow() ? 0xFF0C0C0D : 0xFFF6F5F2);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(isOnline() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);
        s.setTextZoom(Math.round(getResources().getConfiguration().fontScale * 100));
        web.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);

        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                if (hasLocation()) { cb.invoke(origin, true, true); return; }
                pendingGeo = cb; pendingOrigin = origin;
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOC);
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("tile.openstreetmap.org".equals(u.getHost())) return tile(u);
                if (HOST.equals(u.getHost()) && u.getPath() != null && u.getPath().startsWith("/assets/")) {
                    String p = u.getPath().substring(8);
                    try {
                        InputStream in = getAssets().open(p);
                        String m = mime(p);
                        return new WebResourceResponse(m, m.startsWith("text") || m.endsWith("json") ? "utf-8" : null, in);
                    } catch (Exception e) { return null; }
                }
                return null;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                if (HOST.equals(r.getUrl().getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, r.getUrl())); } catch (Exception e) {}
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "Android");
        setContentView(web);
        web.loadUrl("https://" + HOST + "/assets/index.html");
    }
    boolean permAsking = false;
    String lastFixJs = "";
    void askPerm() {
        if (permAsking) return;
        permAsking = true;
        requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOC);
    }


    WebResourceResponse tile(Uri u) {
        String path = u.getPath();
        if (path == null || !path.matches("/\\d+/\\d+/\\d+\\.png")) return null;
        File f = new File(new File(getCacheDir(), "tiles"), path.substring(1).replace('/', '_'));
        boolean fresh = f.exists() && System.currentTimeMillis() - f.lastModified() < 14L * 86400000L;
        if (!fresh || !isOnline()) {
            if (isOnline()) {
                HttpURLConnection c = null;
                try {
                    c = (HttpURLConnection) new URL("https://tile.openstreetmap.org" + path).openConnection();
                    c.setRequestProperty("User-Agent", UA);
                    c.setConnectTimeout(8000); c.setReadTimeout(10000);
                    if (c.getResponseCode() == 200) {
                        InputStream in = c.getInputStream(); ByteArrayOutputStream bo = new ByteArrayOutputStream();
                        byte[] buf = new byte[8192]; int n; while ((n = in.read(buf)) > 0) bo.write(buf, 0, n); in.close();
                        byte[] data = bo.toByteArray();
                        try { f.getParentFile().mkdirs(); FileOutputStream fo = new FileOutputStream(f); fo.write(data); fo.close(); } catch (Exception e) {}
                        return new WebResourceResponse("image/png", null, new ByteArrayInputStream(data));
                    }
                } catch (Exception e) {
                } finally { if (c != null) c.disconnect(); }
            }
        }
        if (f.exists()) { try { return new WebResourceResponse("image/png", null, new FileInputStream(f)); } catch (Exception e) {} }
        return null;
    }

    boolean better(Location l) {
        if (l == null) return false;
        if (best == null) return true;
        long dt = l.getTime() - best.getTime();
        if (dt > 30000) return true;
        if (dt < -30000) return false;
        return l.getAccuracy() <= best.getAccuracy() + 20;
    }
    void diag(String st) {
        String perm = hasFine() ? "precise" : hasLocation() ? "approximate" : "none";
        js("window.onNativeDiag&&onNativeDiag(" + org.json.JSONObject.quote("perm " + perm + " · " + st + " · providers " + diagProv + " · fixes " + fixes) + ")");
    }
    void push(Location l) {
        fixes++;
        if (!better(l)) return;
        best = l;
        lastFixJs = l.getLatitude() + "," + l.getLongitude() + "," + l.getAccuracy();
        js("window.onNativeFix&&onNativeFix(" + l.getLatitude() + "," + l.getLongitude() + "," + l.getAccuracy() + ","
            + (l.hasSpeed() ? l.getSpeed() : -1) + "," + (l.hasBearing() ? l.getBearing() : -1) + ")");
    }
    boolean hasFine() { return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED; }
    void startNativeLocation() {
        if (!hasLocation()) { askPerm(); return; }
        if (lm == null) lm = (LocationManager) getSystemService(LOCATION_SERVICE);
        if (lm == null) { js("window.onNativeLocState&&onNativeLocState('unavailable')"); return; }
        boolean master = true;
        if (Build.VERSION.SDK_INT >= 28) { try { master = lm.isLocationEnabled(); } catch (Exception e) {} }
        java.util.List<String> provs = new java.util.ArrayList<String>();
        if (Build.VERSION.SDK_INT >= 31) provs.add("fused");
        provs.add(LocationManager.NETWORK_PROVIDER);
        if (hasFine()) provs.add(LocationManager.GPS_PROVIDER);
        java.util.List<String> on = new java.util.ArrayList<String>();
        for (String p : provs) { try { if (lm.getAllProviders().contains(p) && lm.isProviderEnabled(p)) on.add(p); } catch (Exception e) {} }
        diagProv = on.isEmpty() ? "none" : android.text.TextUtils.join(",", on);
        if (!master || on.isEmpty()) { diag(master ? "location on, no providers" : "location off"); js("window.onNativeLocState&&onNativeLocState('off')"); return; }
        stopNativeLocation();
        // quick start: any cached fix from the last 24h, newest first
        for (String p : lm.getAllProviders()) {
            try { Location l = lm.getLastKnownLocation(p); if (l != null && System.currentTimeMillis() - l.getTime() < 24 * 3600000L) push(l); } catch (Exception e) {}
        }
        locL = new LocationListener() {
            public void onLocationChanged(Location l) { push(l); }
            public void onStatusChanged(String p, int st, Bundle b) {}
            public void onProviderEnabled(String p) {}
            public void onProviderDisabled(String p) {}
        };
        int started = 0;
        for (String p : on) {
            try { lm.requestLocationUpdates(p, 2000, 0, locL, Looper.getMainLooper()); started++; } catch (Exception e) {}
            if (Build.VERSION.SDK_INT >= 30) {
                try {
                    lm.getCurrentLocation(p, null, getMainExecutor(), new java.util.function.Consumer<Location>() {
                        public void accept(Location l) { if (l != null) push(l); }
                    });
                } catch (Exception e) {}
            }
        }
        diag("listening on " + started);
        if (started == 0) js("window.onNativeLocState&&onNativeLocState('denied')");
        ui.postDelayed(new Runnable() { public void run() { diag("after 10s"); } }, 10000);
    }
    void stopNativeLocation() { if (lm != null && locL != null) { try { lm.removeUpdates(locL); } catch (Exception e) {} locL = null; } }

    static String mime(String p) {
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    boolean hasLocation() { return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED; }
    boolean isDarkNow() { return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES; }
    boolean isOnline() {
        try { ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE); NetworkInfo n = cm.getActiveNetworkInfo(); return n != null && n.isConnected(); }
        catch (Exception e) { return true; }
    }
    void applyBars(boolean dark) {
        Window w = getWindow();
        int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN;
        if (!dark) {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= 26) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        w.getDecorView().setSystemUiVisibility(flags);
        w.setNavigationBarColor(dark ? 0xFF0C0C0D : 0xFFF6F5F2);
    }
    void js(final String code) { ui.post(new Runnable() { public void run() { if (web != null) web.evaluateJavascript(code, null); } }); }

    @Override public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        if (code == REQ_LOC) {
            permAsking = false;
            boolean ok = hasLocation();
            if (pendingGeo != null) { pendingGeo.invoke(pendingOrigin, ok, ok); pendingGeo = null; }
            js("window.onLocationPermission&&onLocationPermission(" + ok + ")");

        }
    }
    @Override public void onConfigurationChanged(Configuration c) {
        super.onConfigurationChanged(c);
        if (userTextZoom < 0) web.getSettings().setTextZoom(Math.round(c.fontScale * 100));
        js("window.onThemeChange&&onThemeChange()");
    }
    @Override protected void onDestroy() { stopNativeLocation(); super.onDestroy(); }
    @Override protected void onPause() { super.onPause(); /* keep JS timers running so live sharing / alerts continue while screen is on */ }
    @Override protected void onResume() {
        super.onResume();
        web.getSettings().setCacheMode(isOnline() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);
        js("window.onAppResume&&onAppResume()");
    }
    @Override public void onBackPressed() {
        web.evaluateJavascript("window.onBack?onBack():'exit'", new android.webkit.ValueCallback<String>() {
            public void onReceiveValue(String v) { if (v == null || v.contains("exit")) finish(); }
        });
    }

    class Bridge {
        @JavascriptInterface public boolean isDark() { return isDarkNow(); }
        @JavascriptInterface public int insetTop() {
            int id = getResources().getIdentifier("status_bar_height", "dimen", "android");
            float d = getResources().getDisplayMetrics().density;
            return id > 0 ? Math.round(getResources().getDimensionPixelSize(id) / d) : 24;
        }
        @JavascriptInterface public String version() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return ""; }
        }
        @JavascriptInterface public void setBars(final boolean dark) { ui.post(new Runnable() { public void run() { applyBars(dark); web.setBackgroundColor(dark ? 0xFF0C0C0D : 0xFFF6F5F2); } }); }
        @JavascriptInterface public void setTextZoom(final int pct) {
            ui.post(new Runnable() { public void run() {
                // Respect the system font scale on top of the in-app choice.
                userTextZoom = pct;
                web.getSettings().setTextZoom(Math.round(pct * getResources().getConfiguration().fontScale));
            } });
        }
        @JavascriptInterface public void requestLocation() {
            ui.post(new Runnable() { public void run() {
                if (hasLocation()) { js("window.onLocationPermission&&onLocationPermission(true)"); }
                else askPerm();
            } });
        }
        @JavascriptInterface public String lastFix() { return lastFixJs; }
        @JavascriptInterface public boolean hasPermission() { return hasLocation(); }
        @JavascriptInterface public void ipLocate() {
            new Thread(new Runnable() { public void run() {
                String[] urls = {"https://ipwho.is/", "https://ipapi.co/json/", "https://get.geojs.io/v1/ip/geo.json"};
                for (String u : urls) {
                    HttpURLConnection c = null;
                    try {
                        c = (HttpURLConnection) new URL(u).openConnection();
                        c.setRequestProperty("User-Agent", UA); c.setConnectTimeout(6000); c.setReadTimeout(6000);
                        InputStream in = c.getInputStream(); ByteArrayOutputStream bo = new ByteArrayOutputStream();
                        byte[] buf = new byte[4096]; int n; while ((n = in.read(buf)) > 0) bo.write(buf, 0, n); in.close();
                        org.json.JSONObject o = new org.json.JSONObject(bo.toString("UTF-8"));
                        double la = Double.parseDouble(o.optString("latitude", "NaN")), lo = Double.parseDouble(o.optString("longitude", "NaN"));
                        if (!Double.isNaN(la) && !Double.isNaN(lo)) { js("window.onIpFix&&onIpFix(" + la + "," + lo + ")"); return; }
                    } catch (Exception e) {
                    } finally { if (c != null) c.disconnect(); }
                }
                js("window.onIpFix&&onIpFix(null,null)");
            } }).start();
        }
        @JavascriptInterface public void startLocation() { ui.post(new Runnable() { public void run() { startNativeLocation(); } }); }
        @JavascriptInterface public void openLocationSettings() {
            ui.post(new Runnable() { public void run() { try { startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)); } catch (Exception e) {} } });
        }
        @JavascriptInterface public void requestNotify() {
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED)
                ui.post(new Runnable() { public void run() { requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, REQ_NOTIF); } });
        }
        @JavascriptInterface public void keepAwake(final boolean on) {
            ui.post(new Runnable() { public void run() {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            } });
        }
        @JavascriptInterface public void vibrate(int ms) {
            try {
                Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
                if (v == null) return;
                if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE)); else v.vibrate(ms);
            } catch (Exception e) {}
        }
        @JavascriptInterface public void notify(String title, String text) {
            try {
                NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                Notification.Builder nb;
                if (Build.VERSION.SDK_INT >= 26) {
                    NotificationChannel ch = new NotificationChannel("alerts", "Stop alerts", NotificationManager.IMPORTANCE_HIGH);
                    ch.enableVibration(true); ch.setVibrationPattern(new long[]{0, 800, 400, 800});
                    nm.createNotificationChannel(ch);
                    nb = new Notification.Builder(MainActivity.this, "alerts");
                } else {
                    nb = new Notification.Builder(MainActivity.this).setPriority(Notification.PRIORITY_HIGH).setVibrate(new long[]{0, 800, 400, 800});
                }
                Intent i = new Intent(MainActivity.this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
                PendingIntent pi = PendingIntent.getActivity(MainActivity.this, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                nb.setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(title).setContentText(text).setAutoCancel(true).setContentIntent(pi);
                nm.notify((int) (System.currentTimeMillis() % 100000), nb.build());
            } catch (Exception e) {}
        }
        @JavascriptInterface public void share(final String t) { ui.post(new Runnable() { public void run() { Intent i = new Intent(Intent.ACTION_SEND); i.setType("text/plain"); i.putExtra(Intent.EXTRA_TEXT, t); startActivity(Intent.createChooser(i, "Share")); } }); }
    }
}
