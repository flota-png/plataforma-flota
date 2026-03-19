/**
 * Sincronización Terpel → Plataforma Flota
 * Uso: node sync-terpel.js
 *
 * Resuelve CAPTCHA manualmente → el script hace todo lo demás
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const FUEL_FILE = path.join(__dirname, '_fuel.json');
const DOWNLOAD_DIR = path.join(__dirname, '_terpel_downloads');
const USERNAME = 'TCOACON04';
const PASSWORD = '3CqzxWltS-';
const COLS_PER_ROW = 17;

function getLastCompleteDate() {
  try {
    const data = JSON.parse(fs.readFileSync(FUEL_FILE, 'utf8'));
    if (!data.length) return '2025-01-01';
    // Encontrar la última fecha que tiene al menos 5 registros (día completo probable)
    // O si se pasa --from YYYY-MM-DD, usar esa fecha
    const fromArg = process.argv.find(a => a.startsWith('--from='));
    if (fromArg) {
      const d = new Date(fromArg.split('=')[1] + 'T12:00:00');
      d.setDate(d.getDate() - 1);
      return d.toISOString().split('T')[0];
    }
    const byDate = {};
    data.forEach(r => { if(r.fecha) byDate[r.fecha] = (byDate[r.fecha]||0)+1; });
    const dates = Object.keys(byDate).sort();
    // Buscar la última fecha con datos "suficientes" (al menos 5 registros)
    // o la fecha anterior a la primera fecha incompleta
    for (let i = dates.length - 1; i >= 0; i--) {
      if (byDate[dates[i]] >= 5) return dates[i];
    }
    return dates.length > 0 ? dates[0] : '2025-01-01';
  } catch { return '2025-01-01'; }
}
function nextDay(d) { const dt=new Date(d+'T12:00:00'); dt.setDate(dt.getDate()+1); return dt.toISOString().split('T')[0]; }
function todayStr() { return new Date().toISOString().split('T')[0]; }
function toPortalDate(ymd) { const [y,m,d]=ymd.split('-'); return `${m}/${d}/${y}`; }
function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }

function parseGridCells(cells) {
  const records = [];
  for (let i = COLS_PER_ROW; i + COLS_PER_ROW <= cells.length; i += COLS_PER_ROW) {
    const r = cells.slice(i, i + COLS_PER_ROW);
    let fecha = (r[0]||'').replace(/(\d{4}\/\d{2}\/\d{2})\1/,'$1').replace(/\//g,'-');
    let hora = (r[2]||'').replace(/(.+?)\s+\1/,'$1').trim();
    const litros = parseFloat(r[13])||0;
    const monto = parseFloat(r[15])||0;
    if (fecha && (litros > 0 || monto > 0)) {
      records.push({ fecha, hora, placa:(r[7]||'').trim(), depto:(r[8]||'').trim(),
        conductor:(r[9]||'').trim(), estacion:(r[10]||'').trim(), producto:(r[12]||'').trim(),
        litros, monto });
    }
  }
  return records;
}

function mergeAndSave(newRecords) {
  let existing = [];
  try { existing = JSON.parse(fs.readFileSync(FUEL_FILE, 'utf8')); } catch {}
  const s = new Set(existing.map(r=>`${r.fecha}|${r.hora}|${r.placa}|${r.litros}`));
  let added = 0;
  for (const rec of newRecords) {
    const k = `${rec.fecha}|${rec.hora}|${rec.placa}|${rec.litros}`;
    if (!s.has(k)) { existing.push(rec); s.add(k); added++; }
  }
  existing.sort((a,b)=>(a.fecha||'').localeCompare(b.fecha||'')||(a.hora||'').localeCompare(b.hora||''));
  fs.writeFileSync(FUEL_FILE, JSON.stringify(existing), 'utf8');
  console.log(`\n✓ ${newRecords.length} descargados, ${added} nuevos, ${existing.length} total en _fuel.json`);

  // Actualizar plataforma.html con los datos nuevos
  const htmlPath = path.join(__dirname, 'plataforma.html');
  try {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const newHtml = html.replace(
      /const combustible\s*=\s*\[.*?\];/s,
      'const combustible = ' + JSON.stringify(existing) + ';'
    );
    if (newHtml !== html) {
      fs.writeFileSync(htmlPath, newHtml, 'utf8');
      console.log('✓ plataforma.html actualizada');
    }
  } catch(e) {
    console.log('⚠ No se pudo actualizar plataforma.html:', e.message);
  }

  return added;
}

async function extractPage(page) {
  return page.evaluate((cols) => {
    const body = document.querySelector('#ContentPlaceHolder1_Grid1_ob_Grid1BodyContainer');
    if (!body) return [];
    const cells = [];
    // OboutGrid usa tabla interna con clases ob_gBC para celdas
    const table = body.querySelector('table.ob_gBody');
    if (table) {
      table.querySelectorAll('tr').forEach(row => {
        row.querySelectorAll('td').forEach(td => cells.push(td.textContent?.trim()||''));
      });
    }
    return cells;
  }, COLS_PER_ROW);
}

(async () => {
  const lastDate = getLastCompleteDate();
  const startDate = nextDay(lastDate);
  const endDate = todayStr();

  console.log('\n========================================');
  console.log('  SINCRONIZACIÓN TERPEL → FLOTA');
  console.log('========================================');
  console.log(`Último registro: ${lastDate}`);
  console.log(`Rango: ${startDate} → ${endDate}\n`);

  if (startDate > endDate) { console.log('✓ Datos actualizados.'); process.exit(0); }
  if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

  const browser = await puppeteer.launch({ headless:false, defaultViewport:{width:1280,height:900}, args:['--start-maximized'] });
  const page = await browser.newPage();
  const client = await page.createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior:'allow', downloadPath:DOWNLOAD_DIR });

  try {
    // ══ LOGIN ══
    await page.goto('https://portal.terpelpanama.com/NPW/Reportes', { waitUntil:'networkidle2', timeout:60000 });
    await sleep(2000);
    await page.evaluate((u,p) => {
      const a=document.getElementById('TextBox1'),b=document.getElementById('TextBox2');
      if(a){a.value=u;a.dispatchEvent(new Event('input',{bubbles:true}))}
      if(b){b.value=p;b.dispatchEvent(new Event('input',{bubbles:true}))}
    }, USERNAME, PASSWORD);

    console.log('Credenciales llenadas.');
    console.log('>>> RESUELVE EL CAPTCHA Y CLIC EN "Iniciar Sesión" <<<\n');

    let loggedIn = false;
    for (let i = 0; i < 60; i++) {
      await sleep(5000);
      try {
        const url = page.url();
        if (!url.includes('/login') && !url.includes('/Login')) { loggedIn=true; console.log(`✓ Login OK → ${url}`); break; }
      } catch { loggedIn=true; console.log('✓ Login OK'); await sleep(4000); break; }
      if (i>0 && i%12===0) console.log(`  Esperando login... (${i*5}s)`);
    }
    if (!loggedIn) { console.log('✗ Timeout login.'); await browser.close(); process.exit(1); }
    await sleep(3000);

    // ══ REPORTES ══
    console.log('Navegando a Reportes...');
    try { await page.evaluate(()=>{window.location.href='/NPW/Reportes'}); } catch {}
    await sleep(5000);
    try { await page.waitForSelector('#ContentPlaceHolder1_dates', {timeout:15000}); } catch {}
    await sleep(2000);

    // Configurar fecha
    const dateRange = `${toPortalDate(startDate)} - ${toPortalDate(endDate)}`;
    console.log(`Fechas: ${dateRange}`);
    await page.evaluate(dr => {
      const f=document.getElementById('ContentPlaceHolder1_dates');
      if(f){f.value=dr;f.dispatchEvent(new Event('change',{bubbles:true}))}
    }, dateRange);

    // Consultar
    console.log('Consultando...');
    try { await Promise.all([ page.waitForNavigation({waitUntil:'networkidle2',timeout:60000}).catch(()=>{}), page.click('#ContentPlaceHolder1_Btn_Transacciones') ]); } catch {}
    await sleep(5000);

    // Esperar datos
    let totalRecords = 0;
    for (let i = 0; i < 10; i++) {
      await sleep(2000);
      try {
        const info = await page.evaluate(() => {
          const f = document.querySelector('#ContentPlaceHolder1_Grid1_ob_Grid1FooterContainer');
          const m = f?.textContent?.match(/of\s+(\d+)/);
          return m ? parseInt(m[1]) : 0;
        });
        if (info > 0) { totalRecords = info; console.log(`✓ ${totalRecords} transacciones`); break; }
      } catch {}
    }

    if (totalRecords === 0) {
      console.log('✗ No hay transacciones.');
      await page.screenshot({path:path.join(DOWNLOAD_DIR,'no-data.png')});
      await browser.close(); process.exit(1);
    }

    // ══ EXTRAER TODAS LAS PÁGINAS ══
    const perPage = 10; // default page size
    const totalPages = Math.ceil(totalRecords / perPage);
    console.log(`Extrayendo ${totalPages} páginas...`);

    let allRecords = [];

    // Primero intentar cambiar a 100 registros por página
    console.log('Cambiando a 100 registros por página...');
    await page.evaluate(() => {
      const input = document.getElementById('ob_iDdlob_Grid1PageSizeSelectorTB');
      if (input) {
        input.value = '100';
        input.dispatchEvent(new Event('change', {bubbles:true}));
        const ev = new KeyboardEvent('keydown', {key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true});
        input.dispatchEvent(ev);
        const ev2 = new KeyboardEvent('keyup', {key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true});
        input.dispatchEvent(ev2);
        // También intentar blur para triggear el cambio
        input.blur();
      }
    });
    await sleep(5000);

    // Verificar si cambió el page size
    const newFooter = await page.evaluate(() => {
      const f = document.querySelector('#ContentPlaceHolder1_Grid1_ob_Grid1FooterContainer');
      return f?.textContent?.trim()?.substring(0,120) || '';
    });
    console.log(`Footer después de cambiar page size: ${newFooter}`);

    // Re-calcular páginas
    const newTotal = await page.evaluate(() => {
      const f = document.querySelector('#ContentPlaceHolder1_Grid1_ob_Grid1FooterContainer');
      const m = f?.textContent?.match(/of\s+(\d+)/);
      const mr = f?.textContent?.match(/(\d+)\s*-\s*(\d+)\s*of/);
      return { total: m?parseInt(m[1]):0, showing: mr?parseInt(mr[2]):0 };
    });

    const effectivePerPage = newTotal.showing || perPage;
    const actualPages = Math.ceil(newTotal.total / effectivePerPage);
    console.log(`Mostrando ${effectivePerPage} por página, ${actualPages} páginas`);

    for (let pg = 1; pg <= actualPages; pg++) {
      // Esperar más tiempo para que el grid se actualice completamente
      await sleep(3000);

      const cells = await extractPage(page);
      const records = parseGridCells(cells);
      console.log(`  Página ${pg}/${actualPages}: ${records.length} registros`);

      // Mostrar primera y última transacción de la página
      if (records.length > 0) {
        const first = records[0];
        const last = records[records.length-1];
        console.log(`    Desde: ${first.fecha} ${first.hora} ${first.placa}`);
        console.log(`    Hasta: ${last.fecha} ${last.hora} ${last.placa}`);
      }

      allRecords.push(...records);

      if (pg < actualPages) {
        // Ir a siguiente página - click en número de página directamente
        const nextNum = pg + 1;
        const clicked = await page.evaluate((num) => {
          const footer = document.querySelector('#ContentPlaceHolder1_Grid1_ob_Grid1FooterContainer');
          if (!footer) return false;

          // Buscar todos los elementos clickeables con el número
          const els = footer.querySelectorAll('a, span, div, td');
          for (const el of els) {
            if (el.textContent?.trim() === String(num) && el.children.length === 0) {
              el.click();
              return 'number:' + num;
            }
          }

          // Buscar botón siguiente (>)
          for (const el of els) {
            const t = el.textContent?.trim();
            if (t === '>' || t === '›' || t === '»') {
              el.click();
              return 'next';
            }
          }
          return false;
        }, nextNum);

        console.log(`    Navegación: ${clicked}`);

        // Esperar MUCHO más para que el grid se actualice
        await sleep(5000);

        // Verificar que la página cambió
        const pageCheck = await page.evaluate(() => {
          const f = document.querySelector('#ContentPlaceHolder1_Grid1_ob_Grid1FooterContainer');
          return f?.textContent?.match(/(\d+)\s*-\s*(\d+)\s*of/)?.[0] || '';
        });
        console.log(`    Grid: ${pageCheck}`);
      }
    }

    console.log(`\nTotal extraído: ${allRecords.length} de ${totalRecords}`);

    if (allRecords.length > 0) {
      mergeAndSave(allRecords);
    }

    await page.screenshot({path:path.join(DOWNLOAD_DIR,'final.png')});
    console.log('\nCerrando en 10s...');
    await sleep(10000);

  } catch(err) {
    console.error('\nError:', err.message);
    try { await page.screenshot({path:path.join(DOWNLOAD_DIR,'error.png')}); } catch {}
  } finally {
    await browser.close();
  }
})();
