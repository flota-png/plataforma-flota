/**
 * Script para ver que datos devuelve SkyData y cuales no se emparejan con _flota.json
 */
const fs = require('fs');
const path = require('path');

const API = 'https://acceso.skydatalatam.com/api/v1/unit/list.json?key=45e4305ce0850c7a2a6182ff0f9edded49605029';

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
  const num = (unit.number || '').replace(/^\d+-/, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (const v of flotaData) {
    const p = (v.placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (p && num && p.length >= 4 && num.length >= 4 && (p.includes(num) || num.includes(p))) return v;
  }
  return null;
}

async function run() {
  const resp = await fetch(API);
  const json = await resp.json();
  const units = json.data?.units || json.units || [];

  console.log(`Total unidades GPS: ${units.length}\n`);

  const matched = [];
  const unmatched = [];

  for (const u of units) {
    const info = findVehicleInfo(u);
    const data = {
      label: u.label || u.name || '?',
      number: u.number || '',
      vin: u.vin || '',
      speed: u.speed || 0,
      state: u.state?.name || u.state || ''
    };
    if (info) {
      matched.push({ ...data, placa: info.placa, conductor: info.conductor });
    } else {
      unmatched.push(data);
    }
  }

  console.log(`EMPAREJADOS: ${matched.length}`);
  console.log('─'.repeat(90));
  for (const m of matched) {
    console.log(`  GPS: ${m.label.padEnd(30)} number: ${m.number.padEnd(15)} → ${m.conductor} (${m.placa})`);
  }

  console.log(`\nNO EMPAREJADOS: ${unmatched.length}`);
  console.log('─'.repeat(90));
  for (const u of unmatched) {
    console.log(`  GPS: ${u.label.padEnd(30)} number: "${u.number.padEnd(15)}" vin: "${u.vin}"`);
  }
}

run().catch(e => console.error(e.message));
