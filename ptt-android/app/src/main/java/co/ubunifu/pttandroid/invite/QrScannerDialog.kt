/**
 * QrScannerDialog.kt
 *
 * アプリ内QRスキャナー(CameraX + ML Kit)。Web版QrScannerDialog.vue(jsQR)・
 * iOS版QrScannerView.swift(AVFoundation)と同じ役割:
 * 読み取った招待QRコードをparseInviteText()でパースし、成功時のみonDecodedへ通知する。
 * 呼び出し側(RoomSelectionSection)が入力欄へ反映するだけで、自動参加はしない
 * (deeplink-qr-join-plan.md参照)。
 */
package co.ubunifu.pttandroid.invite

import android.Manifest
import android.content.pm.PackageManager
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage

@Composable
fun QrScannerDialog(onDismiss: () -> Unit, onDecoded: (PendingInvite) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED,
        )
    }
    var permissionDenied by remember { mutableStateOf(false) }

    val permissionLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission(),
    ) { granted ->
        hasCameraPermission = granted
        permissionDenied = !granted
    }

    DisposableEffect(Unit) {
        if (!hasCameraPermission) permissionLauncher.launch(Manifest.permission.CAMERA)
        onDispose {}
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("キャンセル") } },
        title = { Text("招待QRコードを読み取る") },
        text = {
            Column {
                if (hasCameraPermission) {
                    QrCameraPreview(
                        lifecycleOwner = lifecycleOwner,
                        onDecoded = { text ->
                            parseInviteText(text)?.let(onDecoded)
                            // 招待リンクの形式でなければ無視して読み取りを継続する。
                        },
                    )
                    Text(
                        "招待QRコードをカメラに映してください。読み取ると入力欄に反映されます" +
                            "(自動では参加しません)。",
                        modifier = Modifier.padding(top = 8.dp),
                    )
                } else if (permissionDenied) {
                    Text("カメラの権限が許可されていません。設定アプリから許可してください。")
                } else {
                    Text("カメラへのアクセスを確認しています...")
                }
            }
        },
    )
}

@Composable
private fun QrCameraPreview(
    lifecycleOwner: androidx.lifecycle.LifecycleOwner,
    onDecoded: (String) -> Unit,
) {
    val context = LocalContext.current
    val scanner = remember {
        BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .build(),
        )
    }
    var decoded = false

    AndroidView(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(1f),
        factory = { ctx ->
            val previewView = PreviewView(ctx)
            val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
            cameraProviderFuture.addListener({
                val cameraProvider = cameraProviderFuture.get()
                val preview = androidx.camera.core.Preview.Builder().build().also {
                    it.setSurfaceProvider(previewView.surfaceProvider)
                }
                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                analysis.setAnalyzer(
                    ContextCompat.getMainExecutor(ctx),
                    object : ImageAnalysis.Analyzer {
                        @ExperimentalGetImage
                        override fun analyze(imageProxy: ImageProxy) {
                            if (decoded) {
                                imageProxy.close()
                                return
                            }
                            val mediaImage = imageProxy.image
                            if (mediaImage == null) {
                                imageProxy.close()
                                return
                            }
                            val image =
                                InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
                            scanner.process(image)
                                .addOnSuccessListener { barcodes ->
                                    val value = barcodes.firstOrNull()?.rawValue
                                    if (value != null && !decoded) {
                                        decoded = true
                                        onDecoded(value)
                                    }
                                }
                                .addOnCompleteListener { imageProxy.close() }
                        }
                    },
                )
                try {
                    cameraProvider.unbindAll()
                    cameraProvider.bindToLifecycle(
                        lifecycleOwner,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        analysis,
                    )
                } catch (_: Exception) {
                    // カメラが利用できない端末/エミュレータでは静かに諦める
                    // (呼び出し元のOS標準カメラ経由のApp Link起動が主導線のため致命的ではない)。
                }
            }, ContextCompat.getMainExecutor(ctx))
            previewView
        },
    )
}
