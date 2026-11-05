package io.github.jtwang.tailpocket

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import kotlin.coroutines.resume

/** A pairing invite from a QR code, link or same-Wi-Fi delivery. It lets a phone pair until it expires: do not log it. */
@Serializable
data class TailPocketInvite(
    val v: Int,
    val address: String,
    val port: Int,
    val key: String,
    val proof: String,
    val expiresAt: Long,
    val name: String? = null,
)

/** Everything a paired phone needs to reach its computer. Holds the phone's private key: keep it in [TailPocketKeystoreStore]. */
@Serializable
data class TailPocketHostLink(
    val address: String,
    val port: Int,
    val name: String,
    /** What the computer's app sent along (a token, settings…), or null. */
    val payload: String? = null,
    val key: String,
) {
    fun encode(): String = json.encodeToString(serializer(), this)

    companion object {
        fun decode(text: String): TailPocketHostLink = json.decodeFromString(serializer(), text)
    }
}

/**
 * A failure with a fixed code: invalid-invite, invalid-key, invalid-link, expired, unauthorized, taken,
 * unreachable, denied, local-failed, cancelled, timeout, failed.
 */
class TailPocketException(val code: String) : Exception(code)

/** A local route to the computer: point OkHttp, HttpURLConnection or a WebSocket client at [baseUrl]. */
class TailPocketConnection internal constructor(private val native: TailPocketNative, private val handle: Long, val port: Int) : AutoCloseable {
    private var closed = false
    val baseUrl: String get() = "http://127.0.0.1:$port"

    /** How the tunnel reaches the computer now: `{"route":"direct"}`, `{"route":"relay","relay":code}` or `{"route":"unknown"}`. Up to 3 s, on its own thread. */
    suspend fun path(): Map<String, String> = suspendCancellableCoroutine { cont ->
        callers.execute {
            val out = routeFields(native.path(handle))
            if (cont.isActive) cont.resume(out)
        }
    }

    @Synchronized
    override fun close() {
        if (closed) return
        closed = true
        native.stop(handle)
    }
}

/** A same-Wi-Fi pairing in progress: show [code]; [finish] returns the invite once the computer's user approves. */
class TailPocketPendingLocalPairing internal constructor(private val native: TailPocketNative, private val op: Long, val code: String) {
    suspend fun finish(timeoutMs: Long = 300_000): TailPocketInvite =
        blocking(native, op) { native.localPairFinish(op, timeoutMs) }.let { decode(TailPocketInvite.serializer(), it) }

    fun cancel() = native.cancel(op)
}

internal val json = Json { ignoreUnknownKeys = true; encodeDefaults = false; explicitNulls = false }
private val ops = AtomicLong()
private val callers = Executors.newCachedThreadPool { r -> Thread(r, "tailpocket").apply { isDaemon = true } }

private fun failure(text: String): String? = try {
    json.parseToJsonElement(text).jsonObject["error"]?.jsonPrimitive?.content
} catch (_: Exception) { null }

internal fun <T> decode(serializer: kotlinx.serialization.KSerializer<T>, text: String): T {
    failure(text)?.let { throw TailPocketException(it) }
    return try { json.decodeFromString(serializer, text) } catch (_: Exception) { throw TailPocketException("failed") }
}

internal fun routeFields(text: String): Map<String, String> {
    val o = json.parseToJsonElement(text).jsonObject
    val route = o["route"]?.jsonPrimitive?.content ?: return mapOf("route" to "unknown")
    val relay = o["relay"]?.jsonPrimitive?.content
    return if (relay.isNullOrEmpty()) mapOf("route" to route) else mapOf("route" to route, "relay" to relay)
}

/** Runs a blocking native call on its own thread; cancelling the coroutine cancels the native operation. */
internal suspend fun blocking(native: TailPocketNative, op: Long, call: () -> String): String =
    suspendCancellableCoroutine { cont ->
        cont.invokeOnCancellation { native.cancel(op) }
        callers.execute { val out = call(); if (cont.isActive) cont.resume(out) }
    }

class TailPocket private constructor(private val native: TailPocketNative) {
    /** A new phone identity. Create it once and keep it ([TailPocketKeystoreStore.phoneKey] does both). */
    fun newKey(): String = native.newKey()

    /** The "nodekey:…" the computer lists for this phone, or null for an invalid key. */
    fun publicKey(key: String): String? = native.publicKey(key).ifEmpty { null }

    fun decodeInvite(text: String, prefix: String = DEFAULT_PREFIX): TailPocketInvite = decode(TailPocketInvite.serializer(), native.decodeInvite(text, prefix))

    /** Joins the computer's pairing window; returns the [TailPocketHostLink] to store. */
    suspend fun pair(invite: TailPocketInvite, phoneKey: String, device: String, derpMapUrl: String = "", timeoutMs: Long = 90_000): TailPocketHostLink {
        val op = ops.incrementAndGet()
        val text = json.encodeToString(TailPocketInvite.serializer(), invite)
        return decode(TailPocketHostLink.serializer(), blocking(native, op) { native.pair(op, text, phoneKey, device, derpMapUrl, timeoutMs) })
    }

    /** Opens a local route to the computer. Nothing goes over the network until a client connects. */
    fun connect(link: TailPocketHostLink, derpMapUrl: String = ""): TailPocketConnection {
        val out = native.connect(link.encode(), derpMapUrl)
        failure(out)?.let { throw TailPocketException(it) }
        val obj = json.parseToJsonElement(out).jsonObject
        return TailPocketConnection(native, obj.getValue("handle").jsonPrimitive.content.toLong(), obj.getValue("port").jsonPrimitive.content.toInt())
    }

    /** Starts same-Wi-Fi pairing with a host at "ip:port" (see [TailPocketNearbyHosts.resolve]); returns the code to show. */
    suspend fun beginLocalPairing(address: String, device: String, label: String = ""): TailPocketPendingLocalPairing {
        val op = ops.incrementAndGet()
        val out = blocking(native, op) { native.localPairStart(op, address, label, device) }
        failure(out)?.let { throw TailPocketException(it) }
        val code = json.parseToJsonElement(out).jsonObject.getValue("code").jsonPrimitive.content
        return TailPocketPendingLocalPairing(native, op, code)
    }

    companion object {
        const val DEFAULT_PREFIX = "tailpocket1:"

        /** The SDK backed by the bundled native library. */
        val default: TailPocket by lazy { TailPocket(GoNative) }

        /** The SDK over another native layer (tests). */
        fun with(native: TailPocketNative) = TailPocket(native)

        /** Finds invite text in scanned or pasted text: a bare code, or a link containing it. */
        fun inviteText(text: String, prefix: String = DEFAULT_PREFIX): String? {
            val start = text.indexOf(prefix).takeIf { it >= 0 } ?: return null
            val tail = text.substring(start + prefix.length).takeWhile { it.isLetterOrDigit() && it.code < 128 || it == '-' || it == '_' }
            return if (tail.isEmpty()) null else prefix + tail
        }
    }
}
