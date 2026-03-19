/**
 * PRUEBA DE ALERTA DE VELOCIDAD - Grupo Rapid
 *
 * Este script:
 * 1. Consulta la API de SkyData en tiempo real
 * 2. Muestra todos los vehiculos y sus velocidades
 * 3. Simula el envio de una alerta con datos reales (o simulados si no hay exceso)
 * 4. Intenta enviar el correo a Flota@gruporapid.com
 *
 * Uso: node prueba-alerta.js
 */

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// Configuracion
const SKYDATA_API = 'https://acceso.skydatalatam.com/api/v1/';
const SKYDATA_KEY = '45e4305ce0850c7a2a6182ff0f9edded49605029';
const SPEED_LIMIT = 100;
const EMAIL_TO = 'almacen2@gruporapid.com';

// ═══════════════════════════════════════════════════
// SMTP - MODIFICAR CON SUS DATOS PARA QUE ENVIE
// ═══════════════════════════════════════════════════
const SMTP_CONFIG = {
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'Flota@gruporapid.com',
    pass: 'Lb011417'
  }
};
const EMAIL_FROM = '"Control de Flota - Grupo Rapid" <Flota@gruporapid.com>';

// Cargar flota
let flotaData = [];
try {
  flotaData = JSON.parse(fs.readFileSync(path.join(__dirname, '_flota.json'), 'utf8'));
} catch (e) {}

function findVehicleInfo(unit) {
  if (!flotaData.length) return null;
  if (unit.vin) {
    const match = flotaData.find(v => v.chasis && v.chasis.trim().toLowerCase() === unit.vin.trim().toLowerCase());
    if (match) return match;
  }
  const label = (unit.label || unit.name || '').toUpperCase();
  for (const v of flotaData) {
    const placa = (v.placa || '').toUpperCase().replace(/[-\s]/g, '');
    if (placa && label.includes(placa)) return v;
  }
  return null;
}

function buildAlertEmail(speeding, isSimulated) {
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

  const simBanner = isSimulated ? `
    <div style="padding:10px 24px;background:#e3f2fd;border-bottom:1px solid #bbdefb;text-align:center">
      <span style="color:#1565c0;font-weight:bold">🧪 ESTO ES UNA PRUEBA SIMULADA - No es una alerta real</span>
    </div>` : '';

  return `
  <!DOCTYPE html>
  <html>
  <head><meta charset="utf-8"></head>
  <body style="font-family:Arial,sans-serif;margin:0;padding:0;background:#f5f5f5">
    <div style="max-width:800px;margin:20px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.1)">
      <div style="background:linear-gradient(135deg,#c62828,#b71c1c);padding:24px;text-align:center">
        <h1 style="color:white;margin:0;font-size:22px">⚠️ ALERTA DE EXCESO DE VELOCIDAD</h1>
        <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px">
          ${speeding.length} vehiculo(s) superando los ${SPEED_LIMIT} km/h
        </p>
      </div>
      ${simBanner}
      <div style="padding:12px 24px;background:#fff3e0;border-bottom:1px solid #ffe0b2">
        <span style="color:#e65100;font-weight:bold">Fecha y hora:</span> ${now}
      </div>
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
      <div style="padding:16px 24px;background:#f5f5f5;text-align:center;font-size:12px;color:#999">
        Sistema de Alertas - Control de Flota | Grupo Rapid<br>
        Limite configurado: ${SPEED_LIMIT} km/h
      </div>
    </div>
  </body>
  </html>`;
}

async function run() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  PRUEBA DE ALERTA DE VELOCIDAD - GRUPO RAPID');
  console.log('═══════════════════════════════════════════════════\n');

  // PASO 1: Consultar API SkyData
  console.log('[PASO 1] Consultando API de SkyData...');
  let units = [];
  try {
    const resp = await fetch(SKYDATA_API + 'unit/list.json?key=' + SKYDATA_KEY);
    const json = await resp.json();
    units = json.data?.units || json.units || [];
    console.log(`  ✅ Conexion exitosa - ${units.length} unidades GPS encontradas\n`);
  } catch (e) {
    console.log(`  ❌ Error de conexion: ${e.message}\n`);
    return;
  }

  // PASO 2: Mostrar estado de vehiculos
  console.log('[PASO 2] Estado actual de vehiculos:');
  console.log('─'.repeat(80));
  console.log('  UNIDAD'.padEnd(35) + 'ESTADO'.padEnd(12) + 'VELOCIDAD'.padEnd(12) + 'ALERTA');
  console.log('─'.repeat(80));

  const realSpeeding = [];

  for (const u of units) {
    const speed = u.speed || 0;
    const state = String(u.state || 'desconocido');
    const label = (u.label || u.name || 'Unidad ' + (u.id || '?')).substring(0, 30);
    const alert = speed > SPEED_LIMIT ? '🚨 EXCESO' : speed > 80 ? '⚠️  Elevada' : '';

    console.log(`  ${label.padEnd(33)} ${state.padEnd(12)} ${(speed + ' km/h').padEnd(12)} ${alert}`);

    if (speed > SPEED_LIMIT) {
      realSpeeding.push({
        unitId: u.id || u.unit_id || u.label,
        label: u.label || u.name,
        speed,
        location: u.address || u.location || '',
        vehicleInfo: findVehicleInfo(u)
      });
    }
  }
  console.log('─'.repeat(80));

  // PASO 3: Preparar alerta
  let speeding = [];
  let isSimulated = false;

  if (realSpeeding.length > 0) {
    console.log(`\n[PASO 3] 🚨 ${realSpeeding.length} vehiculo(s) en exceso de velocidad REAL\n`);
    speeding = realSpeeding;
  } else {
    console.log('\n[PASO 3] Ningun vehiculo supera los 100 km/h en este momento.');
    console.log('         Generando datos SIMULADOS para probar el correo...\n');
    isSimulated = true;

    // Tomar un vehiculo real de la flota para la simulacion
    const sampleVehicle = flotaData.find(v => v.status === 'Activo') || flotaData[0];
    speeding = [
      {
        unitId: 'SIM-001',
        label: sampleVehicle ? sampleVehicle.placa : 'PRUEBA-001',
        speed: 115,
        location: 'Autopista Panama-Colon, Km 45 (SIMULADO)',
        vehicleInfo: sampleVehicle || {
          conductor: 'Conductor de Prueba',
          placa: 'TEST001',
          empresa: 'Rapid frio',
          modelo: 'Vehiculo de Prueba',
          ano: '2025',
          tipo: 'Panel',
          area: 'Operaciones'
        }
      },
      {
        unitId: 'SIM-002',
        label: 'PRUEBA-002',
        speed: 125,
        location: 'Via Centenario, cerca de Arraijan (SIMULADO)',
        vehicleInfo: {
          conductor: 'Conductor Simulado',
          placa: 'SIM002',
          empresa: 'Rapid frio',
          modelo: 'Chevrolet N400',
          ano: '2023',
          tipo: 'Panel',
          area: 'Comercial'
        }
      }
    ];
  }

  // Mostrar lo que se enviaria
  for (const s of speeding) {
    const v = s.vehicleInfo;
    console.log(`  🚨 ${s.speed} km/h - ${v ? v.conductor : 'Desconocido'} (${v ? v.placa : 'N/A'}) - ${s.location}`);
  }

  // PASO 4: Generar HTML y guardar preview
  console.log('\n[PASO 4] Generando correo HTML...');
  const html = buildAlertEmail(speeding, isSimulated);

  const previewPath = path.join(__dirname, 'preview-alerta.html');
  fs.writeFileSync(previewPath, html, 'utf8');
  console.log(`  ✅ Preview guardado en: preview-alerta.html`);
  console.log(`     Abrelo en el navegador para ver como se ve el correo\n`);

  // PASO 5: Intentar enviar correo
  console.log('[PASO 5] Intentando enviar correo...');

  if (SMTP_CONFIG.auth.user === 'SU_CORREO@gmail.com') {
    console.log('  ⚠️  SMTP no configurado - No se puede enviar el correo');
    console.log('');
    console.log('  Para completar la prueba, edita este archivo y cambia:');
    console.log('    user: "SU_CORREO@gmail.com"    → tu correo real');
    console.log('    pass: "SU_CONTRASENA_DE_APP"    → tu contrasena de app Gmail');
    console.log('');
    console.log('  O revisa el archivo preview-alerta.html para ver el correo.\n');
  } else {
    try {
      const transporter = nodemailer.createTransport(SMTP_CONFIG);

      // Verificar conexion SMTP
      console.log('  Verificando conexion SMTP...');
      await transporter.verify();
      console.log('  ✅ Conexion SMTP exitosa');

      // Enviar
      const subject = isSimulated
        ? `🧪 PRUEBA - Alerta velocidad: ${speeding.length} vehiculo(s) sobre ${SPEED_LIMIT} km/h`
        : `🚨 ALERTA VELOCIDAD: ${speeding.length} vehiculo(s) sobre ${SPEED_LIMIT} km/h`;

      const info = await transporter.sendMail({
        from: EMAIL_FROM,
        to: EMAIL_TO,
        subject,
        html
      });

      console.log(`  ✅ CORREO ENVIADO EXITOSAMENTE`);
      console.log(`     Destinatario: ${EMAIL_TO}`);
      console.log(`     Message ID: ${info.messageId}`);
      console.log(`     Revisa la bandeja de entrada de Flota@gruporapid.com\n`);
    } catch (e) {
      console.log(`  ❌ Error al enviar: ${e.message}`);
      console.log('     Verifica las credenciales SMTP\n');
    }
  }

  console.log('═══════════════════════════════════════════════════');
  console.log('  PRUEBA COMPLETADA');
  console.log('═══════════════════════════════════════════════════');
}

run();
