// Prueba de extremo a extremo: carga la página, analiza el ejemplo, comprueba clasificaciones y barra de evaluación,
// prueba la importación desde chess.com y Lichess y toma capturas de pantalla.
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:4173/';
const SAMPLE = process.env.SAMPLE || 'century';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
// Lichess rechaza el user-agent "HeadlessChrome"; usamos el de un Chrome normal como el de un usuario real.
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const ok = (cond, msg) => { if (!cond) { console.error('FALLO:', msg); process.exitCode = 1; } else console.log('OK:', msg); };

await page.goto(URL);
await page.waitForSelector('[data-testid=analyze]');

// ---- Importación chess.com ----
await page.click('[data-testid=site-chesscom]');
ok((await page.inputValue('[data-testid=import-user]')) === 'Chesster9212', 'usuario chess.com precargado');
await page.click('[data-testid=import-search]');
await page.waitForSelector('[data-testid=game-item]', { timeout: 30000 });
const ccCount = await page.locator('[data-testid=game-item]').count();
const ccFirst = await page.locator('[data-testid=game-item]').first().innerText();
ok(ccCount > 0, `chess.com: ${ccCount} partidas listadas. Primera: ${ccFirst.replace(/\n/g, ' | ')}`);

// Analizar la partida más reciente de chess.com hasta el final
await page.locator('[data-testid=game-item]').first().click();
await page.waitForSelector('[data-testid=summary]', { timeout: 600000 });
await page.waitForFunction(() => !document.querySelector('[data-testid=progress]'), null, { timeout: 600000 });
console.log('chess.com analizada →', (await page.innerText('[data-testid=acc-w]')).replace(/\n/g, ' '), '/', (await page.innerText('[data-testid=acc-b]')).replace(/\n/g, ' '));
ok(true, 'partida importada de chess.com analizada por completo');
await page.click('[data-testid=new-game]');

// ---- Importación Lichess ----
await page.click('[data-testid=site-lichess]');
ok((await page.inputValue('[data-testid=import-user]')) === 'LorDarman', 'usuario Lichess precargado');
await page.click('[data-testid=import-search]');
await page.waitForSelector('[data-testid=game-item]', { timeout: 30000 });
const liCount = await page.locator('[data-testid=game-item]').count();
const liFirst = await page.locator('[data-testid=game-item]').first().innerText();
ok(liCount > 0, `Lichess: ${liCount} partidas listadas. Primera: ${liFirst.replace(/\n/g, ' | ')}`);
await page.screenshot({ path: (process.env.SHOTS || 'screenshots') + '/04-importar-lichess.png' });

// Analizar una partida importada de Lichess (solo verificar que arranca y clasifica)
await page.locator('[data-testid=game-item]').first().click();
await page.waitForSelector('[data-testid=move][data-class]:not([data-class=""])', { timeout: 60000 });
ok(true, 'la partida importada de Lichess empieza a analizarse');

// ---- Ejemplo ----
await page.click('[data-testid=new-game]');
await page.click(`[data-testid=sample-${SAMPLE}]`);
const t0 = Date.now();
await page.click('[data-testid=analyze]');
await page.waitForSelector('[data-testid=progress]');
ok(true, 'barra de progreso visible');
await page.waitForSelector('[data-testid=summary]', { timeout: 600000 });
const secs = ((Date.now() - t0) / 1000).toFixed(0);
await page.waitForFunction(() => !document.querySelector('[data-testid=progress]'), null, { timeout: 600000 });
console.log(`Análisis completo en ${secs} s`);

await page.click('[data-testid=tab-moves]');
const classes = await page.$$eval('[data-testid=move]', (els) => els.map((e) => e.getAttribute('data-class')));
const sans = await page.$$eval('[data-testid=move]', (els) => els.map((e) => e.textContent));
ok(classes.every((c) => c), `todas las jugadas clasificadas (${classes.length})`);
const tally = classes.reduce((a, c) => ((a[c] = (a[c] || 0) + 1), a), {});
console.log('Recuento:', JSON.stringify(tally));
console.log(sans.map((s, i) => `${i + 1}:${s}[${classes[i]}]`).join(' '));
// Screenshot del resumen
await page.click('[data-testid=tab-summary]');
const accW = await page.innerText('[data-testid=acc-w]');
const accB = await page.innerText('[data-testid=acc-b]');
console.log('Precisión:', accW.replace(/\n/g, ' '), '/', accB.replace(/\n/g, ' '));
const sacs = await page.$$eval('[data-testid=sac-item]', (els) => els.map((e) => e.textContent));
console.log('Sacrificios:', JSON.stringify(sacs));
await page.screenshot({ path: (process.env.SHOTS || 'screenshots') + '/02-resumen-precision.png' });
await page.locator('[data-testid=sacrifices]').scrollIntoViewIfNeeded();
await page.screenshot({ path: (process.env.SHOTS || 'screenshots') + '/03-resumen-sacrificios.png' });

// Barra de evaluación cambia al navegar
await page.click('[data-testid=tab-moves]');
const evalAt = async () => page.getAttribute('[data-testid=eval-bar]', 'data-white');
await page.click('[data-testid=nav-first]');
const e0 = await evalAt();
// Buscar una jugada intermedia que no sea la mejor (para mostrar flecha) — preferir la brillante / error
const target = process.env.PLY ? parseInt(process.env.PLY, 10) : (() => {
  const prefs = ['blunder', 'mistake', 'inaccuracy', 'brilliant', 'great'];
  for (const p of prefs) { const i = classes.findIndex((c, k) => c === p && k > 6 && k < classes.length - 4); if (i >= 0) return i + 1; }
  return Math.floor(classes.length / 2);
})();
for (let i = 0; i < target; i++) await page.keyboard.press('ArrowRight');
await page.waitForTimeout(700);
const e1 = await evalAt();
ok(e0 !== e1, `la barra de evaluación se actualiza (inicio ${e0}% → jugada ${target}: ${e1}%)`);
const card = await page.innerText('[data-testid=move-card]');
console.log('Tarjeta:', card.replace(/\n/g, ' | '));
const arrows = await page.locator('cg-container svg line').count();
console.log('Flechas en el tablero:', arrows);
await page.screenshot({ path: (process.env.SHOTS || 'screenshots') + '/01-revision-medio-juego.png' });

// clic en la gráfica y en la lista
await page.locator('[data-testid=move]').nth(3).click();
ok((await page.innerText('[data-testid=move-card]')).length > 0, 'clic en jugada de la lista');
await page.click('[data-testid=flip]');
ok(await page.locator('.cg-wrap.orientation-black').count() === 1, 'girar tablero');
await page.click('[data-testid=flip]');

ok(errors.length === 0, 'sin errores en consola' + (errors.length ? ': ' + errors.join(' / ') : ''));
await browser.close();
