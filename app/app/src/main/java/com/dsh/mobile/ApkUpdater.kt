package com.dsh.mobile

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Aktualizacja samej apki z wydań na GitHubie (gangg111/DeepSeek-Harness-Mobile) — ma pierwszeństwo przed aktualizacją dsh z npm.
 * Wydanie niesie obok APK plik dsh-mobile.json {versionCode, versionName, md5, size} (tworzy go update.sh); assety są podmieniane
 * w miejscu pod tym samym tagiem, więc o nowości decyduje versionCode, nie tag. APK idzie strumieniem prosto do sesji
 * PackageInstaller (bez kopii 630 MB na dysku), md5 liczone w locie — niezgodne = sesja porzucona, nic się nie instaluje.
 */
object ApkUpdater {
    const val REPO = "gangg111/DeepSeek-Harness-Mobile"
    private const val LATEST = "https://api.github.com/repos/$REPO/releases/latest"

    data class Release(val versionCode: Long, val versionName: String, val md5: String, val size: Long, val apkUrl: String)

    private fun open(url: String, timeoutMs: Int): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = timeoutMs; readTimeout = timeoutMs; instanceFollowRedirects = true
            setRequestProperty("User-Agent", "DSH-Mobile"); setRequestProperty("Accept", "application/vnd.github+json")
        }

    private fun getText(url: String): String {
        val c = open(url, 15000)
        try {
            if (c.responseCode != 200) throw IllegalStateException("HTTP ${c.responseCode} dla $url")
            return c.inputStream.bufferedReader().readText()
        } finally { c.disconnect() }
    }

    fun installedVersionCode(ctx: Context): Long = ctx.packageManager.getPackageInfo(ctx.packageName, 0).longVersionCode

    /** Najnowsze wydanie z dsh-mobile.json albo null (brak pliku w wydaniu). Wyjątek = błąd sieci/GitHuba. */
    fun latest(): Release? {
        val assets = JSONObject(getText(LATEST)).getJSONArray("assets")
        var meta: String? = null; var apk: String? = null
        for (i in 0 until assets.length()) {
            val a = assets.getJSONObject(i)
            when (a.getString("name")) {
                "dsh-mobile.json" -> meta = a.getString("browser_download_url")
                "dsh-mobile.apk" -> apk = a.getString("browser_download_url")
            }
        }
        if (meta == null || apk == null) return null
        val j = JSONObject(getText(meta))
        return Release(j.getLong("versionCode"), j.getString("versionName"), j.getString("md5").lowercase(), j.getLong("size"), apk)
    }

    /** Nowsze wydanie niż zainstalowana apka albo null. */
    fun newer(ctx: Context): Release? = latest()?.takeIf { it.versionCode > installedVersionCode(ctx) }

    /**
     * Pobiera APK do sesji instalatora i zatwierdza ją; wynik (w tym prośba o potwierdzenie przez użytkownika)
     * przychodzi do ServerService jako ACTION_INSTALL_STATUS. Rzuca wyjątek przy błędzie pobierania lub niezgodnym md5.
     */
    fun downloadAndCommit(ctx: Context, rel: Release, progress: (Long, Long) -> Unit) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(ctx.packageName); setSize(rel.size)
        }
        val id = installer.createSession(params)
        val session = installer.openSession(id)
        try {
            val md = MessageDigest.getInstance("MD5")
            val c = open(rel.apkUrl, 60000)
            try {
                if (c.responseCode != 200) throw IllegalStateException("HTTP ${c.responseCode} przy pobieraniu APK")
                val total = if (c.contentLengthLong > 0) c.contentLengthLong else rel.size
                c.inputStream.use { inp ->
                    session.openWrite("dsh-mobile.apk", 0, total).use { out ->
                        val buf = ByteArray(1 shl 16); var done = 0L; var last = 0L
                        while (true) {
                            val n = inp.read(buf); if (n < 0) break
                            out.write(buf, 0, n); md.update(buf, 0, n); done += n
                            if (done - last >= 8L * 1024 * 1024) { last = done; progress(done, total) }
                        }
                        session.fsync(out)
                        progress(done, total)
                        if (done != rel.size) throw IllegalStateException("pobrano $done z ${rel.size} B")
                    }
                }
            } finally { c.disconnect() }
            val got = md.digest().joinToString("") { "%02x".format(it) }
            if (got != rel.md5) throw IllegalStateException("md5 pobranego APK $got ≠ ${rel.md5}")
            val status = PendingIntent.getService(ctx, 5,
                Intent(ctx, ServerService::class.java).setAction(ServerService.ACTION_INSTALL_STATUS), PendingIntent.FLAG_UPDATE_CURRENT)
            session.commit(status.intentSender)
        } catch (e: Throwable) {
            session.abandon(); throw e
        } finally { session.close() }
    }
}
