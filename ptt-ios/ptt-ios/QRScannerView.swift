//
//  QRScannerView.swift
//  ptt-ios
//
//  アプリ内QRスキャナー(AVFoundation)。Web版QrScannerDialog.vue(jsQR)・
//  Android版QrScannerDialog.kt(CameraX+ML Kit)と同じ役割: 読み取った招待QRコードを
//  parseInviteText()でパースし、成功時のみonDecodedへ通知する。
//  呼び出し側(ContentView.roomSelectionSection)が入力欄へ反映するだけで、
//  自動参加はしない(deeplink-qr-join-plan.md参照)。
//

import SwiftUI
import AVFoundation

struct QRScannerView: View {
    let onDecoded: (PendingInvite) -> Void
    let onCancel: () -> Void

    var body: some View {
        NavigationStack {
            ZStack {
                QRScannerRepresentable { text in
                    if let invite = parseInviteText(text) {
                        onDecoded(invite)
                    }
                    // 招待リンクの形式でなければ無視してスキャンを継続する
                    // (QRScannerRepresentable側は1回デコードすると停止するため、
                    //  厳密な継続スキャンは今回のスコープ外。再度開き直せば良い)。
                }
                .ignoresSafeArea()

                VStack {
                    Spacer()
                    Text("招待QRコードをカメラに映してください。読み取ると入力欄に反映されます（自動では参加しません）。")
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundColor(.white)
                        .padding(10)
                        .background(.black.opacity(0.6))
                        .cornerRadius(6)
                        .padding(.bottom, 24)
                        .padding(.horizontal, 16)
                }
            }
            .navigationTitle("招待QRコードを読み取る")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("キャンセル", action: onCancel)
                }
            }
        }
    }
}

/// AVCaptureMetadataOutputでQRコードを検出するUIViewControllerRepresentableラッパー。
private struct QRScannerRepresentable: UIViewControllerRepresentable {
    let onDetected: (String) -> Void

    func makeUIViewController(context: Context) -> QRScannerViewController {
        let controller = QRScannerViewController()
        controller.onDetected = onDetected
        return controller
    }

    func updateUIViewController(_ uiViewController: QRScannerViewController, context: Context) {}
}

final class QRScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onDetected: ((String) -> Void)?

    private let session = AVCaptureSession()
    private var didDetect = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        configureSession()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if !session.isRunning {
            DispatchQueue.global(qos: .userInitiated).async { [session] in
                session.startRunning()
            }
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if session.isRunning {
            session.stopRunning()
        }
    }

    private func configureSession() {
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input)
        else { return }
        session.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { return }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        let previewLayer = AVCaptureVideoPreviewLayer(session: session)
        previewLayer.videoGravity = .resizeAspectFill
        previewLayer.frame = view.layer.bounds
        previewLayer.autoresizingMask = [.layerWidthSizable, .layerHeightSizable]
        view.layer.addSublayer(previewLayer)
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard !didDetect,
              let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              object.type == .qr,
              let value = object.stringValue
        else { return }
        didDetect = true
        onDetected?(value)
    }
}
