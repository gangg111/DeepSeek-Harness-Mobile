package com.dsh.mobile

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
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

    private companion object { const val REQ_FILES = 41 }

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
            // Logowanie do Tailscale (konto Google/GitHub) ma iść w prawdziwej przeglądarce; reszta zostaje w WebView
            // (także https://<pc>.ts.net przez VPN i http://127.0.0.1:<port> przez wbudowany węzeł).
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (request.url.host == "login.tailscale.com") {
                        startActivity(Intent(Intent.ACTION_VIEW, request.url)); return true
                    }
                    return false
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
