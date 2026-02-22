# FushaCards — App Store Privacy Declaration

## Data Collection: NONE

This app does **not** collect, store, or transmit any personal data.

## Permissions Used

| Permission | Purpose | Data Linked to User? |
|-----------|---------|---------------------|
| Location (When In Use) | Qibla direction + prayer times calculation | NO — not stored, not sent |
| Camera | OCR text scanning for flashcard creation | NO — processed locally only |
| Photo Library | Select images for OCR text recognition | NO — processed locally only |
| Motion/Compass | Qibla compass needle orientation | NO |

## External API Calls

| API | Purpose | Data Sent |
|-----|---------|-----------|
| api.aladhan.com | Prayer times by city name | City name only (no GPS coords) |
| generativelanguage.googleapis.com | Optional OCR (Gemini) | Image data for text recognition |

## Tracking

- **No tracking SDKs** (no Firebase, no Analytics, no Crashlytics)
- **No user accounts** or login
- **No advertising** or ad SDKs
- **No data shared** with third parties for tracking

## App Store Privacy Label

Select: **"Data Not Collected"**

Exception: If Apple requires declaring Location:
- Category: Location → Precise Location
- Purpose: App Functionality
- Linked to User: NO
- Used for Tracking: NO
