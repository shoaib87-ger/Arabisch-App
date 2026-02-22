# FushaCards — App Store Readiness Report

## ✅ Ready for Archive Upload

| Item | Value | Status |
|------|-------|--------|
| Bundle ID | `com.drshoaib.arabischapp` | ✅ |
| Display Name | FushaCards | ✅ |
| Deployment Target | iOS 17.0 | ✅ |
| Marketing Version | 1.0 | ✅ |
| Build Number | 1 | ✅ |
| App Icon | 1024x1024 (`AppIcon-512@2x.png`) | ✅ |
| Swift Optimization | `-O` (Release) / `-Onone` (Debug) | ✅ |
| ATS | `NSAllowsArbitraryLoads = NO` | ✅ |
| Development Team | KJB89PL3H8 | ✅ |
| Scheme | App (Release) | ✅ |

## Permissions

| Key | Description |
|-----|-------------|
| `NSLocationWhenInUseUsageDescription` | Qibla + Gebetszeiten, nicht gespeichert |
| `NSCameraUsageDescription` | OCR Text-Scan, CSV empfohlen |
| `NSPhotoLibraryUsageDescription` | Foto-OCR, CSV empfohlen |
| `NSMotionUsageDescription` | Qibla-Kompass |

## External APIs

| Domain | Purpose |
|--------|---------|
| `api.aladhan.com` | Prayer times (city name only) |
| `generativelanguage.googleapis.com` | Optional OCR via Gemini API |

## Privacy Label

→ **"Data Not Collected"**
→ No tracking, no analytics, no accounts, no ads

## Archive Command

```
xcodebuild -scheme App -sdk iphoneos -configuration Release archive
```

Or via Xcode: Product → Archive
