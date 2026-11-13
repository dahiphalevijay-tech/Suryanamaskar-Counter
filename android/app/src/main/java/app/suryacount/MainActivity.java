package app.suryacount;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.widget.FrameLayout;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.Locale;

/** A thin shell: shows the bundled web app, hands it the camera, and speaks the count. */
public class MainActivity extends Activity {
    private static final String START_URL = "https://appassets.androidplatform.net/web/index.html";
    private WebView web;
    private TextToSpeech tts;
    private boolean ttsReady;
    private PermissionRequest pendingRequest;
    private FrameLayout root;
    private android.webkit.ValueCallback<Uri[]> pendingFiles;
    private String pendingSave;
    private static final int REQ_OPEN = 11, REQ_SAVE = 12;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#FFF8EE"));
        // The WebView sits inside a padded frame so its content never slides under the status bar.
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#FFF8EE"));
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/", new AssetHandler())
                .build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            /** The app never browses: an email link opens the phone's mail app, anything else is refused. */
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if ("appassets.androidplatform.net".equals(url.getHost())) return false;
                if ("mailto".equals(url.getScheme())) {
                    try {
                        startActivity(new Intent(Intent.ACTION_SENDTO, url));
                    } catch (RuntimeException e) {
                        android.util.Log.e("SuryaMail", "no mail app", e);
                    }
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> handleCameraRequest(request));
            }

            /** "Restore progress": lets the user pick the file they saved earlier. */
            @Override
            public boolean onShowFileChooser(WebView v, android.webkit.ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = callback;
                try {
                    Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    pick.addCategory(Intent.CATEGORY_OPENABLE);
                    pick.setType("*/*");
                    startActivityForResult(pick, REQ_OPEN);
                } catch (RuntimeException e) {
                    pendingFiles = null;
                    callback.onReceiveValue(null);
                }
                return true;
            }

            @Override
            public boolean onConsoleMessage(android.webkit.ConsoleMessage m) {
                android.util.Log.d("SuryaWeb", m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");

        tts = new TextToSpeech(this, status -> ttsReady = status == TextToSpeech.SUCCESS);

        if (savedInstanceState == null) web.loadUrl(START_URL);
        else web.restoreState(savedInstanceState);
    }

    private void handleCameraRequest(PermissionRequest request) {
        boolean wantsCamera = false;
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) wantsCamera = true;
        }
        if (!wantsCamera) { request.deny(); return; }
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        } else {
            pendingRequest = request;
            requestPermissions(new String[]{Manifest.permission.CAMERA}, 1);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != 1 || pendingRequest == null) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            pendingRequest.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        } else {
            pendingRequest.deny();
        }
        pendingRequest = null;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
        if (requestCode == REQ_OPEN) {
            if (pendingFiles != null) pendingFiles.onReceiveValue(uri == null ? null : new Uri[]{uri});
            pendingFiles = null;
        } else if (requestCode == REQ_SAVE) {
            String text = pendingSave;
            pendingSave = null;
            if (uri == null || text == null) return;       // the user backed out
            boolean ok = false;
            try (java.io.OutputStream out = getContentResolver().openOutputStream(uri)) {
                if (out != null) {
                    out.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                    ok = true;
                }
            } catch (IOException | RuntimeException e) {
                android.util.Log.e("SuryaSave", "save failed", e);
            }
            web.evaluateJavascript("window.onFileSaved && window.onFileSaved(" + ok + ")", null);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // tell the web app it is on screen again so it can refresh today's numbers
        if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('focus'))", null);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (tts != null) tts.shutdown();
        web.destroy();
        super.onDestroy();
    }

    /** Serves files from the app's assets folder with the content types the web app needs. */
    private class AssetHandler implements WebViewAssetLoader.PathHandler {
        @Override
        public WebResourceResponse handle(String path) {
            try {
                return new WebResourceResponse(mime(path), null, getAssets().open(path));
            } catch (IOException e) {
                return new WebResourceResponse(null, null, null);
            }
        }

        private String mime(String p) {
            if (p.endsWith(".html")) return "text/html";
            if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
            if (p.endsWith(".css")) return "text/css";
            if (p.endsWith(".wasm")) return "application/wasm";
            if (p.endsWith(".json")) return "application/json";
            if (p.endsWith(".svg")) return "image/svg+xml";
            if (p.endsWith(".png")) return "image/png";
            if (p.endsWith(".jpg")) return "image/jpeg";
            return "application/octet-stream";
        }
    }

    /** Called from the web app to speak the count aloud. */
    private class Bridge {
        /** Matches the area behind the status bar to the app's light or dark appearance. */
        @JavascriptInterface
        public void setDark(final boolean dark) {
            runOnUiThread(() -> {
                int color = Color.parseColor(dark ? "#1E140F" : "#FFF8EE");
                root.setBackgroundColor(color);
                web.setBackgroundColor(color);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && getWindow().getInsetsController() != null) {
                    int light = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                            | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                    getWindow().getInsetsController().setSystemBarsAppearance(dark ? 0 : light, light);
                }
            });
        }

        @JavascriptInterface
        public void speak(String text, String languageTag) {
            speakQueued(text, languageTag, true);
        }

        /** flush = say it now and drop anything waiting; otherwise it is added to the queue. */
        @JavascriptInterface
        public void speakQueued(String text, String languageTag, boolean flush) {
            if (!ttsReady || text == null) return;
            try {
                Locale wanted = Locale.forLanguageTag(languageTag == null ? "en-IN" : languageTag);
                int ok = tts.isLanguageAvailable(wanted);
                tts.setLanguage(ok >= TextToSpeech.LANG_AVAILABLE ? wanted : Locale.forLanguageTag("en-IN"));
                tts.speak(text, flush ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, null, "say");
            } catch (RuntimeException ignored) {
                // speech is optional
            }
        }

        /** "Save progress": asks the user where to keep the file, then writes it there. */
        @JavascriptInterface
        public void saveFile(final String name, final String text) {
            runOnUiThread(() -> {
                try {
                    pendingSave = text;
                    Intent make = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    make.addCategory(Intent.CATEGORY_OPENABLE);
                    make.setType("application/json");
                    make.putExtra(Intent.EXTRA_TITLE, name);
                    startActivityForResult(make, REQ_SAVE);
                } catch (RuntimeException e) {
                    pendingSave = null;
                    web.evaluateJavascript("window.onFileSaved && window.onFileSaved(false)", null);
                }
            });
        }

        /** App version and phone model, added to feedback emails so problems can be traced. */
        @JavascriptInterface
        public String appInfo() {
            String version = "";
            try {
                version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (PackageManager.NameNotFoundException ignored) {
                // leave blank
            }
            return "Suryanamaskar " + version + ", " + Build.MANUFACTURER + " " + Build.MODEL + ", Android " + Build.VERSION.RELEASE;
        }

        /** Switches the daily reminder on or off and stores what it should say. */
        @JavascriptInterface
        public void setReminder(final boolean enabled, final int hour, final int minute,
                                final String title, final String text, final String lastDay) {
            getSharedPreferences(ReminderReceiver.PREFS, MODE_PRIVATE).edit()
                    .putBoolean("enabled", enabled).putInt("hour", hour).putInt("minute", minute)
                    .putString("title", title).putString("text", text).putString("lastDay", lastDay == null ? "" : lastDay)
                    .apply();
            runOnUiThread(() -> {
                if (enabled && Build.VERSION.SDK_INT >= 33
                        && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 2);
                }
                ReminderReceiver.schedule(MainActivity.this);
            });
        }

        /** Opens the phone's share sheet with the summary picture (WhatsApp status, Instagram and so on). */
        @JavascriptInterface
        public void shareImage(String base64Image, final String text) {
            try {
                byte[] png = Base64.decode(base64Image, Base64.DEFAULT);
                File dir = new File(getCacheDir(), "share");
                if (!dir.exists() && !dir.mkdirs()) return;
                File file = new File(dir, "suryanamaskar.jpg");
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(png);
                }
                final Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", file);
                runOnUiThread(() -> {
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("image/jpeg");
                    send.putExtra(Intent.EXTRA_STREAM, uri);
                    if (text != null) send.putExtra(Intent.EXTRA_TEXT, text);
                    send.setClipData(ClipData.newRawUri("", uri));
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(Intent.createChooser(send, null));
                });
            } catch (IOException | RuntimeException e) {
                android.util.Log.e("SuryaShare", "share failed", e);
            }
        }
    }
}
