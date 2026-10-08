// Prueba de extremo a extremo del Analizador de Partidas.
// Uso: URL=http://localhost:4173/ node tests/e2e.mjs   (SHOTS=carpeta para las capturas)
import { chromium } from 'playwright';
import { Chess } from 'chess.js';

const URL = process.env.URL || 'http://localhost:4173/';
const SAMPLE = process.env.SAMPLE || 'century';
const SHOTS = process.env.SHOTS || 'screenshots';
const SKIP_IMPORT = !!process.env.SKIP_IMPORT;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
// Lichess rechaza el user-agent "HeadlessChrome"; usamos el de un Chrome normal como el de un usuario real.
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const ok = (cond, msg) => { if (!cond) { console.error('FALLO:', msg); process.exitCode = 1; } else console.log('OK:', msg); };
const soundCount = () => page.evaluate(() => (window.__soundLog || []).filter((s) => !s.muted).length);
const lastSound = () => page.evaluate(() => (window.__soundLog || []).at(-1)?.kind);
const setRange = (sel, v) => page.$eval(sel, (el, v) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, v);
async function clickSquare(sq, orientation = 'white') {
  const box = await page.locator('cg-board').boundingBox();
  const f = sq.charCodeAt(0) - 97, r = +sq[1];
  const col = orientation === 'white' ? f : 7 - f;
  const row = orientation === 'white' ? 8 - r : r - 1;
  await page.mouse.click(box.x + (col + 0.5) * box.width / 8, box.y + (row + 0.5) * box.height / 8);
}

await page.goto(URL);
await page.waitForSelector('[data-testid=analyze]');

// ---- Sonido: silenciar/activar y persistencia ----
ok((await page.getAttribute('[data-testid=sound-toggle]', 'data-muted')) === '0', 'sonido activado por defecto');
await page.click('[data-testid=sound-toggle]');
ok((await page.getAttribute('[data-testid=sound-toggle]', 'data-muted')) === '1', 'botón silenciar funciona');
await setRange('[data-testid=volume]', 0.45);
// ---- Profundidad: persistencia ----
await setRange('[data-testid=depth-slider]', 18);
await page.reload();
await page.waitForSelector('[data-testid=analyze]');
ok((await page.getAttribute('[data-testid=sound-toggle]', 'data-muted')) === '1', 'silencio recordado tras recargar (localStorage)');
ok((await page.inputValue('[data-testid=volume]')) === '0.45', 'volumen recordado tras recargar');
ok((await page.innerText('[data-testid=depth-value]')) === '18', 'profundidad recordada tras recargar');
await page.click('[data-testid=mode-time]');
ok(await page.locator('[data-testid=time-1000]').count() === 1, 'modo "tiempo por jugada" disponible');
await page.click('[data-testid=mode-depth]');
await setRange('[data-testid=depth-slider]', 14);
await page.click('[data-testid=sound-toggle]'); // volver a activar
ok((await page.getAttribute('[data-testid=sound-toggle]', 'data-muted')) === '0', 'sonido reactivado');

if (!SKIP_IMPORT) {
  // ---- Mis gambitos ----
  await page.click('[data-testid=input-gambits]');
  ok((await page.inputValue('[data-testid=g-user-cc]')) === 'Chesster9212' && (await page.inputValue('[data-testid=g-user-li]')) === 'LorDarman', 'usuarios precargados en "Mis gambitos"');
  await page.click('[data-testid=g-load]');
  await page.waitForSelector('[data-testid=g-counts]', { timeout: 90000 });
  const gCounts = await page.innerText('[data-testid=g-counts]');
  console.log('Gambitos ←', gCounts);
  const m = /(\d+) partidas de chess.com · (\d+) de Lichess/.exec(gCounts);
  ok(m && +m[1] > 0 && +m[2] > 0, 'partidas descargadas de chess.com y de Lichess');
  const cards = await page.$$eval('[data-testid=g-card]', (els) => els.map((e) => e.innerText.replace(/\n/g, ' | ').slice(0, 260)));
  cards.forEach((c) => console.log('  ·', c));
  ok(await page.locator('[data-testid=g-card][data-key=kings]').count() === 1, 'tarjeta "Gambito de Rey" con partidas');
  await page.screenshot({ path: SHOTS + '/08-mis-gambitos.png' });
  // abrir una partida del Gambito de Rey en el analizador
  await page.locator('[data-testid=g-card][data-key=kings] [data-testid=g-toggle]').click();
  await page.locator('[data-testid=g-card][data-key=kings] [data-testid=g-game]').first().click();
  await page.waitForSelector('[data-testid=summary]', { timeout: 600000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid=progress]'), null, { timeout: 600000 });
  console.log('Gambito de Rey analizado →', (await page.innerText('[data-testid=acc-w]')).replace(/\n/g, ' '), '/', (await page.innerText('[data-testid=acc-b]')).replace(/\n/g, ' '));
  ok(true, 'partida de "Mis gambitos" abierta y analizada');
  await page.click('[data-testid=new-game]');
  await page.click('[data-testid=input-gambits]');
  await page.click('[data-testid=g-load]');
  await page.waitForSelector('[data-testid=g-counts]', { timeout: 90000 });
  const errTxt = await page.innerText('[data-testid=g-card][data-key=kings] [data-testid=g-err]');
  console.log('Primer error (Gambito de Rey):', errTxt);
  ok(/analizada/.test(errTxt), 'la partida analizada se guarda en caché y cuenta para el "primer error"');
  await page.click('[data-testid=input-review]');

  // ---- Importación chess.com ----
  await page.click('[data-testid=site-chesscom]');
  ok((await page.inputValue('[data-testid=import-user]')) === 'Chesster9212', 'usuario chess.com precargado');
  await page.click('[data-testid=import-search]');
  await page.waitForSelector('[data-testid=game-item]', { timeout: 30000 });
  const ccCount = await page.locator('[data-testid=game-item]').count();
  const ccFirst = await page.locator('[data-testid=game-item]').first().innerText();
  ok(ccCount > 0, `chess.com: ${ccCount} partidas listadas. Primera: ${ccFirst.replace(/\n/g, ' | ')}`);
  await page.locator('[data-testid=game-item]').first().click();
  await page.waitForSelector('[data-testid=move][data-class]:not([data-class=""])', { timeout: 60000 });
  ok(true, 'la partida importada de chess.com empieza a analizarse');
  await page.click('[data-testid=new-game]');

  // ---- Importación Lichess ----
  await page.click('[data-testid=site-lichess]');
  ok((await page.inputValue('[data-testid=import-user]')) === 'LorDarman', 'usuario Lichess precargado');
  await page.click('[data-testid=import-search]');
  await page.waitForSelector('[data-testid=game-item]', { timeout: 30000 });
  const liCount = await page.locator('[data-testid=game-item]').count();
  const liFirst = await page.locator('[data-testid=game-item]').first().innerText();
  ok(liCount > 0, `Lichess: ${liCount} partidas listadas. Primera: ${liFirst.replace(/\n/g, ' | ')}`);
  await page.screenshot({ path: SHOTS + '/04-importar-lichess.png' });
  await page.locator('[data-testid=game-item]').first().click();
  await page.waitForSelector('[data-testid=move][data-class]:not([data-class=""])', { timeout: 60000 });
  ok(true, 'la partida importada de Lichess empieza a analizarse');
  await page.click('[data-testid=new-game]');
}

// ---- Ejemplo ----
await page.click(`[data-testid=sample-${SAMPLE}]`);
const t0 = Date.now();
await page.click('[data-testid=analyze]');
await page.waitForSelector('[data-testid=progress]');
ok(true, 'barra de progreso visible');
await page.waitForSelector('[data-testid=summary]', { timeout: 600000 });
await page.waitForFunction(() => !document.querySelector('[data-testid=progress]'), null, { timeout: 600000 });
console.log(`Análisis completo en ${((Date.now() - t0) / 1000).toFixed(0)} s`);

await page.click('[data-testid=tab-moves]');
const classes = await page.$$eval('[data-testid=move]', (els) => els.map((e) => e.getAttribute('data-class')));
ok(classes.length > 0 && classes.every((c) => c), `todas las jugadas clasificadas (${classes.length})`);
const tally = classes.reduce((a, c) => ((a[c] = (a[c] || 0) + 1), a), {});
console.log('Recuento:', JSON.stringify(tally));

await page.click('[data-testid=tab-summary]');
console.log('Precisión:', (await page.innerText('[data-testid=acc-w]')).replace(/\n/g, ' '), '/', (await page.innerText('[data-testid=acc-b]')).replace(/\n/g, ' '));
const sacs = await page.$$eval('[data-testid=sac-item]', (els) => els.map((e) => e.textContent));
console.log('Sacrificios:', JSON.stringify(sacs));
await page.screenshot({ path: SHOTS + '/02-resumen-precision.png' });
await page.locator('[data-testid=sacrifices]').scrollIntoViewIfNeeded();
await page.screenshot({ path: SHOTS + '/03-resumen-sacrificios.png' });

// ---- Navegación + sonido + barra de evaluación ----
await page.click('[data-testid=tab-moves]');
const evalAt = async () => page.getAttribute('[data-testid=eval-bar]', 'data-white');
await page.click('[data-testid=nav-first]');
const e0 = await evalAt();
const s0 = await soundCount();
const target = (() => {
  for (const p of ['blunder', 'mistake', 'inaccuracy']) { const i = classes.findIndex((c, k) => c === p && k > 6 && k < classes.length - 4); if (i >= 0) return i + 1; }
  return Math.floor(classes.length / 2);
})();
for (let i = 0; i < target; i++) await page.keyboard.press('ArrowRight');
await page.waitForTimeout(700);
const e1 = await evalAt();
ok(e0 !== e1, `la barra de evaluación se actualiza (inicio ${e0}% → jugada ${target}: ${e1}%)`);
const s1 = await soundCount();
ok(s1 - s0 === target, `suena una pieza por cada jugada al avanzar (${s1 - s0} sonidos, último: ${await lastSound()})`);
await page.keyboard.press('ArrowLeft');
ok((await soundCount()) === s1, 'no suena al retroceder');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(800);
console.log('Tarjeta:', (await page.innerText('[data-testid=move-card]')).replace(/\n/g, ' | '));
await page.screenshot({ path: SHOTS + '/01-revision-medio-juego.png' });
await page.screenshot({ path: SHOTS + '/06-controles-profundidad-sonido.png' });

// ---- "¿Por qué es un error?" → análisis libre ----
await page.click('[data-testid=why-btn]');
await page.waitForSelector('[data-testid=free-panel]');
await page.waitForSelector('[data-testid=why-box]');
await page.waitForFunction(() => document.querySelectorAll('[data-testid=live-line]').length === 3, null, { timeout: 30000 });
await page.waitForFunction(() => /prof\. (1[2-9]|[2-9]\d)/.test(document.querySelector('[data-testid=live-depth]')?.textContent || ''), null, { timeout: 60000 });
const why = await page.innerText('[data-testid=why-box]');
console.log('Por qué:', why.replace(/\n/g, ' | '));
const lines = await page.$$eval('[data-testid=live-line]', (els) => els.map((e) => e.textContent));
console.log('Líneas:', JSON.stringify(lines));
console.log('Profundidad en vivo:', await page.innerText('[data-testid=live-depth]'));
ok(lines.length === 3, 'MultiPV 3: se muestran 3 líneas en vivo');
const arrowCount = await page.locator('cg-container svg line').count();
ok(arrowCount >= 2, `flechas del motor en el tablero (${arrowCount})`);
ok((await page.locator('[data-testid=tree-node]').count()) >= 10, 'árbol de variantes con la jugada, la refutación y la mejor línea');
await page.screenshot({ path: SHOTS + '/05-analisis-libre-por-que.png' });

// Volver a la posición previa (flecha roja de la jugada) y jugar una jugada propia
await page.click('[data-testid=nav-first]');
await page.waitForTimeout(300);
const fenBefore = await page.inputValue('[data-testid=fen-current]');
const legal = new Chess(fenBefore).moves({ verbose: true }).find((m) => m.piece === 'p' && !m.captured) || new Chess(fenBefore).moves({ verbose: true })[0];
const nodesBefore = await page.locator('[data-testid=tree-node]').count();
const sb = await soundCount();
await clickSquare(legal.from);
await clickSquare(legal.to);
await page.waitForTimeout(400);
const fenAfter = await page.inputValue('[data-testid=fen-current]');
ok(fenAfter !== fenBefore && (await page.locator('[data-testid=tree-node]').count()) === nodesBefore + 1, `mover una pieza con el ratón crea una variante (${legal.san})`);
ok((await soundCount()) === sb + 1, `suena al mover en análisis libre (${await lastSound()})`);
await page.waitForFunction(() => document.querySelectorAll('[data-testid=live-line]').length === 3, null, { timeout: 30000 });
ok(true, 'el motor analiza la nueva posición');
await page.click('[data-testid=fen-copy]');
await page.waitForTimeout(200);
console.log('Copiar FEN →', await page.locator('.fen-msg').innerText().catch(() => '(sin mensaje)'));

// Coronación con FEN pegado
await page.fill('[data-testid=fen-input]', '8/P7/8/8/8/8/k6K/8 w - - 0 1');
await page.click('[data-testid=fen-load]');
await page.waitForTimeout(300);
await clickSquare('a7');
await clickSquare('a8');
await page.waitForSelector('[data-testid=promo-dialog]');
ok(true, 'diálogo de coronación visible');
await page.click('[data-testid=promo-n]');
await page.waitForTimeout(300);
const promoFen = await page.inputValue('[data-testid=fen-current]');
ok(promoFen.startsWith('N7/'), `coronación a caballo aplicada (${promoFen})`);
// FEN inválido
await page.fill('[data-testid=fen-input]', 'esto no es un fen');
await page.click('[data-testid=fen-load]');
ok((await page.locator('.fen-msg').innerText()).includes('no válido'), 'FEN inválido rechazado');
ok((await lastSound()) === 'illegal', 'sonido de error para FEN inválido');

// Volver a la partida
await page.click('[data-testid=back-to-game]');
ok(await page.locator('[data-testid=move-list]').count() === 1, 'botón "Volver a la partida"');

// ---- Re-analizar con otra profundidad ----
await setRange('[data-testid=depth-slider]', 10);
await page.click('[data-testid=reanalyze]');
await page.waitForSelector('[data-testid=progress]');
await page.waitForFunction(() => !document.querySelector('[data-testid=progress]'), null, { timeout: 600000 });
await page.click('[data-testid=tab-summary]');
const note = await page.innerText('.engine-note');
ok(note.includes('profundidad 10'), `re-análisis a profundidad 10 (${note})`);
await setRange('[data-testid=depth-slider]', 14);

// clic en la lista y girar
await page.click('[data-testid=tab-moves]');
await page.locator('[data-testid=move]').nth(3).click();
await page.click('[data-testid=flip]');
ok(await page.locator('.cg-wrap.orientation-black').count() === 1, 'girar tablero');
await page.click('[data-testid=flip]');

// ---- Gambitos: sacrificios de peón, material y compensación (Partida inmortal) ----
await page.click('[data-testid=new-game]');
await page.click('[data-testid=sample-immortal]');
await page.click('[data-testid=analyze]');
await page.waitForSelector('[data-testid=summary]', { timeout: 600000 });
await page.waitForFunction(() => !document.querySelector('[data-testid=progress]'), null, { timeout: 600000 });
ok((await page.isChecked('[data-testid=pawn-sacs]')), 'opción "Incluir peones" activada por defecto');
const withPawns = await page.$$eval('[data-testid=sac-item]', (els) => els.map((e) => e.textContent));
console.log('Sacrificios (con peones):', JSON.stringify(withPawns));
ok(withPawns.some((t) => t.includes('peón') || t.includes('peones')), 'se detectan sacrificios de peón (gambito)');
ok(withPawns.every((t) => /ompensación/.test(t)), 'cada sacrificio indica si se mantuvo la compensación');
console.log('Material:', (await page.innerText('[data-testid=sac-col-w] .sac-stats')).replace(/\n/g, ' | '), '//', (await page.innerText('[data-testid=sac-col-b] .sac-stats')).replace(/\n/g, ' | '));
ok(await page.locator('[data-testid=material-graph]').count() === 1, 'gráfica de balance de material');
await page.locator('[data-testid=sacrifices]').scrollIntoViewIfNeeded();
await page.screenshot({ path: SHOTS + '/07-sacrificios-gambitos.png' });
await page.click('.toggle');
const noPawns = await page.locator('[data-testid=sac-item]').count();
ok(noPawns < withPawns.length, `al desactivar los peones quedan ${noPawns} de ${withPawns.length}`);
await page.click('.toggle');

ok(errors.length === 0, 'sin errores en consola' + (errors.length ? ': ' + errors.join(' / ') : ''));
await browser.close();
