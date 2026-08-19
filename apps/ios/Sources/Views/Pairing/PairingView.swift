import AVFoundation
import SwiftUI
import UIKit

struct PairingView: View {
    @EnvironmentObject private var model: SottoAppModel
    @State private var manualCode = ""

    var body: some View {
        GeometryReader { proxy in
            if proxy.size.width < 700 {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        pairingHeader(isCompact: true)
                        manualPairingForm

                        scannerPanel
                            .frame(height: min(max(proxy.size.width * 1.12, 320), 480))
                    }
                    .padding(.horizontal, 22)
                    .padding(.top, 42)
                    .padding(.bottom, 24)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                HStack(spacing: 0) {
                    VStack(alignment: .leading, spacing: 24) {
                        pairingHeader(isCompact: false)
                        manualPairingForm

                        Spacer()
                    }
                    .frame(width: max(360, proxy.size.width * 0.36), alignment: .leading)
                    .padding(48)

                    scannerPanel
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .padding(.trailing, 42)
                        .padding(.vertical, 42)
                }
            }
        }
    }

    private func pairingHeader(isCompact: Bool) -> some View {
        VStack(alignment: .leading, spacing: isCompact ? 18 : 24) {
            Text("Sotto")
                .font(.system(size: isCompact ? 52 : 62, weight: .bold, design: .serif))
                .foregroundStyle(SottoTheme.ink)

            VStack(alignment: .leading, spacing: 10) {
                Text("Pair this device")
                    .font(isCompact ? .title2.bold() : .title.bold())
                    .foregroundStyle(SottoTheme.ink)
                Text("Open Settings > Devices on your self-hosted Sotto server, then scan the pairing QR code shown there.")
                    .font(isCompact ? .body : .title3)
                    .foregroundStyle(SottoTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var manualPairingForm: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField("Paste pairing link", text: $manualCode)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .font(.body.monospaced())
                .padding(14)
                .background(SottoTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(SottoTheme.line)
                )

            Button {
                Task {
                    await model.pair(with: manualCode)
                }
            } label: {
                Label("Pair from link", systemImage: "link")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(SottoSecondaryButtonStyle())
            .disabled(manualCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    private var scannerPanel: some View {
        QRScannerPanel { value in
            Task {
                await model.pair(with: value)
            }
        }
    }
}

private struct QRScannerPanel: View {
    let onCode: (String) -> Void

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            QRScannerView(onCode: onCode)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .stroke(.white.opacity(0.64), lineWidth: 1)
                )

            VStack(alignment: .leading, spacing: 8) {
                Label("Scan pairing code", systemImage: "qrcode.viewfinder")
                    .font(.headline)
                Text("The scan happens locally. Your server URL and access token stay on this device.")
                    .font(.callout)
                    .foregroundStyle(.white.opacity(0.82))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .foregroundStyle(.white)
            .padding(18)
            .background(.black.opacity(0.34))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .padding(18)
        }
        .background(Color.black)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(color: .black.opacity(0.18), radius: 28, y: 18)
    }
}

struct QRScannerView: UIViewControllerRepresentable {
    let onCode: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onCode: onCode)
    }

    func makeUIViewController(context: Context) -> QRScannerViewController {
        QRScannerViewController(coordinator: context.coordinator)
    }

    func updateUIViewController(_ uiViewController: QRScannerViewController, context: Context) {}

    final class Coordinator {
        private let onCode: (String) -> Void
        private var lastValue: String?

        init(onCode: @escaping (String) -> Void) {
            self.onCode = onCode
        }

        func handle(value: String) {
            guard value != lastValue else { return }
            lastValue = value
            onCode(value)
        }
    }
}

final class QRScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let coordinator: QRScannerView.Coordinator
    private let session = AVCaptureSession()
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private let messageLabel = UILabel()

    init(coordinator: QRScannerView.Coordinator) {
        self.coordinator = coordinator
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        configureMessageLabel()
        requestCameraAccess()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
        updatePreviewOrientation()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        updatePreviewOrientation()
    }

    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        coordinator.animate { [weak self] _ in
            self?.previewLayer?.frame = CGRect(origin: .zero, size: size)
            self?.updatePreviewOrientation()
        } completion: { [weak self] _ in
            self?.previewLayer?.frame = self?.view.bounds ?? .zero
            self?.updatePreviewOrientation()
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if session.isRunning {
            DispatchQueue.global(qos: .userInitiated).async {
                self.session.stopRunning()
            }
        }
    }

    private func configureMessageLabel() {
        messageLabel.text = "Camera unavailable. Paste the pairing link instead."
        messageLabel.textColor = .white
        messageLabel.font = .preferredFont(forTextStyle: .headline)
        messageLabel.textAlignment = .center
        messageLabel.numberOfLines = 0
        messageLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(messageLabel)

        NSLayoutConstraint.activate([
            messageLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            messageLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            messageLabel.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 32),
            messageLabel.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -32)
        ])
    }

    private func requestCameraAccess() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configureSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    if granted {
                        self?.configureSession()
                    } else {
                        self?.messageLabel.isHidden = false
                    }
                }
            }
        default:
            messageLabel.isHidden = false
        }
    }

    private func configureSession() {
        guard let device = AVCaptureDevice.default(for: .video) else {
            messageLabel.isHidden = false
            return
        }

        do {
            let input = try AVCaptureDeviceInput(device: device)
            guard session.canAddInput(input) else {
                messageLabel.isHidden = false
                return
            }
            session.addInput(input)
        } catch {
            messageLabel.isHidden = false
            return
        }

        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else {
            messageLabel.isHidden = false
            return
        }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        let previewLayer = AVCaptureVideoPreviewLayer(session: session)
        previewLayer.videoGravity = .resizeAspectFill
        previewLayer.frame = view.bounds
        view.layer.insertSublayer(previewLayer, at: 0)
        self.previewLayer = previewLayer
        updatePreviewOrientation()
        messageLabel.isHidden = true

        DispatchQueue.global(qos: .userInitiated).async {
            self.session.startRunning()
        }
    }

    private func updatePreviewOrientation() {
        guard
            let connection = previewLayer?.connection,
            let interfaceOrientation = view.window?.windowScene?.interfaceOrientation,
            let videoRotationAngle = interfaceOrientation.videoRotationAngle,
            connection.isVideoRotationAngleSupported(videoRotationAngle)
        else {
            return
        }

        connection.videoRotationAngle = videoRotationAngle
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard
            let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
            object.type == .qr,
            let value = object.stringValue
        else {
            return
        }

        coordinator.handle(value: value)
    }
}

private extension UIInterfaceOrientation {
    var videoRotationAngle: CGFloat? {
        switch self {
        case .portrait:
            90
        case .portraitUpsideDown:
            270
        case .landscapeLeft:
            0
        case .landscapeRight:
            180
        case .unknown:
            nil
        @unknown default:
            nil
        }
    }
}
