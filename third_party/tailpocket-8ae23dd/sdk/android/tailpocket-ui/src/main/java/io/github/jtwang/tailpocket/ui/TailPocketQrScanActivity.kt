package io.github.jtwang.tailpocket.ui

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import io.github.jtwang.tailpocket.TailPocket
import io.github.jtwang.tailpocket.TailPocketException
import kotlinx.coroutines.CompletableDeferred
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/** A full-screen [TailPocketQrScanner]; [scan] opens it from anywhere and returns the invite text. */
class TailPocketQrScanActivity : ComponentActivity() {
    private var request = -1L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        request = intent.getLongExtra(EXTRA_REQUEST, -1)
        val prefix = intent.getStringExtra(EXTRA_PREFIX) ?: TailPocket.DEFAULT_PREFIX
        setContent {
            TailPocketQrScanner(prefix = prefix, onInvite = { text ->
                waiting.remove(request)?.complete(text)
                finish()
            })
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (isFinishing) waiting.remove(request)?.completeExceptionally(TailPocketException("cancelled"))
    }

    companion object {
        private const val EXTRA_REQUEST = "tailPocket.request"
        private const val EXTRA_PREFIX = "tailPocket.prefix"
        private val waiting = ConcurrentHashMap<Long, CompletableDeferred<String>>()
        private val ids = AtomicLong()

        /** Shows the scanner and suspends until a code is scanned (or throws "cancelled"). */
        suspend fun scan(context: Context, prefix: String = TailPocket.DEFAULT_PREFIX): String {
            val id = ids.incrementAndGet()
            val result = CompletableDeferred<String>()
            waiting[id] = result
            context.startActivity(Intent(context, TailPocketQrScanActivity::class.java).putExtra(EXTRA_REQUEST, id).putExtra(EXTRA_PREFIX, prefix)
                .apply { if (context !is android.app.Activity) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) })
            return try { result.await() } finally { waiting.remove(id) }
        }
    }
}
