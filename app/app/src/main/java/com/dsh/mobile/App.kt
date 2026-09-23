package com.dsh.mobile

import android.app.Application
import android.util.Log
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.util.zip.ZipInputStream

/** Trzyma proces node z serwerem dsh przez cały czas życia aplikacji (przeżywa obrót ekranu). */
class App : Application() {
    companion object {
        const val TAG = "dsh"
        const val PAYLOAD_VERSION = "11"
        @Volatile var url: String? = null
        @Volatile var status: String = "start"
        @Volatile var process: Process? = null
        @Volatile var lastUpdateMessage: String? = null
        @Volatile var updateChecked = false
        var onUrl: ((String) -> Unit)? = null
        var onStatus: ((String) -> Unit)? = null
    }

    private val root get() = File(filesDir, "rt")

    override fun onCreate() {
        super.onCreate()
        try { logFile.writeText("--- start ${java.util.Date()}\n") } catch (_: Throwable) {}
        ServerService.start(this)
    }

    private fun setStatus(s: String) {
        status = s; log(s); onStatus?.invoke(s)
        ServerService.instance?.update(s)
    }

    /** Log do pliku na /sdcard/Download (logcat cudzych apek jest nieczytelny z Termuxa). */
    private val logFile = File("/sdcard/Download/dsh_log.txt")
    fun log(s: String) {
        Log.i(TAG, s)
        try { logFile.appendText(s + "\n") } catch (_: Throwable) {}
    }

    /** Rozpakowanie payloadu (raz na wersję) i blokujące uruchomienie serwera; wołane z ServerService. */
    fun boot() {
        val marker = File(root, ".version")
        if (!marker.exists() || marker.readText() != PAYLOAD_VERSION) {
            root.deleteRecursively(); root.mkdirs()
            extractPayload()
            marker.writeText(PAYLOAD_VERSION)
        }
        startServer()
    }

    private fun extractPayload() {
        var n = 0
        ZipInputStream(assets.open("payload.zip").buffered(1 shl 20)).use { zip ->
            while (true) {
                val e = zip.nextEntry ?: break
                val out = File(root, e.name)
                if (e.isDirectory) { out.mkdirs(); continue }
                out.parentFile?.mkdirs()
                out.outputStream().use { zip.copyTo(it) }
                if (!e.name.startsWith("node_modules/")) out.setExecutable(true)   // narzędzia, wrappery, JDK, zig…
                if (++n % 1000 == 0) setStatus("Rozpakowywanie... $n plików")
            }
        }
        applyLinks()
        setStatus("Rozpakowano $n plików")
    }

    private fun startServer() {
        val home = File(filesDir, "home").apply { mkdirs() }
        val cmd = listOf(
            File(root, "bin/node").path, "--expose-internals",
            "--require", File(root, "android-shim.cjs").path,
            File(root, "node_modules/@deepseek-ai/dsh/lib/bin.js").path,
            // --patch: nakładka z polskim pakietem językowym (rt/dsh-locale-pl); subkomenda `web` nie przyjmuje --patch
            "--profile", "web", "--patch", File(root, "android.patch.yml").path, "--no-open", "--port", "3090",
        )
        val pb = ProcessBuilder(cmd).directory(home).redirectErrorStream(true)
        pb.environment().apply { clear(); putAll(serverEnv()) }
        setStatus("Uruchamianie serwera...")
        log("exec: " + cmd.joinToString(" "))
        val p = pb.start(); process = p
        BufferedReader(InputStreamReader(p.inputStream)).useLines { lines ->
            for (line in lines) {
                log(line)
                val m = Regex("""(https?://\S+)""").find(line)
                if (url == null && line.startsWith("dsh web:") && m != null) {
                    url = m.value; onUrl?.invoke(m.value)
                    setStatus("Serwer działa: port ${Regex(":(\\d+)/").find(m.value)?.groupValues?.get(1) ?: "?"}")
                    if (!updateChecked) { updateChecked = true; ServerService.instance?.checkForUpdate() }
                }
            }
        }
        setStatus("Serwer zakończył pracę (kod ${p.waitFor()})")
    }

    /** Dowiązania (coreutils, git-core) z rt/links.txt — zip ich nie przenosi. */
    private fun applyLinks() {
        val f = File(root, "links.txt"); if (!f.exists()) return
        f.readLines().filter { it.contains(" -> ") }.forEach { line ->
            val link = File(root, line.substringBefore(" -> ")); val target = line.substringAfter(" -> ")
            try { link.delete(); android.system.Os.symlink(target, link.path) } catch (e: Throwable) { log("symlink $line: $e") }
        }
        val wgetrc = File(root, "etc/wgetrc.in"); if (wgetrc.exists()) File(root, "etc/wgetrc").writeText(wgetrc.readText().replace("\$RT", root.path))
    }

    /** Zmienne z rt/tools.env (JAVA_HOME, GIT_EXEC_PATH…) z podstawionym $RT i $HOME. */
    private fun toolsEnv(home: File): Map<String, String> {
        val f = File(root, "tools.env"); if (!f.exists()) return emptyMap()
        return f.readLines().filter { it.contains("=") }.associate { line ->
            line.substringBefore("=") to line.substringAfter("=").replace("\$RT", root.path).replace("\$HOME", home.path)
        }
    }

    fun serverEnv(): Map<String, String> {
        val home = File(filesDir, "home")
        return toolsEnv(home) + mapOf(
            "HOME" to home.path,
            "DSH_HOME" to File(home, ".dsh").path,
            "TMPDIR" to cacheDir.path,
            "LD_LIBRARY_PATH" to File(root, "lib").path,
            "PATH" to File(root, "bin").path + ":/system/bin",
            "LANG" to "en_US.UTF-8",
            // node z Termuxa ma wkompilowaną ścieżkę openssl.cnf w prefiksie Termuxa (nieczytelną z innej apki)
            "OPENSSL_CONF" to "/dev/null",
            // python z Termuxa ma wkompilowaną ścieżkę CA w prefiksie Termuxa; w apce podajemy własny plik
            "SSL_CERT_FILE" to File(root, "etc/tls/cert.pem").path,
            "REQUESTS_CA_BUNDLE" to File(root, "etc/tls/cert.pem").path,
            // Android nie ma Landlocka ani bubblewrapa, a dsh odmawia uruchamiania komend bez sandboxa
            // w trybach read-only/workspace-write. Apkę i tak izoluje Android (własny katalog + /sdcard).
            "DSH_PERMISSION_MODE" to "danger-full-access",
        )
    }

    /** Uruchamia android-update.mjs (npm z payloadu); zwraca treść linii "RESULT: ...". */
    fun runUpdater(args: List<String>, onLine: (String) -> Unit): String {
        val home = File(filesDir, "home").apply { mkdirs() }
        val cmd = listOf(File(root, "bin/node").path, File(root, "android-update.mjs").path, "--root", root.path, "--home", home.path) + args
        val pb = ProcessBuilder(cmd).directory(home).redirectErrorStream(true)
        pb.environment().apply { clear(); putAll(serverEnv()) }
        log("update exec: " + cmd.joinToString(" "))
        val p = pb.start()
        var result = "error brak wyniku"
        BufferedReader(InputStreamReader(p.inputStream)).useLines { lines ->
            for (line in lines) {
                log("update: $line")
                if (line.startsWith("RESULT: ")) result = line.removePrefix("RESULT: ") else onLine(line)
            }
        }
        p.waitFor()
        return result
    }

}

