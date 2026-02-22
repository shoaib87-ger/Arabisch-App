import Capacitor
import UIKit
import WebKit

// MARK: - EPUB Parser (ZIP → OPF → Spine)

/// Lightweight EPUB parser. EPUB = ZIP containing XHTML chapters + metadata.
struct EpubBook {
    let title: String
    let spineItems: [SpineItem]  // ordered chapter files
    let basePath: URL            // extracted directory
    let opfDir: String           // relative OPF directory
    
    struct SpineItem {
        let id: String
        let href: String     // relative path to XHTML
        let title: String?   // from TOC or manifest
    }
}

class EpubParser {
    
    /// Extract and parse an EPUB file.
    /// Returns nil on failure.
    static func parse(epubURL: URL) -> EpubBook? {
        let fm = FileManager.default
        let cacheDir = fm.urls(for: .cachesDirectory, in: .userDomainMask).first!
        let extractDir = cacheDir.appendingPathComponent("epub_\(UUID().uuidString)")
        
        // Clean up old extraction
        try? fm.removeItem(at: extractDir)
        
        // Unzip using Foundation (Coordinator)
        guard unzipFile(at: epubURL, to: extractDir) else {
            print("[EpubParser] Failed to unzip \(epubURL.lastPathComponent)")
            return nil
        }
        
        // 1. Parse container.xml → find rootfile (OPF path)
        let containerURL = extractDir.appendingPathComponent("META-INF/container.xml")
        guard let containerData = try? Data(contentsOf: containerURL),
              let containerStr = String(data: containerData, encoding: .utf8),
              let opfPath = parseContainerXML(containerStr) else {
            print("[EpubParser] No valid container.xml found")
            return nil
        }
        
        // 2. Parse OPF → manifest + spine
        let opfURL = extractDir.appendingPathComponent(opfPath)
        let opfDir = (opfPath as NSString).deletingLastPathComponent
        
        guard let opfData = try? Data(contentsOf: opfURL),
              let opfStr = String(data: opfData, encoding: .utf8) else {
            print("[EpubParser] Cannot read OPF at \(opfPath)")
            return nil
        }
        
        let (title, manifest, spine) = parseOPF(opfStr)
        
        // 3. Build spine items with resolved paths
        var spineItems: [EpubBook.SpineItem] = []
        for idref in spine {
            if let href = manifest[idref] {
                spineItems.append(EpubBook.SpineItem(
                    id: idref,
                    href: href,
                    title: nil
                ))
            }
        }
        
        guard !spineItems.isEmpty else {
            print("[EpubParser] No spine items found")
            return nil
        }
        
        return EpubBook(
            title: title ?? epubURL.deletingPathExtension().lastPathComponent,
            spineItems: spineItems,
            basePath: extractDir,
            opfDir: opfDir
        )
    }
    
    // MARK: - XML Parsing helpers (simple regex-based, no XMLParser overhead)
    
    private static func parseContainerXML(_ xml: String) -> String? {
        // Find: <rootfile ... full-path="content.opf" .../>
        guard let range = xml.range(of: #"full-path="([^"]+)""#, options: .regularExpression) else { return nil }
        let match = xml[range]
        let path = match.replacingOccurrences(of: "full-path=\"", with: "").replacingOccurrences(of: "\"", with: "")
        return path
    }
    
    private static func parseOPF(_ xml: String) -> (title: String?, manifest: [String: String], spine: [String]) {
        // Title
        var title: String? = nil
        if let titleRange = xml.range(of: #"<dc:title[^>]*>([^<]+)</dc:title>"#, options: .regularExpression) {
            let match = String(xml[titleRange])
            title = match.replacingOccurrences(of: #"<dc:title[^>]*>"#, with: "", options: .regularExpression)
                         .replacingOccurrences(of: "</dc:title>", with: "")
        }
        
        // Manifest: id → href
        var manifest: [String: String] = [:]
        let manifestPattern = #"<item\s+[^>]*id="([^"]+)"[^>]*href="([^"]+)"[^>]*/?\s*>"#
        let manifestRegex = try? NSRegularExpression(pattern: manifestPattern, options: [.dotMatchesLineSeparators])
        let nsXml = xml as NSString
        manifestRegex?.enumerateMatches(in: xml, range: NSRange(location: 0, length: nsXml.length)) { match, _, _ in
            guard let match = match,
                  let idRange = Range(match.range(at: 1), in: xml),
                  let hrefRange = Range(match.range(at: 2), in: xml) else { return }
            manifest[String(xml[idRange])] = String(xml[hrefRange])
        }
        
        // Also handle items where href comes before id
        let manifestPattern2 = #"<item\s+[^>]*href="([^"]+)"[^>]*id="([^"]+)"[^>]*/?\s*>"#
        let manifestRegex2 = try? NSRegularExpression(pattern: manifestPattern2, options: [.dotMatchesLineSeparators])
        manifestRegex2?.enumerateMatches(in: xml, range: NSRange(location: 0, length: nsXml.length)) { match, _, _ in
            guard let match = match,
                  let hrefRange = Range(match.range(at: 1), in: xml),
                  let idRange = Range(match.range(at: 2), in: xml) else { return }
            let id = String(xml[idRange])
            if manifest[id] == nil {
                manifest[id] = String(xml[hrefRange])
            }
        }
        
        // Spine: ordered list of idrefs
        var spine: [String] = []
        let spinePattern = #"<itemref\s+[^>]*idref="([^"]+)""#
        let spineRegex = try? NSRegularExpression(pattern: spinePattern)
        spineRegex?.enumerateMatches(in: xml, range: NSRange(location: 0, length: nsXml.length)) { match, _, _ in
            guard let match = match,
                  let range = Range(match.range(at: 1), in: xml) else { return }
            spine.append(String(xml[range]))
        }
        
        return (title, manifest, spine)
    }
    
    // MARK: - ZIP extraction (pure Foundation, iOS compatible)
    
    private static func unzipFile(at source: URL, to destination: URL) -> Bool {
        let fm = FileManager.default
        try? fm.createDirectory(at: destination, withIntermediateDirectories: true)
        
        // Use SSZipArchive-style manual extraction via FileManager
        // EPUB is a standard ZIP — we read it using Foundation's built-in ZIP support
        // through file coordination / temp copying approach
        
        guard let archive = ZipArchiveReader(url: source) else {
            print("[EpubParser] Cannot open ZIP archive")
            return false
        }
        
        return archive.extractAll(to: destination)
    }
}

/// Minimal ZIP reader using Foundation (no external dependencies).
/// Uses raw byte reading of the ZIP central directory.
class ZipArchiveReader {
    private let data: Data
    
    init?(url: URL) {
        guard let d = try? Data(contentsOf: url) else { return nil }
        self.data = d
    }
    
    func extractAll(to destination: URL) -> Bool {
        let fm = FileManager.default
        
        // Find End of Central Directory record (EOCD)
        // Signature: 0x06054b50
        guard let eocdOffset = findEOCD() else {
            print("[ZIP] No EOCD found")
            return false
        }
        
        // Parse EOCD
        let cdOffset = readUInt32(at: eocdOffset + 16) // offset of central directory
        let cdCount = Int(readUInt16(at: eocdOffset + 10)) // number of entries
        
        // Walk central directory entries
        var offset = Int(cdOffset)
        for _ in 0..<cdCount {
            guard offset + 46 <= data.count else { break }
            
            // Verify central directory signature: 0x02014b50
            let sig = readUInt32(at: offset)
            guard sig == 0x02014b50 else { break }
            
            let compressionMethod = readUInt16(at: offset + 10)
            let compressedSize = Int(readUInt32(at: offset + 20))
            let _ = readUInt32(at: offset + 24) // uncompressedSize (unused)
            let nameLength = Int(readUInt16(at: offset + 28))
            let extraLength = Int(readUInt16(at: offset + 30))
            let commentLength = Int(readUInt16(at: offset + 32))
            let localHeaderOffset = Int(readUInt32(at: offset + 42))
            
            // Read filename
            let nameStart = offset + 46
            guard nameStart + nameLength <= data.count else { break }
            let nameData = data.subdata(in: nameStart..<(nameStart + nameLength))
            let name = String(data: nameData, encoding: .utf8) ?? ""
            
            // Skip to next entry
            offset = nameStart + nameLength + extraLength + commentLength
            
            // Skip directories
            if name.hasSuffix("/") {
                let dirURL = destination.appendingPathComponent(name)
                try? fm.createDirectory(at: dirURL, withIntermediateDirectories: true)
                continue
            }
            
            // Read from local file header to get actual data
            guard localHeaderOffset + 30 <= data.count else { continue }
            let localNameLen = Int(readUInt16(at: localHeaderOffset + 26))
            let localExtraLen = Int(readUInt16(at: localHeaderOffset + 28))
            let dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen
            
            guard dataStart + compressedSize <= data.count else { continue }
            let rawData = data.subdata(in: dataStart..<(dataStart + compressedSize))
            
            // Decompress if needed
            let fileData: Data
            if compressionMethod == 0 {
                // Stored (no compression)
                fileData = rawData
            } else if compressionMethod == 8 {
                // Deflate
                guard let inflated = rawData.decompress() else {
                    print("[ZIP] Failed to decompress \(name)")
                    continue
                }
                fileData = inflated
            } else {
                print("[ZIP] Unsupported compression method \(compressionMethod) for \(name)")
                continue
            }
            
            // Write file
            let fileURL = destination.appendingPathComponent(name)
            let parentDir = fileURL.deletingLastPathComponent()
            try? fm.createDirectory(at: parentDir, withIntermediateDirectories: true)
            try? fileData.write(to: fileURL)
        }
        
        return true
    }
    
    // MARK: - Helpers
    
    private func findEOCD() -> Int? {
        // Search backwards for 0x06054b50
        let sig: [UInt8] = [0x50, 0x4b, 0x05, 0x06]
        let maxSearch = min(data.count, 65535 + 22)
        for i in stride(from: data.count - 22, through: Swift.max(0, data.count - maxSearch), by: -1) {
            if data[i] == sig[0] && data[i+1] == sig[1] && data[i+2] == sig[2] && data[i+3] == sig[3] {
                return i
            }
        }
        return nil
    }
    
    private func readUInt16(at offset: Int) -> UInt16 {
        guard offset + 2 <= data.count else { return 0 }
        return UInt16(data[offset]) | (UInt16(data[offset + 1]) << 8)
    }
    
    private func readUInt32(at offset: Int) -> UInt32 {
        guard offset + 4 <= data.count else { return 0 }
        return UInt32(data[offset])
            | (UInt32(data[offset + 1]) << 8)
            | (UInt32(data[offset + 2]) << 16)
            | (UInt32(data[offset + 3]) << 24)
    }
}

// MARK: - Data decompression (Deflate via Compression framework)
import Compression

extension Data {
    func decompress() -> Data? {
        // Use Apple's Compression framework for DEFLATE
        let size = self.count
        let bufferSize = size * 4 // initial output buffer
        var outputBuffer = [UInt8](repeating: 0, count: Swift.max(bufferSize, 65536))
        
        let result = self.withUnsafeBytes { (inputPointer: UnsafeRawBufferPointer) -> Data? in
            guard let inputBase = inputPointer.baseAddress else { return nil }
            
            let decompressed = compression_decode_buffer(
                &outputBuffer,
                outputBuffer.count,
                inputBase.assumingMemoryBound(to: UInt8.self),
                size,
                nil,
                COMPRESSION_ZLIB
            )
            
            if decompressed > 0 {
                return Data(bytes: outputBuffer, count: decompressed)
            }
            
            // Try with larger buffer
            var largeBuffer = [UInt8](repeating: 0, count: size * 10)
            let result2 = compression_decode_buffer(
                &largeBuffer,
                largeBuffer.count,
                inputBase.assumingMemoryBound(to: UInt8.self),
                size,
                nil,
                COMPRESSION_ZLIB
            )
            
            if result2 > 0 {
                return Data(bytes: largeBuffer, count: result2)
            }
            
            return nil
        }
        
        return result
    }
}


// MARK: - EPUB Reader View Controller

class EpubReaderViewController: UIViewController, WKNavigationDelegate {
    
    private var book: EpubBook
    private var currentChapter: Int = 0
    private var webView: WKWebView!
    private var titleLabel: UILabel!
    private var progressLabel: UILabel!
    private var pluginCall: CAPPluginCall?
    
    init(book: EpubBook, call: CAPPluginCall?) {
        self.book = book
        self.pluginCall = call
        super.init(nibName: nil, bundle: nil)
    }
    
    required init?(coder: NSCoder) { fatalError() }
    
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        setupUI()
        loadChapter(currentChapter)
    }
    
    private func setupUI() {
        // Header bar
        let header = UIView()
        header.backgroundColor = UIColor(red: 0.102, green: 0.369, blue: 0.224, alpha: 1) // #1a5e3a
        header.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(header)
        
        let backBtn = UIButton(type: .system)
        backBtn.setTitle("‹ Zurück", for: .normal)
        backBtn.setTitleColor(.white, for: .normal)
        backBtn.titleLabel?.font = .boldSystemFont(ofSize: 16)
        backBtn.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        backBtn.translatesAutoresizingMaskIntoConstraints = false
        header.addSubview(backBtn)
        
        titleLabel = UILabel()
        titleLabel.text = book.title
        titleLabel.textColor = .white
        titleLabel.font = .boldSystemFont(ofSize: 16)
        titleLabel.textAlignment = .center
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        header.addSubview(titleLabel)
        
        // WebView for chapter content
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        
        // Footer with navigation
        let footer = UIView()
        footer.backgroundColor = UIColor.secondarySystemBackground
        footer.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(footer)
        
        let prevBtn = UIButton(type: .system)
        prevBtn.setTitle("‹ Vorheriges", for: .normal)
        prevBtn.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        prevBtn.addTarget(self, action: #selector(prevChapter), for: .touchUpInside)
        prevBtn.translatesAutoresizingMaskIntoConstraints = false
        footer.addSubview(prevBtn)
        
        progressLabel = UILabel()
        progressLabel.textAlignment = .center
        progressLabel.font = .systemFont(ofSize: 13, weight: .medium)
        progressLabel.textColor = .secondaryLabel
        progressLabel.translatesAutoresizingMaskIntoConstraints = false
        footer.addSubview(progressLabel)
        
        let nextBtn = UIButton(type: .system)
        nextBtn.setTitle("Nächstes ›", for: .normal)
        nextBtn.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        nextBtn.addTarget(self, action: #selector(nextChapter), for: .touchUpInside)
        nextBtn.translatesAutoresizingMaskIntoConstraints = false
        footer.addSubview(nextBtn)
        
        // Layout
        let safeArea = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: view.topAnchor),
            header.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            header.bottomAnchor.constraint(equalTo: safeArea.topAnchor, constant: 44),
            
            backBtn.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 12),
            backBtn.bottomAnchor.constraint(equalTo: header.bottomAnchor, constant: -8),
            
            titleLabel.centerXAnchor.constraint(equalTo: header.centerXAnchor),
            titleLabel.bottomAnchor.constraint(equalTo: header.bottomAnchor, constant: -10),
            titleLabel.leadingAnchor.constraint(greaterThanOrEqualTo: backBtn.trailingAnchor, constant: 8),
            
            webView.topAnchor.constraint(equalTo: header.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: footer.topAnchor),
            
            footer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            footer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            footer.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            footer.heightAnchor.constraint(equalToConstant: 80),
            
            prevBtn.leadingAnchor.constraint(equalTo: footer.leadingAnchor, constant: 16),
            prevBtn.topAnchor.constraint(equalTo: footer.topAnchor, constant: 12),
            
            progressLabel.centerXAnchor.constraint(equalTo: footer.centerXAnchor),
            progressLabel.topAnchor.constraint(equalTo: footer.topAnchor, constant: 14),
            
            nextBtn.trailingAnchor.constraint(equalTo: footer.trailingAnchor, constant: -16),
            nextBtn.topAnchor.constraint(equalTo: footer.topAnchor, constant: 12),
        ])
    }
    
    private func loadChapter(_ index: Int) {
        guard index >= 0 && index < book.spineItems.count else { return }
        currentChapter = index
        
        let item = book.spineItems[index]
        let chapterPath: URL
        if book.opfDir.isEmpty {
            chapterPath = book.basePath.appendingPathComponent(item.href)
        } else {
            chapterPath = book.basePath
                .appendingPathComponent(book.opfDir)
                .appendingPathComponent(item.href)
        }
        
        let baseDir: URL
        if book.opfDir.isEmpty {
            baseDir = book.basePath
        } else {
            baseDir = book.basePath.appendingPathComponent(book.opfDir)
        }
        
        webView.loadFileURL(chapterPath, allowingReadAccessTo: baseDir)
        progressLabel.text = "Kapitel \(index + 1) / \(book.spineItems.count)"
    }
    
    @objc private func prevChapter() {
        if currentChapter > 0 {
            loadChapter(currentChapter - 1)
        }
    }
    
    @objc private func nextChapter() {
        if currentChapter < book.spineItems.count - 1 {
            loadChapter(currentChapter + 1)
        }
    }
    
    @objc private func closeTapped() {
        dismiss(animated: true) {
            self.pluginCall?.resolve(["closed": true, "lastChapter": self.currentChapter])
        }
    }
}


// MARK: - Capacitor Plugin

@objc(EpubReaderPlugin)
public class EpubReaderPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "EpubReaderPlugin"
    public let jsName = "EpubReader"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openEpub", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickAndOpen", returnType: CAPPluginReturnPromise)
    ]
    
    private var currentCall: CAPPluginCall?
    
    /// Open an EPUB from a known file path
    @objc func openEpub(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("Missing 'path' parameter")
            return
        }
        
        let fileURL = URL(fileURLWithPath: path)
        openEpubFile(fileURL, call: call)
    }
    
    /// Show file picker, then open the selected EPUB
    @objc func pickAndOpen(_ call: CAPPluginCall) {
        self.currentCall = call
        
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else {
                call.reject("No view controller")
                return
            }
            
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.epub])
            picker.delegate = self
            picker.allowsMultipleSelection = false
            vc.present(picker, animated: true)
        }
    }
    
    // MARK: UIDocumentPickerDelegate
    
    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = currentCall, let url = urls.first else {
            currentCall?.reject("No file selected")
            currentCall = nil
            return
        }
        
        // Start security-scoped access
        let accessing = url.startAccessingSecurityScopedResource()
        
        // Copy to app sandbox (avoid permission issues)
        let fm = FileManager.default
        let tempDir = fm.temporaryDirectory.appendingPathComponent("epub_import")
        try? fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
        let localCopy = tempDir.appendingPathComponent(url.lastPathComponent)
        try? fm.removeItem(at: localCopy)
        
        do {
            try fm.copyItem(at: url, to: localCopy)
        } catch {
            if accessing { url.stopAccessingSecurityScopedResource() }
            call.reject("Failed to copy EPUB: \(error.localizedDescription)")
            currentCall = nil
            return
        }
        
        if accessing { url.stopAccessingSecurityScopedResource() }
        
        openEpubFile(localCopy, call: call)
        currentCall = nil
    }
    
    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        currentCall?.reject("User cancelled")
        currentCall = nil
    }
    
    // MARK: - Open EPUB
    
    private func openEpubFile(_ url: URL, call: CAPPluginCall) {
        guard let book = EpubParser.parse(epubURL: url) else {
            call.reject("Failed to parse EPUB")
            return
        }
        
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else {
                call.reject("No view controller")
                return
            }
            
            let readerVC = EpubReaderViewController(book: book, call: call)
            readerVC.modalPresentationStyle = .fullScreen
            vc.present(readerVC, animated: true)
        }
    }
}
