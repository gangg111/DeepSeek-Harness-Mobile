package com.dsh.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder

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
        @Volatile var lastText = "Uruchamianie…"
        @Volatile var running = false
        @Volatile var stopRequested = false
        @Volatile var updating = false
        @Volatile var availableVersion: String? = null
        @Volatile var instance: ServerService? = null

        fun start(ctx: Context) {
            stopRequested = false
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
        // Użytkownik zmiótł powiadomienie (gest / „Wyczyść"): wystawiamy je od nowa, usługa działa dalej.
        if (intent?.action == ACTION_REPOST) { startForeground(NOTIF_ID, notification(lastText)); return START_STICKY }
        startForeground(NOTIF_ID, notification(lastText))
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

    /** Aktualizacja dsh w apce: zatrzymuje serwer, odpala android-update.mjs (npm z payloadu), potem pętla restartuje serwer. */
    private fun runUpdate() {
        if (updating) return
        updating = true
        val app = application as App
        Thread {
            try {
                update("Aktualizacja: zatrzymuję serwer…")
                App.process?.destroyForcibly(); App.url = null
                Thread.sleep(1500)
                val result = app.runUpdater(listOf("--tag", "latest")) { line -> update("Aktualizacja: $line") }
                val msg = when {
                    result.startsWith("ok ") -> "Zaktualizowano dsh do ${result.removePrefix("ok ")}"
                    result.startsWith("uptodate ") -> "dsh ${result.removePrefix("uptodate ")} jest aktualny"
                    else -> "Aktualizacja nie powiodła się: ${result.removePrefix("error ")}"
                }
                availableVersion = null
                app.log(msg); update(msg); App.lastUpdateMessage = msg
            } catch (e: Throwable) { app.log("update error: $e"); update("Aktualizacja: błąd $e") }
            finally { updating = false }
        }.start()
    }

    /** Sprawdzenie w tle, czy npm ma nowszą wersję; wynik trafia do tekstu powiadomienia. */
    fun checkForUpdate() {
        Thread {
            try {
                val app = application as App
                val r = app.runUpdater(listOf("--tag", "latest", "--check")) {}
                if (r.startsWith("available ")) { availableVersion = r.removePrefix("available "); update("Dostępna aktualizacja dsh ${availableVersion}. Otwórz powiadomienie → Aktualizuj.") }
            } catch (_: Throwable) {}
        }.start()
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
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentTitle("DeepSeek Harness działa")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setDeleteIntent(repost)
            .addAction(Notification.Action.Builder(null, "Zatrzymaj", stop).build())
            .addAction(Notification.Action.Builder(null, if (availableVersion != null) "Aktualizuj do $availableVersion" else "Aktualizuj", upd).build())
            .setStyle(Notification.BigTextStyle().bigText(text))
            .build()
    }
}
