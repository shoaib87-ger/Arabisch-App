import Capacitor
import Vision
import UIKit

@objc(VisionOCRPlugin)
public class VisionOCRPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VisionOCRPlugin"
    public let jsName = "VisionOCR"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "recognizeText", returnType: CAPPluginReturnPromise)
    ]

    @objc func recognizeText(_ call: CAPPluginCall) {
        guard let base64String = call.getString("imageBase64") else {
            call.reject("Missing imageBase64 parameter")
            return
        }

        // Strip data URI prefix if present (e.g., "data:image/png;base64,")
        let cleanBase64 = base64String.contains(",")
            ? String(base64String.split(separator: ",").last ?? "")
            : base64String

        guard let imageData = Data(base64Encoded: cleanBase64),
              let uiImage = UIImage(data: imageData),
              let cgImage = uiImage.cgImage else {
            call.reject("Could not decode image from base64")
            return
        }

        // Languages to recognize: Arabic + German + English
        let languages = call.getArray("languages", String.self) ?? ["ar", "de", "en"]

        // Run OCR on background thread
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

            // Configure the request
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true

            if #available(iOS 16.0, *) {
                request.automaticallyDetectsLanguage = true
            }

            // Set recognition languages
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
