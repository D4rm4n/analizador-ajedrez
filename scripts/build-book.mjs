// Genera public/book.json a partir del dataset abierto lichess-org/chess-openings (CC0)
import { Chess } from 'chess.js';
import fs from 'fs';
const key = (fen) => fen.split(' ').slice(0, 4).join(' ');
const names = {}; // epd -> "ECO|Nombre"
const book = new Set();
for (const l of ['a', 'b', 'c', 'd', 'e']) {
  const lines = fs.readFileSync(`data/${l}.tsv`, 'utf8').trim().split('\n').slice(1);
  for (const line of lines) {
    const [eco, name, pgn] = line.split('\t');
    const c = new Chess();
    const sans = pgn.replace(/\d+\.(\.\.)?/g, ' ').trim().split(/\s+/);
    for (const s of sans) { c.move(s); book.add(key(c.fen())); }
    const k = key(c.fen());
    if (!names[k] || names[k].length > (eco + '|' + name).length) names[k] = eco + '|' + name;
  }
}
const out = {};
for (const k of book) out[k] = names[k] || 0;
fs.writeFileSync('public/book.json', JSON.stringify(out));
console.log('posiciones de libro:', book.size, 'con nombre:', Object.keys(names).length);
