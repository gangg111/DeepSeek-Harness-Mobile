package com.dsh.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.IBinder
import java.io.File

/**
 * Usługa pierwszoplanowa trzymająca proces node z serwerem dsh, żeby Android nie ubijał go,
 * gdy aplikacja jest w tle. Powiadomienie ma przycisk „Zatrzymaj".
 */
class ServerService : Service() {
    companion object {
        const val CHANNEL = "dsh-server"
        const val NOTIF_ID = 1
        const val ACTION_STOP = "com.dsh.mobile.STOP"
        const val ACTION_UPDATE = "com.dsh.mobile.UPDATE"
        const val ACTION_REPOST = "com.dsh.mobile.REPOST"
        const val ACTION_INSTALL_STATUS = "com.dsh.mobile.INSTALL_STATUS"
        /** Wydania APK: gdy aktualizator w apce nie poradzi sobie z nową wersją dsh, user ma stąd pobrać nową apkę. */
        const val RELEASES_URL = "https://github.com/gangg111/DeepSeek-Harness-Mobile/releases"
        @Volatile var updateFailed = false
        @Volatile var lastText = "Uruchamianie…"
        @Volatile var running = false
        @Volatile var stopRequested = false
        @Volatile var updating = false
        @Volatile var periodicCheck = false
        @Volatile var availableVersion: String? = null
        /** Nowsze APK z wydań na GitHubie (pierwszeństwo przed dsh z npm). */
        @Volatile var availableApk: ApkUpdater.Release? = null
        /** Systemowe potwierdzenie instalacji pobranego APK (z usługi w tle nie wolno go otworzyć samemu). */
        @Volatile var installIntent: PendingIntent? = null
        /** Postęp pobierania APK (null = nie pobiera) i ostatni błąd aktualizacji — dla przycisku w interfejsie dsh. */
        @Volatile var apkPercent: Int? = null
        @Volatile var updateError: String? = null

        /**
         * Stan dla niebieskiego przycisku aktualizacji w interfejsie dsh (format „presentation” mostka Desktop:
         * phase idle|available|downloading|installing|ready|error, percent, version, failure). Czyta go WebView przez DshMobileUpdate.
         */
        fun bridgeStatus(): String {
            val o = org.json.JSONObject()
            val apk = availableApk
            val apkLabel = apk?.let { "DSH Mobile ${it.versionName} (build ${it.versionCode})" }
            when {
                installIntent != null -> { o.put("phase", "ready"); apkLabel?.let { o.put("version", it) } }
                apkPercent != null -> { o.put("phase", "downloading"); o.put("percent", apkPercent); apkLabel?.let { o.put("version", it) } }
                updating -> o.put("phase", "installing")
                updateError != null -> { o.put("phase", "error"); o.put("failure", "download") }
                updateFailed -> { o.put("phase", "error"); o.put("failure", "install") }
                apkLabel != null -> { o.put("phase", "available"); o.put("version", apkLabel) }
                availableVersion != null -> { o.put("phase", "available"); o.put("version", "dsh $availableVersion") }
                else -> o.put("phase", "idle")
            }
            return o.toString()
        }

        /** Kliknięcie przycisku w interfejsie dsh: gotowe APK → systemowe okno instalacji (apka jest na wierzchu), inaczej „Aktualizuj”. */
        fun bridgeOpen(ctx: Context) {
            val install = installIntent
            if (install != null) { try { install.send(); return } catch (_: Throwable) {} }
            ctx.startService(Intent(ctx, ServerService::class.java).setAction(ACTION_UPDATE))
        }
        @Volatile var instance: ServerService? = null
        /** Ostatnie sprawdzenie aktualizacji (GitHub, potem npm); sprawdzamy przy starcie serwera, powrocie do apki i co 6 h. */
        @Volatile var lastCheckAt = 0L
        const val CHECK_MIN_INTERVAL_MS = 30 * 60 * 1000L
        /** Restart serwera po awarii (co 3 s w pętli) sprawdza najwyżej co 5 min; ręczny start — zawsze (forceCheckOnBoot). */
        const val CHECK_CRASH_RESTART_MS = 5 * 60 * 1000L
        @Volatile var forceCheckOnBoot = true
        const val CHECK_PERIOD_MS = 6 * 60 * 60 * 1000L

        fun start(ctx: Context) {
            stopRequested = false
            forceCheckOnBoot = true   // ręczne uruchomienie (start apki, otwarcie po „Zatrzymaj”): sprawdź aktualizacje bez progu
            ctx.startForegroundService(Intent(ctx, ServerService::class.java))
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Serwer DeepSeek Harness", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Trzyma serwer harnessu przy życiu w tle"; setShowBadge(false)
        })
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopRequested = true
            App.process?.destroyForcibly()
            App.url = null
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_UPDATE) { runUpdate(); return START_STICKY }
        if (intent?.action == ACTION_INSTALL_STATUS) { onInstallStatus(intent); return START_STICKY }
        // Użytkownik zmiótł powiadomienie (gest / „Wyczyść"): wystawiamy je od nowa, usługa działa dalej.
        if (intent?.action == ACTION_REPOST) { startForeground(NOTIF_ID, notification(lastText)); return START_STICKY }
        startForeground(NOTIF_ID, notification(lastText))
        if (!periodicCheck) {
            periodicCheck = true
            Thread {
                try { while (true) { Thread.sleep(CHECK_PERIOD_MS); maybeCheckForUpdate(CHECK_PERIOD_MS - 60_000L) } } catch (_: InterruptedException) {}
            }.apply { isDaemon = true }.start()
        }
        if (!running) {
            running = true
            Thread {
                val app = application as App
                var attempt = 0
                try {
                    // Po nieoczekiwanym zgonie serwera restart po 3 s (bez limitu, ale z odstępem).
                    while (!stopRequested) {
                        App.url = null
                        try { app.boot() } catch (e: Throwable) { app.log("boot error: $e") }
                        if (stopRequested) break
                        if (updating) { while (updating && !stopRequested) Thread.sleep(500); continue }
                        attempt++
                        update("Serwer padł, restart #$attempt za 3 s…")
                        Thread.sleep(3000)
                    }
                } catch (_: InterruptedException) {} finally {
                    running = false
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf()
                }
            }.start()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        instance = null
        stopRequested = true
        App.process?.destroyForcibly()
        super.onDestroy()
    }

    /**
     * Przycisk „Aktualizuj”: najpierw nowsze APK z wydań na GitHubie (ApkUpdater), a dopiero gdy go nie ma (albo GitHub nie odpowiada)
     * aktualizacja dsh w apce: zatrzymuje serwer, odpala android-update.mjs (npm z payloadu), potem pętla restartuje serwer.
     */
    private fun runUpdate() {
        // APK już pobrane i czeka na potwierdzenie: nie pobieramy drugi raz, tylko otwieramy okno instalacji.
        installIntent?.let { pending -> try { pending.send(); return } catch (_: Throwable) { installIntent = null } }
        if (updating) return
        updating = true
        val app = application as App
        updateError = null
        Thread {
            val apk = try { ApkUpdater.newer(app) { app.log(it) } } catch (e: Throwable) { app.log("apk: sprawdzenie GitHuba nie powiodło się: $e"); null }
            if (apk != null) {
                // Serwer działa dalej w trakcie pobierania; instalacja i tak zastąpi proces apki.
                try {
                    availableApk = apk
                    val label = "DSH Mobile ${apk.versionName}"
                    app.log("apk: pobieram $label (versionCode ${apk.versionCode}, ${apk.size} B)")
                    update("Pobieranie $label…")
                    apkPercent = 0
                    ApkUpdater.downloadAndCommit(app, apk) { done, total -> apkPercent = (done * 100 / maxOf(total, 1)).toInt(); update("Pobieranie $label: ${done * 100 / maxOf(total, 1)}% (${done shr 20} z ${total shr 20} MB)") }
                    app.log("apk: pobrano i sprawdzono md5, czekam na potwierdzenie instalacji")
                    update("Pobrano $label (md5 zgodne). Potwierdź instalację — przycisk „Zainstaluj”.")
                } catch (e: Throwable) {
                    updateError = "${e.message ?: e}"
                    app.log("apk: błąd $e"); update("Aktualizacja apki nie powiodła się: ${e.message ?: e}. Spróbuj ponownie „Aktualizuj”.")
                } finally { apkPercent = null; updating = false }
                return@Thread
            }
            try {
                update("Aktualizacja: zatrzymuję serwer…")
                App.process?.destroyForcibly(); App.url = null
                Thread.sleep(1500)
                val result = app.runUpdater(listOf("--tag", "latest")) { line -> update("Aktualizacja: $line") }
                val failedFile = File(app.filesDir, "home/.update-failed")
                val msg = when {
                    result.startsWith("ok ") -> { failedFile.delete(); updateFailed = false; "Zaktualizowano dsh do ${result.removePrefix("ok ")}" }
                    result.startsWith("uptodate ") -> { failedFile.delete(); "dsh ${result.removePrefix("uptodate ")} jest aktualny" }
                    else -> {
                        // Zapamiętaj, żeby po restarcie nie proponować w kółko tej samej wersji bez słowa wyjaśnienia.
                        try { failedFile.writeText("${availableVersion ?: "?"}\n${result.removePrefix("error ")}") } catch (_: Throwable) {}
                        updateFailed = true
                        "Aktualizacja nie powiodła się: ${result.removePrefix("error ")}. Ta wersja dsh wymaga nowej wersji apki — pobierz ją z $RELEASES_URL (przycisk „Pobierz APK”)."
                    }
                }
                availableVersion = null
                app.log(msg); update(msg); App.lastUpdateMessage = msg
            } catch (e: Throwable) { app.log("update error: $e"); update("Aktualizacja: błąd $e") }
            finally { updating = false }
        }.start()
    }

    /** Sprawdza aktualizacje, jeśli od ostatniego sprawdzenia minęło co najmniej [minIntervalMs] (i nic się teraz nie aktualizuje). */
    fun maybeCheckForUpdate(minIntervalMs: Long = CHECK_MIN_INTERVAL_MS) {
        val now = System.currentTimeMillis()
        if (updating || installIntent != null || now - lastCheckAt < minIntervalMs) return
        lastCheckAt = now
        checkForUpdate()
    }

    /** Sprawdzenie w tle: najpierw nowsze APK na GitHubie, potem nowsza wersja dsh w npm; wynik trafia do tekstu powiadomienia. */
    fun checkForUpdate() {
        Thread {
            try {
                val app = application as App
                val apk = try { ApkUpdater.newer(app) { app.log(it) } } catch (e: Throwable) { app.log("apk: sprawdzenie GitHuba nie powiodło się: $e"); null }
                if (apk != null) {
                    availableApk = apk
                    app.log("apk: dostępna ${apk.versionName} (versionCode ${apk.versionCode})")
                    update("Dostępna nowa wersja DSH Mobile ${apk.versionName}. Otwórz powiadomienie → Aktualizuj.")
                    return@Thread
                }
                val r = app.runUpdater(listOf("--tag", "latest", "--check")) {}
                if (r.startsWith("available ")) {
                    availableVersion = r.removePrefix("available ")
                    val failed = try { File(app.filesDir, "home/.update-failed").readText().split("\n", limit = 2) } catch (_: Throwable) { null }
                    if (failed != null && failed.size == 2 && failed[0] == availableVersion) {
                        updateFailed = true
                        update("dsh $availableVersion nie da się zaktualizować z apki (${failed[1].take(160)}). Pobierz nową wersję apki: $RELEASES_URL — przycisk „Pobierz APK”.")
                    } else update("Dostępna aktualizacja dsh ${availableVersion}. Otwórz powiadomienie → Aktualizuj.")
                }
            } catch (_: Throwable) {}
        }.start()
    }

    /** Wynik sesji PackageInstaller: prośba o potwierdzenie, sukces albo błąd. */
    private fun onInstallStatus(intent: Intent) {
        val app = application as App
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
        app.log("apk: status instalacji $status ${message ?: ""}")
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION") val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                installIntent = PendingIntent.getActivity(this, 6, confirm, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
                // Gdy apka jest na wierzchu, system pozwoli otworzyć okno od razu; w tle zostaje przycisk w powiadomieniu.
                try { startActivity(confirm) } catch (e: Throwable) { app.log("apk: okno instalacji tylko z powiadomienia ($e)") }
                update("Nowa wersja DSH Mobile gotowa do instalacji — dotknij „Zainstaluj”.")
            }
            PackageInstaller.STATUS_SUCCESS -> { installIntent = null; availableApk = null; update("Zainstalowano nową wersję DSH Mobile.") }
            else -> { installIntent = null; update("Instalacja nie powiodła się: ${message ?: status}. Spróbuj ponownie „Aktualizuj”.") }
        }
    }

    fun update(text: String) {
        lastText = text
        getSystemService(NotificationManager::class.java).notify(NOTIF_ID, notification(text))
    }


    private fun notification(text: String): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, ServerService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        val upd = PendingIntent.getService(this, 2, Intent(this, ServerService::class.java).setAction(ACTION_UPDATE), PendingIntent.FLAG_IMMUTABLE)
        val repost = PendingIntent.getService(this, 3, Intent(this, ServerService::class.java).setAction(ACTION_REPOST), PendingIntent.FLAG_IMMUTABLE)
        val releases = PendingIntent.getActivity(this, 4, Intent(Intent.ACTION_VIEW, android.net.Uri.parse(RELEASES_URL)), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentTitle("DeepSeek Harness działa")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setDeleteIntent(repost)
            .addAction(Notification.Action.Builder(null, "Zatrzymaj", stop).build())
            .apply { if (installIntent == null) addAction(Notification.Action.Builder(null, when {
                availableApk != null -> "Aktualizuj apkę do ${availableApk!!.versionName}"
                availableVersion != null -> "Aktualizuj do $availableVersion"
                else -> "Aktualizuj"
            }, upd).build()) }
            .apply {
                val install = installIntent
                if (install != null) addAction(Notification.Action.Builder(null, "Zainstaluj", install).build())
                else if (updateFailed) addAction(Notification.Action.Builder(null, "Pobierz APK", releases).build())
            }
            .setStyle(Notification.BigTextStyle().bigText(text))
            .build()
    }
}
