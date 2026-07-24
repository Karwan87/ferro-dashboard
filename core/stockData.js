import { parseNum, parseIntSafe, getCell } from './format.js';
import { fetchCsv } from './csv.js';
import { DATA_BASE } from './config.js';

/* Zakładka "DB" (ta sama co dla zdjęć) — nadpisywana na bieżąco, więc daje
   TYLKO stan "teraz". Historia (getStockForDate/getStockSeries) czytana
   jest z data/stock_history.csv, dopisywanego raz na dobę przez osobny
   workflow (.github/workflows/stock-history.yml), bo "DB" sama w sobie
   nie ma archiwum. */
const CSV_DB = DATA_BASE + 'zdjecia.csv';
const CSV_HISTORY = DATA_BASE + 'stock_history.csv';

const cache = {};
function cached(key, loader){
  if(!cache[key]) cache[key] = loader();
  return cache[key];
}
const loadDbRaw = () => cached('db', () => fetchCsv(CSV_DB));
// Plik historii może jeszcze nie istnieć (zanim pierwszy raz zadziała
// codzienny/jednorazowy import) — traktujemy to jako pustą historię,
// a nie błąd całego modułu.
const loadHistoryRaw = () => cached('history', async () => {
  try{ return await fetchCsv(CSV_HISTORY); }
  catch(e){ return []; }
});

function dbRowToProduct(row){
  const id = parseIntSafe(getCell(row, 'Id'));
  if(!id) return null;
  return {
    id,
    name: getCell(row, 'Nazwa') || ('Produkt #' + id),
    img: getCell(row, 'Zdjęcie', 'Zdjecie') || null,
    ilosc: parseIntSafe(getCell(row, 'Ilość', 'Ilosc')),
    cena: parseNum(getCell(row, 'Cena')),
    cenaZakupu: parseNum(getCell(row, 'Cenazakupu')),
  };
}

/* Żywe statystyki (punkty 1-2): wartość po cenie zakupu, po aktualnej
   cenie sprzedaży i suma sztuk — liczone bezpośrednio z "DB", bez potrzeby
   historii. */
// "Cena" w DB to cena brutto (z VAT) pokazywana klientowi — do wartości
// magazynu liczymy netto, więc dzielimy przez stawkę VAT 23%.
const VAT_RATE = 1.23;

export async function getLiveStockSummary(){
  const rows = await loadDbRaw();
  const products = rows.map(dbRowToProduct).filter(Boolean);
  let ilosc = 0, wartoscZakup = 0, wartoscSprzedaz = 0;
  products.forEach(p=>{
    ilosc += p.ilosc;
    wartoscZakup += p.ilosc * p.cenaZakupu;
    wartoscSprzedaz += p.ilosc * (p.cena / VAT_RATE);
  });
  return { ilosc, wartoscZakup, wartoscSprzedaz };
}

export async function getProductMetaMap(){
  const rows = await loadDbRaw();
  const map = new Map();
  rows.forEach(row=>{
    const id = parseIntSafe(getCell(row, 'Id'));
    if(!id) return;
    map.set(id, { name: getCell(row, 'Nazwa') || ('Produkt #' + id), img: getCell(row, 'Zdjęcie', 'Zdjecie') || null });
  });
  return map;
}

function historyRowParsed(row){
  const wartoscSprzedazRaw = getCell(row, 'WartoscSprzedaz');
  return {
    date: getCell(row, 'Data'),
    id: parseIntSafe(getCell(row, 'Id')),
    ilosc: parseIntSafe(getCell(row, 'Ilosc')),
    wartoscZakup: parseNum(getCell(row, 'WartoscZakup')),
    // Puste dla wpisów z jednorazowego archiwum (tam nie było ceny sprzedaży).
    wartoscSprzedaz: wartoscSprzedazRaw === '' ? null : parseNum(wartoscSprzedazRaw),
  };
}

export async function getAvailableHistoryDates(){
  const rows = await loadHistoryRaw();
  const dates = [...new Set(rows.map(r => getCell(r, 'Data')).filter(Boolean))];
  return dates.sort(); // ISO 'YYYY-MM-DD' sortuje się poprawnie jako tekst
}

/* Punkt 3: lista produktów+ilości dla wskazanej (przeszłej) daty. Stare
   archiwum ma nieregularne odstępy (co kilka-kilkanaście dni), więc gdy nie
   ma dokładnie takiej daty, spadamy do najbliższej wcześniejszej dostępnej
   zamiast pokazywać pusty ekran. */
export async function getStockForDate(dateIso){
  const dates = await getAvailableHistoryDates();
  if(dates.length === 0) return null;
  const targetDate = dates.includes(dateIso) ? dateIso : [...dates].reverse().find(d => d < dateIso);
  if(!targetDate) return null;

  const rows = await loadHistoryRaw();
  const matched = rows.filter(r => getCell(r, 'Data') === targetDate).map(historyRowParsed);
  return { date: targetDate, requestedDate: dateIso, exact: targetDate === dateIso, rows: matched };
}

/* Punkt 4: dzienne sumy (ilość, wartość zakup/sprzedaż) z ostatnich `days`
   dni — do wykresu. wartoscSprzedaz zostaje `null` dla dni, w których żaden
   wiersz jej nie miał (dane z archiwum sprzed automatyzacji). */
export async function getStockSeries(days){
  const rows = await loadHistoryRaw();
  const parsed = rows.map(historyRowParsed);

  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffIso = cutoff.getFullYear() + '-' + String(cutoff.getMonth()+1).padStart(2,'0') + '-' + String(cutoff.getDate()).padStart(2,'0');

  const byDate = new Map();
  parsed.forEach(r=>{
    if(!r.date || r.date < cutoffIso) return;
    if(!byDate.has(r.date)) byDate.set(r.date, { ilosc: 0, wartoscZakup: 0, wartoscSprzedaz: 0, hasSprzedaz: false });
    const acc = byDate.get(r.date);
    acc.ilosc += r.ilosc;
    acc.wartoscZakup += r.wartoscZakup;
    if(r.wartoscSprzedaz != null){ acc.wartoscSprzedaz += r.wartoscSprzedaz; acc.hasSprzedaz = true; }
  });

  return [...byDate.entries()]
    .sort((a, b) => a[0] < b[0] ? -1 : 1)
    .map(([date, v]) => ({
      date,
      ilosc: v.ilosc,
      wartoscZakup: v.wartoscZakup,
      wartoscSprzedaz: v.hasSprzedaz ? v.wartoscSprzedaz : null,
    }));
}
