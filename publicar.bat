@echo off
echo ========================================
echo   Publicando Plataforma de Flota...
echo ========================================
echo.
cd /d "%~dp0"
git add -A
git commit -m "Actualizar plataforma"
git push origin master
echo.
echo ========================================
echo   Listo! Plataforma actualizada.
echo   https://flota-png.github.io/plataforma-flota/plataforma.html
echo ========================================
pause
