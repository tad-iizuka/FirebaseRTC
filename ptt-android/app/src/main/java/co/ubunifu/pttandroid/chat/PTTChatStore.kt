/**
 * PTTChatStore.kt
 *
 * [Phase5: テキストチャット]
 * Web版/iOS版と同じ設計: 書き込みはtoken-server経由のみ、配信・履歴表示は
 * Firestoreのリアルタイムリスナー(addSnapshotListener)に任せる。LiveKitの
 * Data Channelは使わない(サーバーを経由しないためモデレーション・履歴配信・
 * BAN時の読み取り遮断ができないため)。BANされるとfirestore.rules側で
 * 読み取り権限自体を失う(PTTRoomManagerのBAN即時反映と同じ二重の強制力)。
 *
 * また、自分がこのルームの「アクティブな」メンバーであることを
 * firestore.rulesが要求するため(rooms/{roomId}/members/{uid}.status=='active')、
 * BAN済みユーザーの購読は自動的にエラーになる。
 *
 * [Phase16: 画像/動画/PDFの添付]
 * Web版(ptt-client/src/stores/chat.ts)・iOS版(PTTChatStore.swift)の移植。
 * アップロードはtoken-serverを経由せず、署名付きURLへ直接PUTする
 * (token-server/lib/attachments.js参照)。流れは以下の3段階:
 *   1. POST /rooms/:roomId/attachments/upload-url でGCS書き込み用の
 *      署名付きURL(5分間有効)を発行してもらう
 *   2. そのURLへ直接PUT(token-serverはバイナリを中継しない)
 *   3. POST /rooms/:roomId/messages で attachment として確定する
 *      (ここでサーバー側がGCS上の実体を検証する。クライアント自己申告の
 *      contentType/sizeは信用されない)
 * 画像は送信前にWeb版と同じ基準(1MB・最大辺1920px)でクライアント側圧縮を
 * 試みる(ベストエフォート。失敗しても元ファイルのまま送信する)。
 * 閲覧用の署名付きURL(attachment-url/thumbnail-url)も有効期限が短い(5分)ため、
 * messageIdをキーにメモリ内キャッシュし、期限が近づくまで再発行しない。
 */
package co.ubunifu.pttandroid.chat

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import co.ubunifu.pttandroid.R
import co.ubunifu.pttandroid.model.AttachmentKind
import co.ubunifu.pttandroid.model.ChatAttachment
import co.ubunifu.pttandroid.model.ChatMessage
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.Query
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import okio.source
import org.json.JSONObject

class ChatApiException(val statusCode: Int, message: String) : Exception(message)

class PTTChatStore(
    context: Context,
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS) // [Phase16] 添付ファイルPUTは本文送信に時間がかかりうる
        .build(),
) {
    // [多言語化] エラーメッセージのローカライズ用。
    private val appContext = context.applicationContext
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()
    private val db = FirebaseFirestore.getInstance()

    private val _messages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val messages: StateFlow<List<ChatMessage>> = _messages

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage

    private var listener: ListenerRegistration? = null

    /** ルーム入室時に呼ぶ。直近200件の履歴をリアルタイムに購読する。 */
    fun start(roomId: String) {
        stop()
        listener = db.collection("rooms").document(roomId).collection("messages")
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(200)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    _errorMessage.value = appContext.getString(R.string.errors_chat_fetch, error.message)
                    return@addSnapshotListener
                }
                val docs = snapshot?.documents.orEmpty().map { doc ->
                    ChatMessage(
                        id = doc.id,
                        uid = doc.getString("uid") ?: "",
                        displayName = doc.getString("displayName") ?: "",
                        text = doc.getString("text") ?: "",
                        createdAtMillis = doc.getDate("createdAt")?.time,
                        attachment = parseAttachment(doc.get("attachment") as? Map<*, *>),
                    )
                }
                _messages.value = docs.reversed() // 古い→新しい順に並べ直す
            }
    }

    /** ルーム退出時に呼ぶ。 */
    fun stop() {
        listener?.remove()
        listener = null
        _messages.value = emptyList()
        attachmentUrlCache.clear()
        thumbnailUrlCache.clear()
    }

    private fun parseAttachment(raw: Map<*, *>?): ChatAttachment? {
        if (raw == null) return null
        val storagePath = raw["storagePath"] as? String ?: return null
        return ChatAttachment(
            storagePath = storagePath,
            thumbnailPath = raw["thumbnailPath"] as? String,
            contentType = raw["contentType"] as? String ?: "",
            kind = AttachmentKind.fromWire(raw["kind"] as? String),
            fileName = raw["fileName"] as? String ?: "",
            size = (raw["size"] as? Number)?.toLong() ?: 0L,
        )
    }

    /** テキストを送信する。永続化・配信はtoken-server経由で行われるため、
     *  このメソッド自身はFirestoreへ書き込まない。 */
    suspend fun sendMessage(tokenServerUrl: String, idToken: String, roomId: String, text: String) =
        withContext(Dispatchers.IO) {
            val trimmed = text.trim()
            if (trimmed.isEmpty()) return@withContext

            val body = JSONObject().apply { put("text", trimmed) }
            postMessage(tokenServerUrl, idToken, roomId, body)
        }

    /**
     * [Phase16] 画像/動画/PDFを添付してメッセージを送信する。
     *   1. 画像なら圧縮を試みる(compressImageIfNeeded、動画/PDFはそのまま)
     *   2. アップロードURLを発行してもらう
     *   3. そのURLへ直接PUT(token-serverを経由しない)
     *   4. POST /messages で確定する(ここでサーバー側がGCS実体を検証する)
     *
     * Web版のsendPendingFile(ChatPanel.vue)と同じく、text入力欄とは独立に
     * 空文字のtextで送る(呼び出し元でtext入力欄をクリアする必要はない)。
     */
    suspend fun sendAttachment(
        tokenServerUrl: String,
        idToken: String,
        roomId: String,
        uri: Uri,
        text: String = "",
    ) = withContext(Dispatchers.IO) {
        _errorMessage.value = null
        try {
            val meta = resolveAttachmentMeta(uri)
            if (meta.size > MAX_ATTACHMENT_BYTES) {
                val message = appContext.getString(R.string.errors_chat_attachment_too_large)
                _errorMessage.value = message
                throw ChatApiException(400, message)
            }
            val upload = compressImageIfNeeded(meta)

            val uploadUrlBody = JSONObject().apply {
                put("contentType", upload.contentType)
                put("fileName", upload.fileName)
                put("size", upload.size)
            }
            val encodedRoomId = URLEncoder.encode(roomId, "UTF-8")
            val uploadUrlRequest = Request.Builder()
                .url("${tokenServerUrl.trimEnd('/')}/rooms/$encodedRoomId/attachments/upload-url")
                .addHeader("Authorization", "Bearer $idToken")
                .post(uploadUrlBody.toString().toRequestBody(jsonMediaType))
                .build()

            val uploadUrlData = httpClient.newCall(uploadUrlRequest).execute().use { response ->
                if (!response.isSuccessful) {
                    throw ChatApiException(response.code, extractErrorMessage(response.body?.string(), response.code))
                }
                JSONObject(response.body?.string().orEmpty())
            }
            val uploadUrl = uploadUrlData.getString("uploadUrl")
            val storagePath = uploadUrlData.getString("storagePath")

            val putRequest = Request.Builder()
                .url(uploadUrl)
                .put(upload.toRequestBody())
                .build()
            httpClient.newCall(putRequest).execute().use { response ->
                if (!response.isSuccessful) {
                    throw ChatApiException(
                        response.code,
                        appContext.getString(R.string.errors_chat_attachment_upload_failed),
                    )
                }
            }

            val messageBody = JSONObject().apply {
                put("text", text.trim())
                put(
                    "attachment",
                    JSONObject().apply {
                        put("storagePath", storagePath)
                        put("fileName", upload.fileName)
                    },
                )
            }
            postMessage(tokenServerUrl, idToken, roomId, messageBody)
        } catch (e: Exception) {
            if (_errorMessage.value == null) {
                _errorMessage.value = e.message ?: appContext.getString(R.string.errors_chat_attachment_upload_failed)
            }
            throw e
        }
    }

    private suspend fun postMessage(tokenServerUrl: String, idToken: String, roomId: String, body: JSONObject) =
        withContext(Dispatchers.IO) {
            val encodedRoomId = URLEncoder.encode(roomId, "UTF-8")
            val request = Request.Builder()
                .url("${tokenServerUrl.trimEnd('/')}/rooms/$encodedRoomId/messages")
                .addHeader("Authorization", "Bearer $idToken")
                .post(body.toString().toRequestBody(jsonMediaType))
                .build()

            httpClient.newCall(request).execute().use { response ->
                if (response.code != 201) {
                    val message = extractErrorMessage(
                        response.body?.string(),
                        response.code,
                        appContext.getString(R.string.errors_chat_send_failed, response.code),
                    )
                    _errorMessage.value = message
                    throw ChatApiException(response.code, message)
                }
            }
        }

    private fun extractErrorMessage(rawBody: String?, statusCode: Int, fallback: String? = null): String {
        val fromBody = try {
            rawBody?.let { JSONObject(it).optString("error").takeIf { s -> s.isNotEmpty() } }
        } catch (e: Exception) {
            null
        }
        return fromBody ?: fallback ?: appContext.getString(R.string.errors_chat_attachment_upload_failed)
    }

    // ------------------------------------------------------------------
    // [Phase16] 添付ファイルのメタデータ解決・クライアント側圧縮
    // ------------------------------------------------------------------

    /** アップロード対象のバイナリソース。圧縮済みならbytesを、そうでなければ
     *  ContentResolver経由でストリーミングするためuriを保持する(動画等の
     *  大きいファイルを丸ごとメモリへ載せないため)。 */
    private class UploadPayload(
        val fileName: String,
        val contentType: String,
        val size: Long,
        private val bytes: ByteArray?,
        private val uri: Uri?,
        private val resolver: android.content.ContentResolver?,
    ) {
        fun toRequestBody(): RequestBody {
            val mediaType = contentType.toMediaTypeOrNull()
            val fixedBytes = bytes
            if (fixedBytes != null) {
                return fixedBytes.toRequestBody(mediaType)
            }
            val sourceUri = uri ?: throw IOException("添付ファイルの読み込みに失敗しました")
            val sourceResolver = resolver ?: throw IOException("添付ファイルの読み込みに失敗しました")
            val length = size
            return object : RequestBody() {
                override fun contentType() = mediaType
                override fun contentLength() = length
                override fun writeTo(sink: BufferedSink) {
                    val stream = sourceResolver.openInputStream(sourceUri)
                        ?: throw IOException("添付ファイルの読み込みに失敗しました")
                    stream.use { sink.writeAll(it.source()) }
                }
            }
        }
    }

    private data class AttachmentMeta(val uri: Uri, val fileName: String, val contentType: String, val size: Long)

    /** 選択されたUriから、ファイル名・MIMEタイプ・サイズを解決する。 */
    private fun resolveAttachmentMeta(uri: Uri): AttachmentMeta {
        val resolver = appContext.contentResolver
        var fileName = uri.lastPathSegment ?: "file"
        var size = -1L
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (nameIdx >= 0) cursor.getString(nameIdx)?.let { fileName = it }
                if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) size = cursor.getLong(sizeIdx)
            }
        }
        if (size < 0) {
            size = resolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L
        }
        val contentType = resolver.getType(uri) ?: "application/octet-stream"
        if (size < 0) {
            throw IOException(appContext.getString(R.string.errors_chat_attachment_upload_failed))
        }
        return AttachmentMeta(uri = uri, fileName = fileName, contentType = contentType, size = size)
    }

    /**
     * [Phase16] Web版 lib/imageCompression.ts の移植。
     * 既に1MB以下、GIF、または画像以外はそのまま(ストリーミング)返す。
     * 圧縮できなかった場合も元ファイルのまま返し、上限チェック自体は
     * サーバー側(token-server/lib/attachments.js)に委ねる。
     */
    private fun compressImageIfNeeded(meta: AttachmentMeta): UploadPayload {
        val resolver = appContext.contentResolver
        if (!meta.contentType.startsWith("image/") || meta.contentType == "image/gif" || meta.size <= IMAGE_COMPRESS_MAX_BYTES) {
            return UploadPayload(
                fileName = meta.fileName,
                contentType = meta.contentType,
                size = meta.size,
                bytes = null,
                uri = meta.uri,
                resolver = resolver,
            )
        }

        return try {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            resolver.openInputStream(meta.uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
            val sampleSize = computeSampleSize(bounds.outWidth, bounds.outHeight, IMAGE_COMPRESS_MAX_DIMENSION)

            val decodeOptions = BitmapFactory.Options().apply { inSampleSize = sampleSize }
            val bitmap = resolver.openInputStream(meta.uri)?.use { BitmapFactory.decodeStream(it, null, decodeOptions) }
                ?: return UploadPayload(meta.fileName, meta.contentType, meta.size, null, meta.uri, resolver)

            val scaled = downscaleIfNeeded(bitmap, IMAGE_COMPRESS_MAX_DIMENSION)

            var quality = 90
            var bytes: ByteArray
            do {
                val out = ByteArrayOutputStream()
                scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
                bytes = out.toByteArray()
                quality -= 15
            } while (bytes.size > IMAGE_COMPRESS_MAX_BYTES && quality >= IMAGE_COMPRESS_MIN_QUALITY)

            if (scaled !== bitmap) bitmap.recycle()
            scaled.recycle()

            val baseName = meta.fileName.substringBeforeLast('.', meta.fileName)
            UploadPayload(
                fileName = "$baseName.jpg",
                contentType = "image/jpeg",
                size = bytes.size.toLong(),
                bytes = bytes,
                uri = null,
                resolver = null,
            )
        } catch (e: Exception) {
            // createImageBitmap相当の処理が失敗した環境では圧縮を諦め、
            // 元ファイルのまま送る(サーバー側の上限チェックに委ねる)。
            UploadPayload(meta.fileName, meta.contentType, meta.size, null, meta.uri, resolver)
        }
    }

    private fun computeSampleSize(width: Int, height: Int, maxDimension: Int): Int {
        var sampleSize = 1
        var w = width
        var h = height
        while (w / 2 >= maxDimension || h / 2 >= maxDimension) {
            w /= 2
            h /= 2
            sampleSize *= 2
        }
        return sampleSize
    }

    private fun downscaleIfNeeded(bitmap: Bitmap, maxDimension: Int): Bitmap {
        val largestSide = maxOf(bitmap.width, bitmap.height)
        if (largestSide <= maxDimension) return bitmap
        val scale = maxDimension.toFloat() / largestSide
        val targetWidth = maxOf(1, (bitmap.width * scale).toInt())
        val targetHeight = maxOf(1, (bitmap.height * scale).toInt())
        return Bitmap.createScaledBitmap(bitmap, targetWidth, targetHeight, true)
    }

    // ------------------------------------------------------------------
    // [Phase16] 署名付き閲覧URLのメモリ内キャッシュ(messageIdをキーとする)。
    // サーバーの有効期限(5分)より前に、期限が近づいたら再発行する。
    // ------------------------------------------------------------------

    private data class CachedUrl(val url: String, val expiresAt: Long)

    private val attachmentUrlCache = ConcurrentHashMap<String, CachedUrl>()
    private val thumbnailUrlCache = ConcurrentHashMap<String, CachedUrl>()

    suspend fun getAttachmentUrl(tokenServerUrl: String, idToken: String, roomId: String, messageId: String): String =
        fetchDownloadUrl(attachmentUrlCache, tokenServerUrl, idToken, roomId, messageId, "attachment-url")

    suspend fun getThumbnailUrl(tokenServerUrl: String, idToken: String, roomId: String, messageId: String): String =
        fetchDownloadUrl(thumbnailUrlCache, tokenServerUrl, idToken, roomId, messageId, "thumbnail-url")

    private suspend fun fetchDownloadUrl(
        cache: ConcurrentHashMap<String, CachedUrl>,
        tokenServerUrl: String,
        idToken: String,
        roomId: String,
        messageId: String,
        suffix: String,
    ): String = withContext(Dispatchers.IO) {
        val cached = cache[messageId]
        if (cached != null && cached.expiresAt - REFRESH_MARGIN_MS > System.currentTimeMillis()) {
            return@withContext cached.url
        }

        val encodedRoomId = URLEncoder.encode(roomId, "UTF-8")
        val encodedMessageId = URLEncoder.encode(messageId, "UTF-8")
        val request = Request.Builder()
            .url("${tokenServerUrl.trimEnd('/')}/rooms/$encodedRoomId/messages/$encodedMessageId/$suffix")
            .addHeader("Authorization", "Bearer $idToken")
            .get()
            .build()

        httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw ChatApiException(response.code, extractErrorMessage(response.body?.string(), response.code))
            }
            val data = JSONObject(response.body?.string().orEmpty())
            val url = data.getString("url")
            val expiresInMs = data.getLong("expiresInMs")
            cache[messageId] = CachedUrl(url, System.currentTimeMillis() + expiresInMs)
            url
        }
    }

    companion object {
        // token-server/lib/attachments.jsのMAX_BYTES(100MB)と同じ。クライアント側の
        // ここでの上限チェックは早期フィードバック用で、権威あるチェックはサーバー側。
        const val MAX_ATTACHMENT_BYTES = 100L * 1024 * 1024
        private const val IMAGE_COMPRESS_MAX_BYTES = 1024 * 1024
        private const val IMAGE_COMPRESS_MAX_DIMENSION = 1920
        private const val IMAGE_COMPRESS_MIN_QUALITY = 40
        private const val REFRESH_MARGIN_MS = 10 * 1000L

        /** ファイルピッカーに渡すMIMEタイプ一覧(ChatPanel.vueのaccept属性と同じ)。 */
        val ALLOWED_MIME_TYPES = arrayOf(
            "image/jpeg", "image/png", "image/webp", "image/gif",
            "video/mp4", "video/quicktime", "video/webm",
            "application/pdf",
        )
    }
}
