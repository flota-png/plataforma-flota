@echo off
echo ========================================
echo   Publicando Plataforma de Flota...
echo ========================================
echo.
copy /Y "%~dp0plataforma.html" "C:\Users\Flota\deploy-flota\index.html" >nul
copy /Y "%~dp0logo.jpg" "C:\Users\Flota\deploy-flota\logo.jpg" >nul
echo Archivos copiados. Subiendo a Netlify...
echo.
cd "C:\Users\Flota\deploy-flota"
netlify deploy --dir=. --prod --site=23a9405f-25f2-461a-8797-92eb36ec416f
echo.
echo ========================================
echo   Listo! Plataforma actualizada.
echo   https://plataforma-flota-rapid.netlify.app
echo ========================================
pause
