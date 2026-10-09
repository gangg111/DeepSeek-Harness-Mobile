package com.dsh.mobile

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Intent
import android.database.Cursor
import android.database.MatrixCursor
import android.net.LocalServerSocket
import android.net.Uri
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import java.io.File

/**
 * Otwieranie plików z serwera dsh w aplikacjach telefonu: rt/bin/xdg-open (android-xdg-open.mjs) pisze ścieżkę
 * do gniazda abstrakcyjnego, a my otwieramy ją przez ACTION_VIEW. Gniazdo widzą wszystkie apki, więc
 * wpuszczamy tylko procesy z naszym UID (serwer node i jego dzieci).
 */
object Opener {
    const val SOCKET = "com.dsh.mobile.open"
    private val textExt = setOf("md", "markdown", "log", "yml", "yaml", "toml", "ini", "cfg", "conf", "sh", "py", "kt", "kts", "ts", "tsx", "mjs", "cjs", "rs", "go", "c", "h", "cpp")

    fun start(app: App) {
        val server = try { LocalServerSocket(SOCKET) } catch (e: Throwable) { app.log("open: gniazdo $e"); return }
        Thread {
            while (true) {
                val s = try { server.accept() } catch (e: Throwable) { app.log("open: accept $e"); return@Thread }
                try {
                    s.use {
                        val reply = if (it.peerCredentials.uid != android.os.Process.myUid()) "error: obcy proces"
                            else open(app, it.inputStream.bufferedReader().readLine().orEmpty())
                        it.outputStream.write((reply + "\n").toByteArray())
                    }
                } catch (e: Throwable) { app.log("open: $e") }
            }
        }.apply { isDaemon = true }.start()
    }

    fun mime(f: File): String {
        val ext = f.extension.lowercase()
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: if (ext in textExt) "text/plain" else "*/*"
    }

    fun isMarkdown(f: File) = f.extension.lowercase() in setOf("md", "markdown")

    /** Wybór aplikacji do otwarcia pliku (content:// z FilesProvider, tylko do odczytu). */
    fun chooser(ctx: android.content.Context, f: File) {
        val uri = FilesProvider.uri(f)
        val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime(f)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        view.clipData = ClipData.newRawUri(f.name, uri)   // chooser przenosi uprawnienie przez ClipData
        ctx.startActivity(Intent.createChooser(view, "Otwórz: ${f.name}").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION))
    }

    private fun open(app: App, path: String): String {
        val f = File(path).canonicalFile
        app.log("open: ${f.path}")
        if (!f.exists()) return "error: nie ma takiego pliku: ${f.path}"
        return try {
            if (f.isDirectory) {
                // Folder da się pokazać tylko w pamięci współdzielonej; do katalogów prywatnych apki menedżer plików nie ma dostępu.
                val ext = Environment.getExternalStorageDirectory().canonicalPath
                if (f.path != ext && !f.path.startsWith("$ext/")) return "error: ten folder leży w prywatnym katalogu apki, menedżer plików go nie zobaczy"
                val uri = DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:" + f.path.removePrefix(ext).trimStart('/'))
                app.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, DocumentsContract.Document.MIME_TYPE_DIR).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } else if (isMarkdown(f)) {
                app.log("open: → czytnik md")
                MdActivity.open(app, f)
            } else chooser(app, f)
            "ok"
        } catch (e: ActivityNotFoundException) { "error: żadna aplikacja nie otwiera tego typu" }
        catch (e: Throwable) { app.log("open: $e"); "error: $e" }
    }
}

/** Provider tylko do odczytu: content://com.dsh.mobile.files/<ścieżka>. Nieeksportowany — dostęp wyłącznie z nadanym uprawnieniem do URI. */
class FilesProvider : ContentProvider() {
    companion object {
        const val AUTHORITY = "com.dsh.mobile.files"
        fun uri(f: File): Uri = Uri.Builder().scheme("content").authority(AUTHORITY).path(f.path).build()
    }

    override fun onCreate() = true

    private fun file(uri: Uri): File {
        val f = File(uri.path ?: "").canonicalFile
        val roots = listOf(context!!.dataDir.canonicalPath, Environment.getExternalStorageDirectory().canonicalPath)
        if (roots.none { f.path.startsWith("$it/") }) throw SecurityException("poza dozwolonymi katalogami")
        return f
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r") throw SecurityException("tylko odczyt")
        return ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun getType(uri: Uri) = Opener.mime(file(uri))

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor {
        val f = file(uri)
        val cols = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        return MatrixCursor(cols, 1).apply {
            addRow(cols.map { when (it) { OpenableColumns.DISPLAY_NAME -> f.name; OpenableColumns.SIZE -> f.length(); else -> null } })
        }
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? = throw UnsupportedOperationException()
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
}
