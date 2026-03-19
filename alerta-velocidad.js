/**
 * ALERTA DE VELOCIDAD - Grupo Rapid
 * Monitorea vehiculos en tiempo real via SkyData API
 * Envia alertas por correo cuando un vehiculo supera los 100 km/h
 *
 * Uso: node alerta-velocidad.js
 *
 * IMPORTANTE: Configurar las credenciales SMTP antes de ejecutar.
 */

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════
// CONFIGURACION
// ═══════════════════════════════════════════════════

const CONFIG = {
  // SkyData GPS API
  SKYDATA_API: 'https://acceso.skydatalatam.com/api/v1/',
  SKYDATA_KEY: '45e4305ce0850c7a2a6182ff0f9edded49605029',

  // Limite de velocidad (km/h)
  SPEED_LIMIT: 100,

  // Correo destinatario
  EMAIL_TO: 'Flota@gruporapid.com',

  // Intervalo de monitoreo (milisegundos) - cada 60 segundos
  CHECK_INTERVAL: 60 * 1000,

  // Cooldown por vehiculo: no reenviar alerta del mismo vehiculo
  // hasta que pasen estos minutos desde la ultima alerta
  ALERT_COOLDOWN_MINUTES: 10,

  // ═══════════════════════════════════════════════════
  // CONFIGURACION SMTP - MODIFICAR CON SUS DATOS
  // ═══════════════════════════════════════════════════
  // Opcion 1: Gmail (requiere "Contrasena de aplicacion")
  //   - Ir a myaccount.google.com > Seguridad > Verificacion en 2 pasos > Contrasenas de aplicaciones
  //   - Generar una contrasena para "Correo"
  SMTP: {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: 'Flota@gruporapid.com',
      pass: 'Lb011417'
    }
  },
  EMAIL_FROM: '"Control de Flota - Grupo Rapid" <Flota@gruporapid.com>'
};

// ═══════════════════════════════════════════════════
// ESTADO
// ═══════════════════════════════════════════════════

// Registro de alertas enviadas { unitId: timestamp }
const alertHistory = {};

// Cargar datos de flota para enriquecer alertas
let flotaData = [];
try {
  const flotaPath = path.join(__dirname, '_flota.json');
  flotaData = JSON.parse(fs.readFileSync(flotaPath, 'utf8'));
  console.log(`[INFO] Flota cargada: ${flotaData.length} vehiculos`);
} catch (e) {
  console.log('[AVISO] No se pudo cargar _flota.json - las alertas se enviaran sin datos de flota');
}

// ═══════════════════════════════════════════════════
// FUNCIONES
// ═══════════════════════════════════════════════════

/**
 * Busca informacion del vehiculo en la base de flota
 * Compara por chasis (VIN) o por nombre/label
 */
function findVehicleInfo(unit) {
  if (!flotaData.length) return null;

  // Intentar match por chasis
  if (unit.vin) {
    const match = flotaData.find(v =>
      v.chasis && v.chasis.trim().toLowerCase() === unit.vin.trim().toLowerCase()
    );
    if (match) return match;
  }

  // Intentar match por label (puede contener placa)
  const label = (unit.label || unit.name || '').toUpperCase();
  for (const v of flotaData) {
    const placa = (v.placa || '').toUpperCase().replace(/[-\s]/g, '');
    if (placa && label.includes(placa)) return v;
  }

  return null;
}

/**
 * Verifica si ya se envio una alerta reciente para este vehiculo
 */
function isInCooldown(unitId) {
  const lastAlert = alertHistory[unitId];
  if (!lastAlert) return false;
  const elapsed = (Date.now() - lastAlert) / 1000 / 60; // minutos
  return elapsed < CONFIG.ALERT_COOLDOWN_MINUTES;
}

/**
 * Consulta la API de SkyData para obtener unidades GPS en tiempo real
 */
async function fetchGPSUnits() {
  const url = CONFIG.SKYDATA_API + 'unit/list.json?key=' + CONFIG.SKYDATA_KEY;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Error API SkyData: ${response.status} ${response.statusText}`);
  }
  const json = await response.json();
  return json.data?.units || json.units || [];
}

/**
 * Crea el transporte SMTP para enviar correos
 */
function createMailTransport() {
  return nodemailer.createTransport(CONFIG.SMTP);
}

/**
 * Genera el HTML del correo de alerta
 */
function buildAlertEmail(speeding) {
  const now = new Date().toLocaleString('es-PA', { timeZone: 'America/Panama' });

  let vehicleRows = '';
  for (const item of speeding) {
    const v = item.vehicleInfo;
    const conductor = v ? v.conductor : 'Desconocido';
    const placa = v ? v.placa : 'N/A';
    const empresa = v ? v.empresa : 'N/A';
    const modelo = v ? `${v.modelo} ${v.ano}` : 'N/A';
    const tipo = v ? v.tipo : 'N/A';
    const area = v ? v.area : 'N/A';

    const severityColor = item.speed >= 120 ? '#b71c1c' : '#c62828';
    const severityLabel = item.speed >= 120 ? 'CRITICO' : 'GRAVE';

    vehicleRows += `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #eee;font-weight:bold;color:${severityColor};font-size:18px">
          ${item.speed} km/h
          <span style="font-size:11px;background:${severityColor};color:white;padding:2px 6px;border-radius:4px;margin-left:6px">${severityLabel}</span>
        </td>
        <td style="padding:10px;border-bottom:1px solid #eee">
          <strong>${conductor}</strong><br>
          <span style="color:#666;font-size:13px">Placa: ${placa}</span>
        </td>
        <td style="padding:10px;border-bottom:1px solid #eee">
          ${modelo}<br>
          <span style="color:#666;font-size:13px">${tipo}</span>
        </td>
        <td style="padding:10px;border-bottom:1px solid #eee">${empresa}</td>
        <td style="padding:10px;border-bottom:1px solid #eee">${area}</td>
        <td style="padding:10px;border-bottom:1px solid #eee;font-size:12px;color:#666">
          ${item.location || 'Sin ubicacion'}
        </td>
      </tr>`;
  }

  return `
  <!DOCTYPE html>
  <html>
  <head><meta charset="utf-8"></head>
  <body style="font-family:Arial,sans-serif;margin:0;padding:0;background:#f5f5f5">
    <div style="max-width:800px;margin:20px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.1)">

      <!-- Header -->
      <div style="background:linear-gradient(135deg,#c62828,#b71c1c);padding:24px;text-align:center">
        <h1 style="color:white;margin:0;font-size:22px">⚠️ ALERTA DE EXCESO DE VELOCIDAD</h1>
        <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px">
          ${speeding.length} vehiculo(s) superando los ${CONFIG.SPEED_LIMIT} km/h
        </p>
      </div>

      <!-- Timestamp -->
      <div style="padding:12px 24px;background:#fff3e0;border-bottom:1px solid #ffe0b2">
        <span style="color:#e65100;font-weight:bold">Fecha y hora:</span> ${now}
      </div>

      <!-- Table -->
      <div style="padding:16px">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#f5f5f5">
              <th style="padding:10px;text-align:left;font-size:13px;color:#666">VELOCIDAD</th>
              <th style="padding:10px;text-align:left;font-size:13px;color:#666">CONDUCTOR</th>
              <th style="padding:10px;text-align:left;font-size:13px;color:#666">VEHICULO</th>
              <th style="padding:10px;text-align:left;font-size:13px;color:#666">EMPRESA</th>
              <th style="padding:10px;text-align:left;font-size:13px;color:#666">AREA</th>
              <th style="padding:10px;text-align:left;font-size:13px;color:#666">UBICACION</th>
            </tr>
          </thead>
          <tbody>
            ${vehicleRows}
          </tbody>
        </table>
      </div>

      <!-- Footer -->
      <div style="padding:16px 24px;background:#f5f5f5;text-align:center;font-size:12px;color:#999">
        Sistema de Alertas - Control de Flota | Grupo Rapid<br>
        Limite configurado: ${CONFIG.SPEED_LIMIT} km/h | Cooldown: ${CONFIG.ALERT_COOLDOWN_MINUTES} min por vehiculo
      </div>
    </div>
  </body>
  </html>`;
}

/**
 * Envia el correo de alerta
 */
async function sendAlert(speeding) {
  const transporter = createMailTransport();

  const subject = `🚨 ALERTA VELOCIDAD: ${speeding.length} vehiculo(s) sobre ${CONFIG.SPEED_LIMIT} km/h`;

  const info = await transporter.sendMail({
    from: CONFIG.EMAIL_FROM,
    to: CONFIG.EMAIL_TO,
    subject: subject,
    html: buildAlertEmail(speeding)
  });

  console.log(`[EMAIL] Alerta enviada a ${CONFIG.EMAIL_TO} - ID: ${info.messageId}`);

  // Registrar en historial
  for (const item of speeding) {
    alertHistory[item.unitId] = Date.now();
  }
}

/**
 * Guarda log de alertas en archivo CSV
 */
function logAlert(speeding) {
  const logPath = path.join(__dirname, 'alertas-velocidad.csv');
  const exists = fs.existsSync(logPath);

  let lines = '';
  if (!exists) {
    lines = 'fecha,hora,velocidad_kmh,conductor,placa,empresa,modelo,area,ubicacion\n';
  }

  const now = new Date();
  const fecha = now.toLocaleDateString('es-PA');
  const hora = now.toLocaleTimeString('es-PA');

  for (const item of speeding) {
    const v = item.vehicleInfo;
    lines += [
      fecha,
      hora,
      item.speed,
      v ? v.conductor : 'Desconocido',
      v ? v.placa : 'N/A',
      v ? v.empresa : 'N/A',
      v ? `${v.modelo} ${v.ano}` : 'N/A',
      v ? v.area : 'N/A',
      `"${item.location || 'Sin ubicacion'}"`
    ].join(',') + '\n';
  }

  fs.appendFileSync(logPath, lines, 'utf8');
}

/**
 * Ciclo principal de monitoreo
 */
async function checkSpeed() {
  try {
    const units = await fetchGPSUnits();
    const now = new Date().toLocaleTimeString('es-PA');

    // Filtrar vehiculos que exceden el limite
    const speeding = [];
    for (const unit of units) {
      const speed = unit.speed || 0;
      if (speed > CONFIG.SPEED_LIMIT) {
        const unitId = unit.id || unit.unit_id || unit.label;

        // Verificar cooldown
        if (isInCooldown(unitId)) {
          console.log(`[SKIP] ${unit.label || unitId} a ${speed} km/h (alerta en cooldown)`);
          continue;
        }

        speeding.push({
          unitId,
          label: unit.label || unit.name || 'Unidad ' + unitId,
          speed,
          location: unit.address || unit.location || '',
          vehicleInfo: findVehicleInfo(unit)
        });
      }
    }

    const online = units.filter(u => u.state !== 'nodata').length;
    const driving = units.filter(u => u.state === 'driving' || (u.speed && u.speed > 0)).length;

    console.log(`[${now}] Unidades: ${units.length} total | ${online} online | ${driving} en movimiento | ${speeding.length} exceso velocidad`);

    if (speeding.length > 0) {
      for (const s of speeding) {
        const v = s.vehicleInfo;
        console.log(`  🚨 ${s.label} - ${s.speed} km/h - ${v ? v.conductor : 'Conductor desconocido'} (${v ? v.placa : 'N/A'})`);
      }

      // Guardar en log CSV
      logAlert(speeding);

      // Enviar correo
      await sendAlert(speeding);
    }

  } catch (error) {
    console.error(`[ERROR] ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════
// INICIO
// ═══════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════');
console.log('  SISTEMA DE ALERTAS DE VELOCIDAD - GRUPO RAPID');
console.log('═══════════════════════════════════════════════════');
console.log(`  Limite: ${CONFIG.SPEED_LIMIT} km/h`);
console.log(`  Destino: ${CONFIG.EMAIL_TO}`);
console.log(`  Intervalo: cada ${CONFIG.CHECK_INTERVAL / 1000} segundos`);
console.log(`  Cooldown: ${CONFIG.ALERT_COOLDOWN_MINUTES} min por vehiculo`);
console.log(`  Vehiculos en flota: ${flotaData.length}`);
console.log('═══════════════════════════════════════════════════');
console.log('  Iniciando monitoreo...\n');

// Primera verificacion inmediata
checkSpeed();

// Verificaciones periodicas
setInterval(checkSpeed, CONFIG.CHECK_INTERVAL);
