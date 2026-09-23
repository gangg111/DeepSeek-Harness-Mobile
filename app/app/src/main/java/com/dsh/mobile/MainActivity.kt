package com.dsh.mobile

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView

class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var label: TextView

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
            webViewClient = WebViewClient()
            webChromeClient = WebChromeClient()
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
