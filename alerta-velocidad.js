/**
 * ALERTA DE VELOCIDAD - Grupo Rapid (Resumen Diario)
 * Monitorea vehiculos en tiempo real via SkyData API
 * Registra cada evento de exceso de velocidad (>100 km/h)
 * Envia un resumen diario por correo a las 6:00 AM (hora Panama)
 *
 * Uso: node alerta-velocidad.js
 */

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════
// CONFIGURACION
// ═══════════════════════════════════════════════════

const CONFIG = {
  SKYDATA_API: 'https://acceso.skydatalatam.com/api/v1/',
  SKYDATA_KEY: '45e4305ce0850c7a2a6182ff0f9edded49605029',

  SPEED_LIMIT: 100,

  EMAIL_TO: [
    'vlacayo@gruporapid.com',
    'operaciones@fumipestpanama.com',
    'lzambrano@gruporapid.com',
    'directoroperaciones@rapidfrio.com',
    'almacen2@gruporapid.com',
    'mardito@gruporapid.com'
  ],

  CHECK_INTERVAL: 60 * 1000,        // Monitorear cada 60 segundos
  REPORT_HOUR: 6,                    // Enviar resumen a las 6 AM Panama
  REPORT_CHECK_INTERVAL: 60 * 1000,  // Verificar si es hora del reporte cada minuto

  SMTP: {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: 'Flota@gruporapid.com',
      pass: 'lgns lddw dhgh akrl'
    }
  },
  EMAIL_FROM: '"Control de Flota - Grupo Rapid" <Flota@gruporapid.com>'
};

// ═══════════════════════════════════════════════════
// ESTADO
// ═══════════════════════════════════════════════════

// Incidentes del dia: { unitId: { maxSpeed, count, firstTime, lastTime, label, vehicleInfo, lat, lng, location } }
let dailyIncidents = {};

// Control para no registrar el mismo vehiculo en exceso continuo
// alertState[unitId] = { wasBelowLimit: bool }
const alertState = {};

// Para evitar enviar el reporte mas de una vez
let lastReportDate = '';

let flotaData = [];
try {
  flotaData = JSON.parse(fs.readFileSync(path.join(__dirname, '_flota.json'), 'utf8'));
  console.log(`[INFO] Flota cargada: ${flotaData.length} vehiculos`);
} catch (e) {
  console.log('[AVISO] No se pudo cargar _flota.json');
}

// Cargar incidentes pendientes si existen (por si se reinicia el proceso)
const pendingFile = path.join(__dirname, '_velocidad_pendiente.json');
try {
  const saved = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
  dailyIncidents = saved.incidents || {};
  lastReportDate = saved.lastReportDate || '';
  console.log(`[INFO] Incidentes pendientes cargados: ${Object.keys(dailyIncidents).length}`);
} catch (e) {}

// ═══════════════════════════════════════════════════
// FUNCIONES
// ═══════════════════════════════════════════════════

function getPanamaTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Panama' }));
}

function getPanamaDateStr() {
  const p = getPanamaTime();
  return `${p.getFullYear()}-${String(p.getMonth()+1).padStart(2,'0')}-${String(p.getDate()).padStart(2,'0')}`;
}

function savePending() {
  fs.writeFileSync(pendingFile, JSON.stringify({ incidents: dailyIncidents, lastReportDate }), 'utf8');
}

function findVehicleInfo(unit) {
  if (!flotaData.length) return null;
  if (unit.vin) {
    const match = flotaData.find(v => v.chasis && v.chasis.trim().toLowerCase() === unit.vin.trim().toLowerCase());
    if (match) return match;
  }
  const num = (unit.number || '').replace(/^\d+-/, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (const v of flotaData) {
    const p = (v.placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (p && num && p.length >= 4 && num.length >= 4 && (p.includes(num) || num.includes(p))) return v;
  }
  return null;
}

function shouldRecord(unitId) {
  const state = alertState[unitId];
  if (!state) return true;
  return state.wasBelowLimit;
}

async function fetchGPSUnits() {
  const url = CONFIG.SKYDATA_API + 'unit/list.json?key=' + CONFIG.SKYDATA_KEY;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Error API SkyData: ${response.status}`);
  const json = await response.json();
  return json.data?.units || json.units || [];
}

/**
 * Monitorea y acumula incidentes (no envia correo)
 */
async function checkSpeed() {
  try {
    const units = await fetchGPSUnits();
    const now = getPanamaTime();
    const timeStr = now.toLocaleTimeString('es-PA');
    const nowISO = now.toISOString();

    let newIncidents = 0;

    for (const unit of units) {
      const speed = unit.speed || 0;
      const unitId = unit.id || unit.unit_id || unit.label;

      if (speed > CONFIG.SPEED_LIMIT) {
        if (!shouldRecord(unitId)) continue;

        const label = unit.label || unit.name || 'Unidad ' + unitId;
        const vehicleInfo = findVehicleInfo(unit);

        if (dailyIncidents[unitId]) {
          // Ya tiene un incidente hoy: actualizar velocidad maxima y conteo
          const inc = dailyIncidents[unitId];
          inc.count++;
          inc.lastTime = nowISO;
          if (speed > inc.maxSpeed) {
            inc.maxSpeed = speed;
            inc.lat = unit.lat;
            inc.lng = unit.lng;
            inc.location = unit.address || unit.location || '';
          }
        } else {
          // Nuevo incidente del dia
          dailyIncidents[unitId] = {
            unitId,
            label,
            maxSpeed: speed,
            count: 1,
            firstTime: nowISO,
            lastTime: nowISO,
            lat: unit.lat,
            lng: unit.lng,
            location: unit.address || unit.location || '',
            vehicleInfo
          };
          newIncidents++;
        }

        alertState[unitId] = { wasBelowLimit: false };
      } else {
        if (alertState[unitId]) {
          alertState[unitId].wasBelowLimit = true;
        }
      }
    }

    const online = units.filter(u => u.state?.name !== 'nodata').length;
    const driving = units.filter(u => u.state?.name === 'driving' || (u.speed && u.speed > 0)).length;
    const totalIncidents = Object.keys(dailyIncidents).length;

    console.log(`[${timeStr}] ${units.length} unidades | ${online} online | ${driving} movimiento | Incidentes hoy: ${totalIncidents}${newIncidents > 0 ? ` (+${newIncidents} nuevos)` : ''}`);

    if (newIncidents > 0) savePending();

  } catch (error) {
    console.error(`[ERROR] ${error.message}`);
  }
}

/**
 * Genera el HTML del resumen diario de velocidad
 */
function buildDailyReport(incidents) {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const fechaReporte = yesterday.toLocaleDateString('es-PA', { timeZone: 'America/Panama', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const horaEnvio = now.toLocaleTimeString('es-PA', { timeZone: 'America/Panama', hour: '2-digit', minute: '2-digit' });

  // Ordenar por velocidad maxima (mayor primero)
  const sorted = [...incidents].sort((a, b) => b.maxSpeed - a.maxSpeed);

  let cards = '';
  for (const item of sorted) {
    const v = item.vehicleInfo;
    const isCritical = item.maxSpeed >= 120;
    const speedColor = isCritical ? '#b71c1c' : '#e65100';
    const severityText = isCritical ? 'CRITICO' : 'GRAVE';
    const mapUrl = item.lat ? `https://www.google.com/maps?q=${item.lat},${item.lng}` : '';

    const firstTime = new Date(item.firstTime).toLocaleTimeString('es-PA', { timeZone: 'America/Panama', hour: '2-digit', minute: '2-digit' });
    const lastTime = new Date(item.lastTime).toLocaleTimeString('es-PA', { timeZone: 'America/Panama', hour: '2-digit', minute: '2-digit' });
    const timeRange = item.count === 1 ? firstTime : `${firstTime} - ${lastTime}`;

    cards += `
      <div style="background:#fff;border-radius:12px;border-left:5px solid ${speedColor};margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,0.06);overflow:hidden">
        <div style="padding:20px 24px">
          <div style="display:flex;align-items:center;margin-bottom:14px">
            <span style="font-size:32px;font-weight:800;color:${speedColor};line-height:1">${item.maxSpeed}</span>
            <span style="font-size:14px;color:${speedColor};font-weight:600;margin-left:4px">km/h max</span>
            <span style="display:inline-block;background:${speedColor};color:#fff;font-size:10px;font-weight:700;padding:3px 12px;border-radius:12px;letter-spacing:0.5px;margin-left:12px">${severityText}</span>
          </div>
          <table style="width:100%;border-collapse:collapse" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:5px 0;font-size:12px;color:#999;width:110px;vertical-align:top">Conductor</td>
              <td style="padding:5px 0;font-size:14px;font-weight:700;color:#1a237e">${v ? v.conductor : 'No identificado'}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;font-size:12px;color:#999;vertical-align:top">Placa</td>
              <td style="padding:5px 0;font-size:13px">
                <span style="background:#eef;padding:3px 10px;border-radius:6px;font-family:monospace;font-weight:700;color:#1a237e;letter-spacing:1px">${v ? v.placa : 'N/A'}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:5px 0;font-size:12px;color:#999;vertical-align:top">Vehiculo</td>
              <td style="padding:5px 0;font-size:13px;color:#333">${v ? v.modelo + ' (' + v.ano + ')' : 'N/A'} &middot; <span style="color:#666">${v ? v.tipo : ''}</span></td>
            </tr>
            <tr>
              <td style="padding:5px 0;font-size:12px;color:#999;vertical-align:top">Empresa</td>
              <td style="padding:5px 0;font-size:13px;font-weight:600;color:#333">${v ? v.empresa : 'N/A'}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;font-size:12px;color:#999;vertical-align:top">Area</td>
              <td style="padding:5px 0;font-size:13px;color:#555">${v ? v.area : 'N/A'}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;font-size:12px;color:#999;vertical-align:top">Detecciones</td>
              <td style="padding:5px 0;font-size:13px;color:#333">${item.count} vez(ces) &middot; <span style="color:#666">${timeRange}</span></td>
            </tr>
          </table>
        </div>
        ${mapUrl ? `<div style="padding:10px 24px;background:#f8f9ff;border-top:1px solid #eef"><a href="${mapUrl}" style="color:#1565c0;text-decoration:none;font-size:12px;font-weight:500">&#128205; Ver ultima ubicacion en Google Maps &rarr;</a></div>` : ''}
      </div>`;
  }

  const criticalCount = sorted.filter(i => i.maxSpeed >= 120).length;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;margin:0;padding:0;background:#f0f2f5">
<div style="max-width:600px;margin:0 auto;padding:24px 16px">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#1a237e 0%,#283593 50%,#303f9f 100%);border-radius:16px 16px 0 0;padding:36px 32px;text-align:center">
    <img src="https://plataforma-flota-rapid.netlify.app/logo.jpg" alt="Grupo Rapid" style="width:80px;height:80px;border-radius:50%;border:3px solid rgba(255,255,255,0.3);margin:0 auto 16px;display:block" />
    <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;letter-spacing:0.3px">RESUMEN DIARIO DE EXCESO DE VELOCIDAD</h1>
    <p style="color:rgba(255,255,255,0.65);margin:10px 0 0;font-size:13px">Reporte generado a las ${horaEnvio} (Hora Panama)</p>
  </div>

  <!-- Summary bar -->
  <div style="background:#fff;padding:20px 32px;display:flex;border-bottom:1px solid #eee">
    <div style="flex:1">
      <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:6px;font-weight:600">Periodo del reporte</div>
      <div style="font-size:14px;font-weight:600;color:#333;text-transform:capitalize">${fechaReporte}</div>
    </div>
    <div style="display:flex;gap:12px">
      <div style="text-align:center;background:linear-gradient(135deg,#ffebee,#fce4ec);padding:12px 16px;border-radius:12px;min-width:55px">
        <div style="font-size:28px;font-weight:800;color:#c62828;line-height:1">${sorted.length}</div>
        <div style="font-size:8px;color:#c62828;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-top:4px">Vehiculos</div>
      </div>
      ${criticalCount > 0 ? `<div style="text-align:center;background:linear-gradient(135deg,#fce4ec,#f8bbd0);padding:12px 16px;border-radius:12px;min-width:55px">
        <div style="font-size:28px;font-weight:800;color:#b71c1c;line-height:1">${criticalCount}</div>
        <div style="font-size:8px;color:#b71c1c;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-top:4px">Criticos</div>
      </div>` : ''}
    </div>
  </div>

  <!-- Warning bar -->
  <div style="background:#fff8e1;padding:14px 32px;border-bottom:1px solid #fff0c0;font-size:12px;color:#e65100;line-height:1.5">
    <strong>&#9888; Resumen:</strong> Durante el dia de ayer, <strong>${sorted.length} vehiculo(s)</strong> fueron detectados circulando por encima del limite de <strong>${CONFIG.SPEED_LIMIT} km/h</strong>.
  </div>

  <!-- Vehicle cards -->
  <div style="background:#f5f7fa;padding:24px 28px">
    <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:16px;font-weight:700">&#128663; Detalle por vehiculo (ordenado por velocidad maxima)</div>
    ${cards}
  </div>

  <!-- Action note -->
  <div style="background:#fff;padding:20px 32px;border-top:1px solid #eee">
    <div style="background:#e8f5e9;border-radius:10px;padding:14px 18px;font-size:12px;color:#2e7d32;line-height:1.6">
      <strong>&#9989; Acciones recomendadas:</strong><br>
      &bull; Revisar con cada conductor las infracciones registradas<br>
      &bull; Registrar las infracciones en el expediente del vehiculo<br>
      &bull; Dar seguimiento a conductores reincidentes
    </div>
  </div>

  <!-- Footer -->
  <div style="background:linear-gradient(135deg,#1a237e,#283593);border-radius:0 0 16px 16px;padding:28px 32px;text-align:center">
    <img src="https://plataforma-flota-rapid.netlify.app/logo.jpg" alt="Grupo Rapid" style="width:40px;height:40px;border-radius:50%;margin:0 auto 10px;display:block;opacity:0.8" />
    <p style="color:rgba(255,255,255,0.9);margin:0 0 4px;font-size:14px;font-weight:600">Control de Flota</p>
    <p style="color:rgba(255,255,255,0.5);margin:0 0 16px;font-size:12px">Grupo Rapid &middot; Panama</p>
    <div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:16px">
      <p style="color:rgba(255,255,255,0.4);margin:0;font-size:10px;line-height:1.6">
        Monitoreo 24/7 cada 60 seg &middot; Limite: ${CONFIG.SPEED_LIMIT} km/h<br>
        Resumen enviado diariamente a las ${CONFIG.REPORT_HOUR}:00 AM
      </p>
    </div>
  </div>

</div>
</body>
</html>`;
}

/**
 * Envia el resumen diario y limpia los incidentes
 */
async function sendDailyReport() {
  const incidents = Object.values(dailyIncidents);

  if (incidents.length === 0) {
    console.log('[REPORTE] No hubo incidentes de velocidad ayer. No se envia correo.');
    return;
  }

  const transporter = nodemailer.createTransport(CONFIG.SMTP);
  const toList = CONFIG.EMAIL_TO.join(', ');
  const criticalCount = incidents.filter(i => i.maxSpeed >= 120).length;
  const subject = `📊 RESUMEN VELOCIDAD: ${incidents.length} vehiculo(s) excedieron ${CONFIG.SPEED_LIMIT} km/h ayer${criticalCount > 0 ? ` (${criticalCount} criticos)` : ''}`;

  const info = await transporter.sendMail({
    from: CONFIG.EMAIL_FROM,
    to: toList,
    subject,
    html: buildDailyReport(incidents)
  });

  console.log(`[REPORTE] Resumen diario enviado a ${toList}`);
  console.log(`          ${incidents.length} vehiculos, Message ID: ${info.messageId}`);

  // Limpiar incidentes del dia
  dailyIncidents = {};
  savePending();
}

/**
 * Verifica si es hora de enviar el reporte (6 AM Panama)
 */
async function checkReportTime() {
  const panama = getPanamaTime();
  const hour = panama.getHours();
  const todayStr = getPanamaDateStr();

  if (hour === CONFIG.REPORT_HOUR && lastReportDate !== todayStr) {
    lastReportDate = todayStr;
    savePending();
    try {
      await sendDailyReport();
    } catch (error) {
      console.error(`[ERROR REPORTE] ${error.message}`);
      lastReportDate = ''; // Reintentar
    }
  }
}

/**
 * Guarda log en archivo CSV
 */
function logToCSV(item) {
  const logPath = path.join(__dirname, 'alertas-velocidad.csv');
  const exists = fs.existsSync(logPath);

  let line = '';
  if (!exists) {
    line = 'fecha,hora,velocidad_kmh,conductor,placa,empresa,modelo,area,ubicacion\n';
  }

  const now = new Date();
  const v = item.vehicleInfo;
  line += [
    now.toLocaleDateString('es-PA'), now.toLocaleTimeString('es-PA'), item.maxSpeed,
    v ? v.conductor : 'Desconocido', v ? v.placa : 'N/A',
    v ? v.empresa : 'N/A', v ? `${v.modelo} ${v.ano}` : 'N/A',
    v ? v.area : 'N/A', `"${item.location || 'Sin ubicacion'}"`
  ].join(',') + '\n';

  fs.appendFileSync(logPath, line, 'utf8');
}

// ═══════════════════════════════════════════════════
// INICIO
// ═══════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════');
console.log('  ALERTA DE VELOCIDAD - RESUMEN DIARIO');
console.log('  Grupo Rapid - Control de Flota');
console.log('═══════════════════════════════════════════════════');
console.log(`  Limite: ${CONFIG.SPEED_LIMIT} km/h`);
console.log(`  Resumen diario: ${CONFIG.REPORT_HOUR}:00 AM (hora Panama)`);
console.log(`  Destinatarios:`);
CONFIG.EMAIL_TO.forEach(e => console.log(`    - ${e}`));
console.log(`  Monitoreo: cada ${CONFIG.CHECK_INTERVAL / 1000} segundos`);
console.log(`  Incidentes pendientes: ${Object.keys(dailyIncidents).length}`);
console.log(`  Vehiculos en flota: ${flotaData.length}`);
console.log('═══════════════════════════════════════════════════');
console.log('  Iniciando monitoreo...\n');

checkSpeed();
setInterval(checkSpeed, CONFIG.CHECK_INTERVAL);
setInterval(checkReportTime, CONFIG.REPORT_CHECK_INTERVAL);
