@echo off
echo === Copying /web to /app/www ===
node "%~dp0copy-web-to-app.js"
echo.
echo Done. Run "cd app && npx cap sync ios" next.
