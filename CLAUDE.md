# Plataforma de Flota - Grupo Rapid

## Descripcion
Plataforma web de control de flota vehicular para Grupo Rapid (Panama). Aplicacion single-page (plataforma.html) desplegada en Netlify.

**URL produccion:** https://plataforma-flota-rapid.netlify.app

## Modulos de la plataforma
1. **Dashboard** - KPIs, graficas de distribucion por empresa/tipo, gastos mensuales, consumo combustible, alertas
2. **Flota** - Base de datos de vehiculos (placa, chasis, modelo, empresa, conductor, estado)
3. **Combustible** - Registros de tanqueo desde Terpel, consumo por vehiculo
4. **Gastos** - Control de gastos operativos (costos, multas, llantas)
5. **Mantenimiento** - Programacion y seguimiento de mantenimientos
6. **Reportes** - Reportes de recorridos, infracciones, comportamiento de conductores
7. **GPS Tracking** - Mapa en tiempo real via SkyData API (Leaflet)
8. **Reemplazo** - Analisis de reemplazo de vehiculos
9. **Importar** - Importacion de datos desde Excel

## Arquitectura
- **Frontend:** HTML unico (plataforma.html ~2900 lineas) con CSS inline, JS vanilla, Chart.js, Leaflet
- **Datos:** JSON embebido en el HTML (flota, combustible, costos, multas, llantas, mantenimiento, reps)
- **Archivos JSON externos:** _flota.json, _fuel.json, _costos.json, _multas.json, _llantas.json, _mant.json, _reps.json, alldata.json
- **Deploy:** publicar.bat copia a carpeta deploy y sube con Netlify CLI

## Scripts Node.js
- **alerta-velocidad.js** - Monitorea GPS cada 60s, envia email si vehiculo supera 100 km/h (usa SkyData API + nodemailer)
- **sync-terpel.js** - Scraping de portal Terpel Panama con Puppeteer para extraer datos de combustible
- **prueba-alerta.js** - Script de prueba para alertas

## APIs externas
- **SkyData GPS:** https://acceso.skydatalatam.com/api/v1/
- **Portal Terpel:** https://portal.terpelpanama.com/NPW/Reportes

## Dependencias (Node.js)
- nodemailer (envio de correos)
- puppeteer (scraping Terpel)
- xlsx (lectura de Excel)

## Estado actual (2026-03-18)
- Plataforma funcional y desplegada en Netlify
- Todos los modulos operativos
- Datos de combustible sincronizados desde Terpel
- Sistema de alertas de velocidad configurado
