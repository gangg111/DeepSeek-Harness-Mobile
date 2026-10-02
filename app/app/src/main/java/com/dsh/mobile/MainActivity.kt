package com.dsh.mobile

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebResourceRequest
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView

class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var label: TextView
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private companion object {
        const val REQ_FILES = 41
        /** Powiększenie strony dsh w WebView: na telefonie ikony i tekst interfejsu są za małe (user, 2026-10-02).
         *  Realizowane przez meta viewport (width = szerokość ekranu / UI_ZOOM, initial-scale = UI_ZOOM), czyli natywne
         *  skalowanie strony: wszystko większe (także ikony), mniejsza szerokość w px CSS (układ mobilny także na rozłożonym
         *  Foldzie), a wyskakujące menu pozycjonują się poprawnie. CSS `zoom` na html rozjeżdżał floating-ui: lista trybów
         *  dostępu w sesji z komputera wychodziła za dół ekranu. */
        const val UI_ZOOM = "1.2"
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQ_FILES) { super.onActivityResult(requestCode, resultCode, data); return }
        val callback = fileCallback ?: return
        fileCallback = null
        // Anulowanie musi oddać null, inaczej WebView nie otworzy wyboru plików ponownie.
        val uris: Array<Uri>? = if (resultCode != RESULT_OK || data == null) null
            else data.clipData?.let { clip -> Array(clip.itemCount) { clip.getItemAt(it).uri } } ?: data.data?.let { arrayOf(it) }
        callback.onReceiveValue(uris)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Po „Zatrzymaj" z powiadomienia proces apki żyje, więc App.onCreate nie zadziała ponownie.
        if (App.process?.isAlive != true) ServerService.start(this)
        val frame = FrameLayout(this)
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            // Honoruj meta viewport ustawiane przez applyZoom() (szerokość strony mniejsza niż ekran = natywne powiększenie).
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            // Logowanie do Tailscale (konto Google/GitHub) ma iść w prawdziwej przeglądarce; reszta zostaje w WebView
            // (także https://<pc>.ts.net przez VPN i http://127.0.0.1:<port> przez wbudowany węzeł).
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (request.url.host == "login.tailscale.com") {
                        startActivity(Intent(Intent.ACTION_VIEW, request.url)); return true
                    }
                    return false
                }
                override fun onPageFinished(view: WebView, url: String?) {
                    applyZoom()
                    syncBars()
                    // Diagnostyka układu (raz na stronę): szerokość CSS decyduje o mobilnym/desktopowym układzie dsh i dsh-qol (próg 768 px).
                    view.evaluateJavascript("JSON.stringify({w:innerWidth,h:innerHeight,dpr:devicePixelRatio,qolMobile:!!document.querySelector('[data-qol-appframe]'),bg:getComputedStyle(document.body).backgroundColor})") {
                        (application as App).log("webview: ${it?.trim('"')?.replace("\\\"", "\"")}")
                    }
                }
            }
            webChromeClient = object : WebChromeClient() {
                // Bez tego <input type="file"> w WebView nic nie robi: załączniki i zdjęcia w kompozytorze DSH.
                override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = callback
                    val intent = params.createIntent().apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    }
                    return try {
                        startActivityForResult(intent, REQ_FILES); true
                    } catch (e: ActivityNotFoundException) {
                        fileCallback = null; false
                    }
                }
            }
            visibility = View.GONE
        }
        label = TextView(this).apply {
            gravity = Gravity.CENTER; textSize = 18f; setPadding(48, 48, 48, 48)
            text = App.status
        }
        frame.addView(web); frame.addView(label)
        setContentView(frame)
        if (checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) != android.content.pm.PackageManager.PERMISSION_GRANTED)
            requestPermissions(arrayOf(android.Manifest.permission.WRITE_EXTERNAL_STORAGE), 1)

        App.onUrl = { u -> runOnUiThread { show(u) } }
        App.onStatus = { s -> runOnUiThread { label.text = s; if (App.url == null) { web.visibility = View.GONE; label.visibility = View.VISIBLE } } }
        App.url?.let { show(it) }
    }

    /**
     * Pasek stanu i nawigacji w kolorze tła strony: motyw Androida ma własny odcień, a dsh zmienia tło
     * (jasny/ciemny, odcienie między wersjami), więc kolor czytamy z WebView i odświeżamy co 2 s.
     */
    private val bars = Handler(Looper.getMainLooper())
    private var lastBar = 0
    private fun syncBars() {
        if (!::web.isInitialized || web.visibility != View.VISIBLE) return
        web.evaluateJavascript("getComputedStyle(document.body).backgroundColor") { raw ->
            val m = Regex("""rgba?\((\d+),\s*(\d+),\s*(\d+)""").find(raw ?: "") ?: return@evaluateJavascript
            val (r, g, b) = m.destructured
            val c = Color.rgb(r.toInt(), g.toInt(), b.toInt())
            if (c == lastBar) return@evaluateJavascript
            lastBar = c
            window.statusBarColor = c; window.navigationBarColor = c
            val light = (0.299 * r.toInt() + 0.587 * g.toInt() + 0.114 * b.toInt()) > 150
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = if (light) View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR else 0
        }
    }
    private fun applyZoom() {
        if (!::web.isInitialized) return
        // Tylko lokalny dsh (127.0.0.1); strony z komputera przez pośrednik Code też są lokalne, logowanie Tailscale idzie w przeglądarce.
        web.evaluateJavascript("""(function(){var z=$UI_ZOOM;var m=document.querySelector('meta[name=viewport]');if(!m){m=document.createElement('meta');m.name='viewport';document.head.appendChild(m);}var w=Math.round(screen.width/z);var c='width='+w+', initial-scale='+z+', minimum-scale='+z+', maximum-scale='+z+', viewport-fit=cover';if(m.content!==c){m.content=c;}if(document.documentElement.style.zoom){document.documentElement.style.zoom='';}})()""", null)
    }
    private val barsTick = object : Runnable { override fun run() { applyZoom(); syncBars(); bars.postDelayed(this, 2000) } }
    override fun onResume() { super.onResume(); bars.post(barsTick) }
    override fun onPause() { super.onPause(); bars.removeCallbacks(barsTick) }

    private var loadedUrl: String? = null
    private fun show(url: String) {
        label.visibility = View.GONE
        web.visibility = View.VISIBLE
        // Po restarcie serwera (np. po aktualizacji) token jest nowy, więc ładujemy nowy adres.
        if (loadedUrl != url) { loadedUrl = url; web.loadUrl(url) }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { if (web.canGoBack()) web.goBack() else super.onBackPressed() }

    override fun onDestroy() {
        App.onStatus = null; App.onUrl = null
        super.onDestroy()
    }
}
