/**
 * copy-web-to-app.js
 * Copies all files from /web to /app/www for Capacitor embedding.
 * Usage: node tools/copy-web-to-app.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'web');
const DEST = path.join(ROOT, 'app', 'www');

function copyDir(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });
    let fileCount = 0;

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        // Skip start-app.bat (Windows dev-only)
        if (entry.name === 'start-app.bat') continue;

        if (entry.isDirectory()) {
            fileCount += copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
            fileCount++;
        }
    }

    return fileCount;
}

// Clean destination first
if (fs.existsSync(DEST)) {
    fs.rmSync(DEST, { recursive: true, force: true });
    console.log('🗑️  Cleaned old /app/www');
}

const count = copyDir(SRC, DEST);
console.log(`✅ Copied ${count} files: /web → /app/www`);
