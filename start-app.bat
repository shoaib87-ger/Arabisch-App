@echo off
title Dr. Shoaibs Lern-App
echo.
echo  ========================================
echo   Dr. Shoaibs Lern-App wird gestartet...
echo  ========================================
echo.
echo  Oeffne http://localhost:3000 im Browser
echo  Zum Beenden: Dieses Fenster schliessen
echo.

start "" http://localhost:3000
npx -y serve . -l 3000
