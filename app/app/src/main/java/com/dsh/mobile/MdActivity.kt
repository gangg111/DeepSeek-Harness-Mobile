package com.dsh.mobile

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import java.io.File
import java.io.FileOutputStream

/**
 * Czytnik i edytor plików .md w apce (assets/md: viewer.html + marked). Strona dostaje treść przez mostek Md,
 * który czyta i zapisuje WYŁĄCZNIE plik z intencji; skrypty z treści dokumentu blokuje CSP w viewer.html.
 */
class MdActivity : Activity() {
    companion object {
        const val EXTRA_PATH = "path"
        /** Wirtualny host stron czytnika: odpowiedzi idą z assets/md (shouldInterceptRequest), sieć nie jest używana. */
        const val HOST = "dsh-md.local"
        const val MAX_BYTES = 8L shl 20
        private const val BG = 0xFF151517.toInt()

        fun open(ctx: Context, f: File) =
            ctx.startActivity(Intent(ctx, MdActivity::class.java).putExtra(EXTRA_PATH, f.path).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_MULTIPLE_TASK))
    }

    private lateinit var web: WebView
    private lateinit var file: File
    private var text = ""
    private var crlf = false
    @Volatile private var dirty = false
    private val app get() = application as App

    inner class Bridge {
        @JavascriptInterface fun text() = text
        @JavascriptInterface fun name() = file.name
        @JavascriptInterface fun setDirty(d: Boolean) { dirty = d }
        /** Zapis atomowy (plik tymczasowy + rename): przerwany zapis nie utnie pliku. Zwraca "" albo opis błędu. */
        @JavascriptInterface fun save(body: String): String = try {
            val out = if (crlf) body.replace("\r\n", "\n").replace("\n", "\r\n") else body
            val tmp = File(file.parentFile, ".${file.name}.zapis")
            FileOutputStream(tmp).use { it.write(out.toByteArray()); it.fd.sync() }
            if (!tmp.renameTo(file)) { tmp.delete(); throw java.io.IOException("nie udało się podmienić pliku") }
            app.log("md: zapisano ${file.path} (${out.length} zn.)")
            ""
        } catch (e: Throwable) { app.log("md: zapis ${file.path}: $e"); e.message ?: e.toString() }
        @JavascriptInterface fun copy(body: String) = runOnUiThread {
            getSystemService(android.content.ClipboardManager::class.java).setPrimaryClip(android.content.ClipData.newPlainText(file.name, body))
        }
        @JavascriptInterface fun openExternal() = runOnUiThread { Opener.chooser(this@MdActivity, file) }
        @JavascriptInterface fun openLink(href: String) = runOnUiThread { link(href) }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        file = File(intent.getStringExtra(EXTRA_PATH) ?: "").canonicalFile
        val err = when {
            !file.isFile -> "nie ma takiego pliku"
            file.length() > MAX_BYTES -> "plik większy niż 8 MB"
            else -> try { text = file.readText(); null } catch (e: Throwable) { e.toString() }
        }
        if (err != null) {
            app.log("md: ${file.path}: $err")
            Toast.makeText(this, "${file.name}: $err", Toast.LENGTH_LONG).show()
            finish(); return
        }
        crlf = text.count { it == '\r' } * 2 > text.count { it == '\n' }   // dominujące końce linii zostają przy zapisie
        text = text.replace("\r\n", "\n")
        app.log("md: otwarto ${file.path}")
        window.statusBarColor = BG; window.navigationBarColor = BG
        web = WebView(this).apply {
            setBackgroundColor(BG)
            settings.javaScriptEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            addJavascriptInterface(Bridge(), "Md")
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, req: WebResourceRequest): WebResourceResponse? {
                    if (req.url.host != HOST) return WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", emptyMap(), null)
                    val name = req.url.lastPathSegment ?: ""
                    val mime = when (name.substringAfterLast('.')) { "html" -> "text/html"; "js" -> "text/javascript"; "css" -> "text/css"; else -> return null }
                    return try { WebResourceResponse(mime, "utf-8", assets.open("md/$name")) } catch (_: Throwable) { null }
                }
                // Żadnej nawigacji poza stroną czytnika (linki obsługuje openLink).
                override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest) = true
            }
        }
        setContentView(web)
        web.loadUrl("https://$HOST/viewer.html")
    }

    /** Link z dokumentu: http(s)/mailto do przeglądarki, względny .md otwiera kolejny czytnik, inne pliki — wybór aplikacji. */
    private fun link(href: String) {
        val uri = Uri.parse(href)
        if (uri.scheme in setOf("http", "https", "mailto")) {
            try { startActivity(Intent(Intent.ACTION_VIEW, uri)) } catch (_: Throwable) {}
            return
        }
        if (uri.scheme != null) return
        val target = File(file.parentFile, Uri.decode(href.substringBefore('#'))).canonicalFile
        when {
            !target.isFile -> Toast.makeText(this, "Nie ma pliku ${target.name}", Toast.LENGTH_SHORT).show()
            Opener.isMarkdown(target) -> open(this, target)
            else -> Opener.chooser(this, target)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (!dirty) { @Suppress("DEPRECATION") super.onBackPressed(); return }
        AlertDialog.Builder(this)
            .setTitle("Zapisać zmiany w ${file.name}?")
            .setPositiveButton("Zapisz") { _, _ -> web.evaluateJavascript("doSave()") { if (it == "true") finish() } }
            .setNegativeButton("Odrzuć") { _, _ -> finish() }
            .setNeutralButton("Anuluj", null)
            .show()
    }

    override fun onDestroy() {
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }
}
