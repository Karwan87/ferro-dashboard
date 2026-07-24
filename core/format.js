/* Pomocnicze parsowanie polskich formatów liczb, np. "121,94 zł" -> 121.94 */
export function parseNum(v){
  if(v===undefined || v===null || v==='') return 0;
  const cleaned = String(v).replace(/[^\d,.-]/g,'').replace(/\s/g,'').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

export function parseIntSafe(v){
  const n = parseInt(String(v).replace(/[^\d-]/g,''), 10);
  return isNaN(n) ? 0 : n;
}

export function getCell(row, ...keys){
  for(const k of keys){ if(row[k]!==undefined) return row[k]; }
  return '';
}

/* Parsuje daty w typowych formatach zwracanych przez Sheets (FORMATTED_VALUE),
   np. "15.07.2026" (pl-PL) czy "2026-07-15". Współdzielone przez każdy moduł,
   który filtruje dane wg okresu (customers, returns, alerts). */
export function parseDate(dateStr){
  if(!dateStr) return null;
  const s = String(dateStr).trim();
  let m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if(m) return new Date(parseInt(m[3],10), parseInt(m[2],10)-1, parseInt(m[1],10));
  m = s.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
  if(m) return new Date(parseInt(m[1],10), parseInt(m[2],10)-1, parseInt(m[3],10));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function fmtPLN(n){
  return n.toLocaleString('pl-PL',{minimumFractionDigits:2, maximumFractionDigits:2}) + ' zł';
}

const IMG_BASE = 'https://assets.ferroboutique.pl/thumbs/1000xauto/';
export function imgUrl(path){ return path ? IMG_BASE + path.replace('/', '::') : null; }

export const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#E4DCC9"/><text x="50" y="56" font-family="Inter" font-size="11" fill="#8A8272" text-anchor="middle">brak zdjęcia</text></svg>`
);
