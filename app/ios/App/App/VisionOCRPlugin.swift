import Capacitor
import Vision
import UIKit
import PhotosUI

@objc(VisionOCRPlugin)
public class VisionOCRPlugin: CAPPlugin, CAPBridgedPlugin, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    public let identifier = "VisionOCRPlugin"
    public let jsName = "VisionOCR"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "recognizeText", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanText", returnType: CAPPluginReturnPromise)
    ]

    private var currentCall: CAPPluginCall?

    // MARK: - recognizeText (existing: base64 image → OCR)
    @objc func recognizeText(_ call: CAPPluginCall) {
        guard let base64String = call.getString("imageBase64") else {
            call.reject("Missing imageBase64 parameter")
            return
        }

        let cleanBase64 = base64String.contains(",")
            ? String(base64String.split(separator: ",").last ?? "")
            : base64String

        guard let imageData = Data(base64Encoded: cleanBase64),
              let uiImage = UIImage(data: imageData),
              let cgImage = uiImage.cgImage else {
            call.reject("Could not decode image from base64")
            return
        }

        let languages = call.getArray("languages", String.self) ?? ["ar", "de", "en"]
        performOCR(on: cgImage, languages: languages, call: call)
    }

    // MARK: - scanText (NEW: open photo picker → OCR → return text)
    @objc func scanText(_ call: CAPPluginCall) {
        self.currentCall = call
        let source = call.getString("source") ?? "photos" // "photos" or "camera"

        DispatchQueue.main.async {
            guard let viewController = self.bridge?.viewController else {
                call.reject("No view controller available")
                return
            }

            let picker = UIImagePickerController()
            picker.delegate = self
            picker.allowsEditing = false

            if source == "camera" && UIImagePickerController.isSourceTypeAvailable(.camera) {
                picker.sourceType = .camera
            } else {
                picker.sourceType = .photoLibrary
            }

            viewController.present(picker, animated: true)
        }
    }

    // MARK: - UIImagePickerControllerDelegate
    public func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        picker.dismiss(animated: true)

        guard let call = self.currentCall else { return }

        guard let image = info[.originalImage] as? UIImage,
              let cgImage = image.cgImage else {
            call.reject("Could not get image from picker")
            self.currentCall = nil
            return
        }

        let languages = call.getArray("languages", String.self) ?? ["ar", "de", "en"]
        performOCR(on: cgImage, languages: languages, call: call)
        self.currentCall = nil
    }

    public func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
        currentCall?.reject("User cancelled")
        currentCall = nil
    }

    // MARK: - Shared OCR logic
    private func performOCR(on cgImage: CGImage, languages: [String], call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async {
            let request = VNRecognizeTextRequest { request, error in
                if let error = error {
                    call.reject("Vision OCR error: \(error.localizedDescription)")
                    return
                }

                guard let observations = request.results as? [VNRecognizedTextObservation] else {
                    call.resolve(["text": "", "blocks": []])
                    return
                }

                var fullText = ""
                var blocks: [[String: Any]] = []

                for observation in observations {
                    guard let topCandidate = observation.topCandidates(1).first else { continue }

                    let text = topCandidate.string
                    let confidence = topCandidate.confidence
                    let boundingBox = observation.boundingBox

                    fullText += text + "\n"

                    blocks.append([
                        "text": text,
                        "confidence": confidence,
                        "x": boundingBox.origin.x,
                        "y": boundingBox.origin.y,
                        "width": boundingBox.size.width,
                        "height": boundingBox.size.height
                    ])
                }

                call.resolve([
                    "text": fullText.trimmingCharacters(in: .whitespacesAndNewlines),
                    "blocks": blocks,
                    "blockCount": blocks.count
                ])
            }

            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true

            if #available(iOS 16.0, *) {
                request.automaticallyDetectsLanguage = true
            }

            request.recognitionLanguages = languages

            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            do {
                try handler.perform([request])
            } catch {
                call.reject("Vision handler error: \(error.localizedDescription)")
            }
        }
    }
}
