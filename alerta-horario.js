/**
 * ALERTA DE USO EN HORARIO NO AUTORIZADO - Grupo Rapid (Resumen Diario)
 * Monitorea vehiculos en tiempo real via SkyData API
 * Registra vehiculos activos fuera de horario:
 *   - Entre 8:00 PM y 5:00 AM (lunes a sabado)
 *   - Cualquier hora los dias domingo
 * Envia un resumen diario por correo a las 6:00 AM (hora Panama)
 *
 * Uso: node alerta-horario.js
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

  HORA_INICIO_RESTRICCION: 20,
  HORA_FIN_RESTRICCION: 5,

  EMAIL_TO: [
    'vlacayo@gruporapid.com',
    'operaciones@fumipestpanama.com',
    'lzambrano@gruporapid.com',
    'directoroperaciones@rapidfrio.com',
    'almacen2@gruporapid.com',
    'mardito@gruporapid.com'
  ],

  CHECK_INTERVAL: 5 * 60 * 1000,     // Revisar cada 5 minutos
  REPORT_HOUR: 6,                     // Enviar resumen a las 6 AM Panama
  REPORT_CHECK_INTERVAL: 60 * 1000,

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

// Incidentes: { unitId: { label, vehicleInfo, firstTime, lastTime, maxSpeed, detections, restrictionType, lat, lng } }
let dailyIncidents = {};
let lastReportDate = '';

let flotaData = [];
try {
  flotaData = JSON.parse(fs.readFileSync(path.join(__dirname, '_flota.json'), 'utf8'));
  console.log(`[INFO] Flota cargada: ${flotaData.length} vehiculos`);
} catch (e) {
  console.log('[AVISO] No se pudo cargar _flota.json');
}

// Cargar incidentes pendientes
const pendingFile = path.join(__dirname, '_horario_pendiente.json');
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

function getRestrictionType() {
  const panama = getPanamaTime();
  const dayOfWeek = panama.getDay();
  const hour = panama.getHours();

  if (dayOfWeek === 0) return 'domingo';
  if (hour >= CONFIG.HORA_INICIO_RESTRICCION || hour < CONFIG.HORA_FIN_RESTRICCION) return 'nocturno';
  return null;
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

function isVehicleActive(unit) {
  const speed = unit.speed || 0;
  const state = unit.state?.name || '';
  return speed > 0 || state === 'driving' || state === 'idle';
}

async function fetchGPSUnits() {
  const url = CONFIG.SKYDATA_API + 'unit/list.json?key=' + CONFIG.SKYDATA_KEY;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Error API SkyData: ${response.status}`);
  const json = await response.json();
  return json.data?.units || json.units || [];
}

/**
 * Monitorea y acumula incidentes
 */
async function checkSchedule() {
  try {
    const restrictionType = getRestrictionType();
    const panama = getPanamaTime();
    const timeStr = panama.toLocaleTimeString('es-PA');
    const dayName = panama.toLocaleDateString('es-PA', { weekday: 'long' });

    if (!restrictionType) {
      console.log(`[${timeStr}] (${dayName}) Horario laboral normal - sin restriccion`);
      return;
    }

    const units = await fetchGPSUnits();
    const nowISO = panama.toISOString();
    let newDetections = 0;

    for (const unit of units) {
      if (!isVehicleActive(unit)) continue;

      const unitId = unit.id || unit.unit_id || unit.label;
      const label = unit.label || unit.name || 'Unidad ' + unitId;
      const speed = unit.speed || 0;

      if (dailyIncidents[unitId]) {
        const inc = dailyIncidents[unitId];
        inc.detections++;
        inc.lastTime = nowISO;
        if (speed > inc.maxSpeed) {
          inc.maxSpeed = speed;
          inc.lat = unit.lat;
          inc.lng = unit.lng;
        }
      } else {
        dailyIncidents[unitId] = {
          unitId,
          label,
          vehicleInfo: findVehicleInfo(unit),
          firstTime: nowISO,
          lastTime: nowISO,
          maxSpeed: speed,
          detections: 1,
          restrictionType,
          lat: unit.lat,
          lng: unit.lng
        };
        newDetections++;
      }
    }

    const totalActive = units.filter(u => isVehicleActive(u)).length;
    const totalIncidents = Object.keys(dailyIncidents).length;
    const typeLabel = restrictionType === 'domingo' ? 'DOMINGO' : 'NOCTURNO';

    console.log(`[${timeStr}] (${dayName}) ${typeLabel} | Activos: ${totalActive} | Registrados hoy: ${totalIncidents}${newDetections > 0 ? ` (+${newDetections})` : ''}`);

    if (newDetections > 0) savePending();

  } catch (error) {
    console.error(`[ERROR] ${error.message}`);
  }
}

/**
 * Genera el HTML del resumen diario
 */
function buildDailyReport(incidents) {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const fechaReporte = yesterday.toLocaleDateString('es-PA', { timeZone: 'America/Panama', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const horaEnvio = now.toLocaleTimeString('es-PA', { timeZone: 'America/Panama', hour: '2-digit', minute: '2-digit' });

  const nocturno = incidents.filter(i => i.restrictionType === 'nocturno');
  const domingo = incidents.filter(i => i.restrictionType === 'domingo');

  function buildCards(items) {
    let cards = '';
    for (const item of items) {
      const v = item.vehicleInfo;
      const stateColor = item.maxSpeed > 0 ? '#e65100' : '#f57f17';
      const stateText = item.maxSpeed > 0 ? `Max: ${item.maxSpeed} km/h` : 'Encendido / Detenido';
      const mapUrl = item.lat ? `https://www.google.com/maps?q=${item.lat},${item.lng}` : '';

      const firstTime = new Date(item.firstTime).toLocaleTimeString('es-PA', { timeZone: 'America/Panama', hour: '2-digit', minute: '2-digit' });
      const lastTime = new Date(item.lastTime).toLocaleTimeString('es-PA', { timeZone: 'America/Panama', hour: '2-digit', minute: '2-digit' });
      const timeRange = item.detections === 1 ? firstTime : `${firstTime} - ${lastTime}`;

      cards += `
        <div style="background:#fff;border-radius:12px;border-left:5px solid ${stateColor};margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.06);overflow:hidden">
          <div style="padding:16px 20px">
            <div style="display:flex;align-items:center;margin-bottom:10px">
              <span style="display:inline-block;background:${stateColor};color:#fff;font-size:10px;font-weight:700;padding:3px 12px;border-radius:12px">${stateText}</span>
              <span style="font-size:11px;color:#999;margin-left:10px">${item.detections} deteccion(es) &middot; ${timeRange}</span>
            </div>
            <table style="width:100%;border-collapse:collapse" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:3px 0;font-size:12px;color:#999;width:90px">Conductor</td>
                <td style="padding:3px 0;font-size:13px;font-weight:700;color:#1a237e">${v ? v.conductor : 'No identificado'}</td>
              </tr>
              <tr>
                <td style="padding:3px 0;font-size:12px;color:#999">Placa</td>
                <td style="padding:3px 0;font-size:12px"><span style="background:#eef;padding:2px 8px;border-radius:4px;font-family:monospace;font-weight:700;color:#1a237e">${v ? v.placa : 'N/A'}</span></td>
              </tr>
              <tr>
                <td style="padding:3px 0;font-size:12px;color:#999">Vehiculo</td>
                <td style="padding:3px 0;font-size:12px;color:#333">${v ? v.modelo + ' (' + v.ano + ')' : 'N/A'} &middot; ${v ? v.empresa : 'N/A'}</td>
              </tr>
            </table>
          </div>
          ${mapUrl ? `<div style="padding:8px 20px;background:#f8f9ff;border-top:1px solid #eef"><a href="${mapUrl}" style="color:#1565c0;text-decoration:none;font-size:11px">&#128205; Ver ubicacion &rarr;</a></div>` : ''}
        </div>`;
    }
    return cards;
  }

  let sections = '';

  if (nocturno.length > 0) {
    sections += `
      <div style="background:#f5f7fa;padding:24px 28px;border-bottom:1px solid #eee">
        <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:4px;font-weight:700">&#127769; Uso nocturno (8:00 PM - 5:00 AM)</div>
        <div style="font-size:12px;color:#666;margin-bottom:16px">${nocturno.length} vehiculo(s) detectados</div>
        ${buildCards(nocturno)}
      </div>`;
  }

  if (domingo.length > 0) {
    sections += `
      <div style="background:#f5f7fa;padding:24px 28px">
        <div style="font-size:10px;color:#7b1fa2;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:4px;font-weight:700">&#128197; Uso en domingo</div>
        <div style="font-size:12px;color:#666;margin-bottom:16px">${domingo.length} vehiculo(s) detectados</div>
        ${buildCards(domingo)}
      </div>`;
  }

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;margin:0;padding:0;background:#f0f2f5">
<div style="max-width:600px;margin:0 auto;padding:24px 16px">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#4a148c 0%,#6a1b9a 50%,#7b1fa2 100%);border-radius:16px 16px 0 0;padding:36px 32px;text-align:center">
    <img src="https://plataforma-flota-rapid.netlify.app/logo.jpg" alt="Grupo Rapid" style="width:80px;height:80px;border-radius:50%;border:3px solid rgba(255,255,255,0.3);margin:0 auto 16px;display:block" />
    <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">RESUMEN DIARIO DE USO NO AUTORIZADO</h1>
    <p style="color:rgba(255,255,255,0.65);margin:10px 0 0;font-size:13px">Reporte generado a las ${horaEnvio} (Hora Panama)</p>
  </div>

  <!-- Summary bar -->
  <div style="background:#fff;padding:20px 32px;display:flex;border-bottom:1px solid #eee">
    <div style="flex:1">
      <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:6px;font-weight:600">Periodo del reporte</div>
      <div style="font-size:14px;font-weight:600;color:#333;text-transform:capitalize">${fechaReporte}</div>
    </div>
    <div style="display:flex;gap:12px">
      ${nocturno.length > 0 ? `<div style="text-align:center;background:#e8eaf6;padding:12px 16px;border-radius:12px;min-width:55px">
        <div style="font-size:28px;font-weight:800;color:#1a237e;line-height:1">${nocturno.length}</div>
        <div style="font-size:8px;color:#1a237e;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-top:4px">Nocturno</div>
      </div>` : ''}
      ${domingo.length > 0 ? `<div style="text-align:center;background:#f3e5f5;padding:12px 16px;border-radius:12px;min-width:55px">
        <div style="font-size:28px;font-weight:800;color:#7b1fa2;line-height:1">${domingo.length}</div>
        <div style="font-size:8px;color:#7b1fa2;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-top:4px">Domingo</div>
      </div>` : ''}
    </div>
  </div>

  <!-- Warning bar -->
  <div style="background:#fff8e1;padding:14px 32px;border-bottom:1px solid #fff0c0;font-size:12px;color:#e65100;line-height:1.5">
    <strong>&#9888; Resumen:</strong> Se detectaron <strong>${incidents.length} vehiculo(s)</strong> en uso fuera del horario laboral autorizado durante el dia de ayer.
  </div>

  ${sections}

  <!-- Action note -->
  <div style="background:#fff;padding:20px 32px;border-top:1px solid #eee">
    <div style="background:#e8f5e9;border-radius:10px;padding:14px 18px;font-size:12px;color:#2e7d32;line-height:1.6">
      <strong>&#9989; Acciones recomendadas:</strong><br>
      &bull; Verificar si el uso del vehiculo estaba autorizado<br>
      &bull; Contactar al conductor asignado<br>
      &bull; Registrar el incidente en el expediente del vehiculo
    </div>
  </div>

  <!-- Footer -->
  <div style="background:linear-gradient(135deg,#4a148c,#6a1b9a);border-radius:0 0 16px 16px;padding:28px 32px;text-align:center">
    <img src="https://plataforma-flota-rapid.netlify.app/logo.jpg" alt="Grupo Rapid" style="width:40px;height:40px;border-radius:50%;margin:0 auto 10px;display:block;opacity:0.8" />
    <p style="color:rgba(255,255,255,0.9);margin:0 0 4px;font-size:14px;font-weight:600">Control de Flota</p>
    <p style="color:rgba(255,255,255,0.5);margin:0 0 16px;font-size:12px">Grupo Rapid &middot; Panama</p>
    <div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:16px">
      <p style="color:rgba(255,255,255,0.4);margin:0;font-size:10px;line-height:1.6">
        Monitoreo cada 5 min &middot; Nocturno: 8PM-5AM &middot; Domingos: todo el dia<br>
        Resumen enviado diariamente a las ${CONFIG.REPORT_HOUR}:00 AM
      </p>
    </div>
  </div>

</div>
</body>
</html>`;
}

/**
 * Envia el resumen diario
 */
async function sendDailyReport() {
  const incidents = Object.values(dailyIncidents);

  if (incidents.length === 0) {
    console.log('[REPORTE] No hubo uso en horario no autorizado ayer. No se envia correo.');
    return;
  }

  const transporter = nodemailer.createTransport(CONFIG.SMTP);
  const toList = CONFIG.EMAIL_TO.join(', ');
  const nocturno = incidents.filter(i => i.restrictionType === 'nocturno').length;
  const domingo = incidents.filter(i => i.restrictionType === 'domingo').length;
  const parts = [];
  if (nocturno > 0) parts.push(`${nocturno} nocturno`);
  if (domingo > 0) parts.push(`${domingo} domingo`);
  const subject = `🌙 RESUMEN USO NO AUTORIZADO: ${incidents.length} vehiculo(s) (${parts.join(', ')})`;

  const info = await transporter.sendMail({
    from: CONFIG.EMAIL_FROM,
    to: toList,
    subject,
    html: buildDailyReport(incidents)
  });

  console.log(`[REPORTE] Resumen diario enviado a ${toList}`);
  console.log(`          ${incidents.length} vehiculos, Message ID: ${info.messageId}`);

  dailyIncidents = {};
  savePending();
}

/**
 * Verifica si es hora de enviar el reporte
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
      lastReportDate = '';
    }
  }
}

// ═══════════════════════════════════════════════════
// INICIO
// ═══════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════');
console.log('  ALERTA HORARIO NO AUTORIZADO - RESUMEN DIARIO');
console.log('  Grupo Rapid - Control de Flota');
console.log('═══════════════════════════════════════════════════');
console.log(`  Restriccion nocturna: ${CONFIG.HORA_INICIO_RESTRICCION}:00 - ${CONFIG.HORA_FIN_RESTRICCION}:00`);
console.log(`  Restriccion dominical: todo el dia`);
console.log(`  Resumen diario: ${CONFIG.REPORT_HOUR}:00 AM (hora Panama)`);
console.log(`  Destinatarios:`);
CONFIG.EMAIL_TO.forEach(e => console.log(`    - ${e}`));
console.log(`  Monitoreo: cada ${CONFIG.CHECK_INTERVAL / 1000 / 60} minutos`);
console.log(`  Incidentes pendientes: ${Object.keys(dailyIncidents).length}`);
console.log(`  Vehiculos en flota: ${flotaData.length}`);
console.log('═══════════════════════════════════════════════════');
console.log('  Iniciando monitoreo...\n');

checkSchedule();
setInterval(checkSchedule, CONFIG.CHECK_INTERVAL);
setInterval(checkReportTime, CONFIG.REPORT_CHECK_INTERVAL);
