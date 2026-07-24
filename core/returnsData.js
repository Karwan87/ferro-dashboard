import { parseNum, parseIntSafe, parseDate } from './format.js';
import { fetchCsvRaw, col } from './csv.js';
import { products } from './data.js';
import { DATA_BASE } from './config.js';

/* =========================================================
   ŹRÓDŁA DANYCH — te same pliki co moduł Klienci (data/zwroty.csv,
   data/ordery.csv), plus nowa zakładka "Zwroty - kontrola" z tego
   samego arkusza co "Zwroty", dla punktu 6 (zwroty do rozliczenia).
   ========================================================= */
const CSV_RETURNS = DATA_BASE + 'zwroty.csv';
const CSV_ORDERS  = DATA_BASE + 'ordery.csv';
const CSV_SETTLEMENT = DATA_BASE + 'zwroty_kontrola.csv';

// Zwroty: E produkt (ID), G cena, H ilość, T data zakupu (okres liczony wg tej daty,
// tak jak w module Klienci — spójnie z resztą aplikacji).
const RET = { productId: col('E'), price: col('G'), qty: col('H'), purchaseDate: col('T') };
// Ordery: A SKU (ID produktu), C cena, D data sprzedaży, F ilość
const ORD = { productId: col('A'), price: col('C'), saleDate: col('D'), qty: col('F') };
// Zwroty - kontrola: C zwrot środków do dnia, D wartość
const SETTLE = { dueDate: col('C'), value: col('D') };

/* Minimalna sprzedana ilość, żeby dostawca w ogóle wszedł do rankingu % zwrotów —
   bez tego dostawca z 1 sprzedaną i 1 zwróconą sztuką pokazywałby się jako 100%
   i zaśmiecał ranking najgorszych, mimo znikomej próby. */
const MIN_SOLD_FOR_RANKING = 5;

function matchesPeriod(dateStr, period){
  const d = parseDate(dateStr);
  if(!d) return false;
  if(period.type === 'year') return d.getFullYear() === period.year;
  if(period.type === 'month') return d.getFullYear() === period.year && d.getMonth() === period.month;
  const cutoff = new Date();
  cutoff.setHours(0,0,0,0);
  cutoff.setDate(cutoff.getDate() - period.days);
  return d >= cutoff;
}

let rawDataPromise = null;
function loadRawData(){
  if(!rawDataPromise){
    rawDataPromise = Promise.all([fetchCsvRaw(CSV_RETURNS), fetchCsvRaw(CSV_ORDERS)])
      .then(([returnRows, orderRows]) => ({ returnRows, orderRows }));
  }
  return rawDataPromise;
}

function productMap(){
  const m = {};
  products.forEach(p => { m[p.id] = p; });
  return m;
}

/* Ranking produktów wg liczby zwróconych sztuk w danym okresie — pomijamy
   zwroty produktów, których nie ma już w bieżącym katalogu (brak dopasowania). */
export async function getReturnedProducts(period){
  const { returnRows } = await loadRawData();
  const pMap = productMap();
  const byProduct = {};

  returnRows.forEach(row=>{
    if(!matchesPeriod(row[RET.purchaseDate], period)) return;
    const id = parseIntSafe(row[RET.productId]);
    if(!id) return;
    byProduct[id] = (byProduct[id] || 0) + parseIntSafe(row[RET.qty]);
  });

  return Object.entries(byProduct)
    .map(([id, returnedQty]) => ({ product: pMap[id], returnedQty }))
    .filter(r => r.product)
    .sort((a, b) => b.returnedQty - a.returnedQty)
    .slice(0, 50);
}

/* Ranking dostawców wg % zwrotów (zwrócone/sprzedane szt.) w danym okresie —
   dostawca produktu ustalany przez ID produktu -> core/data.js (pole "dostawca",
   pochodzące bezpośrednio z arkusza Panel). */
export async function getSuppliersRanking(period){
  const { returnRows, orderRows } = await loadRawData();
  const pMap = productMap();
  const byDostawca = {};

  function bucket(name){
    if(!byDostawca[name]) byDostawca[name] = { sold:0, returned:0 };
    return byDostawca[name];
  }

  orderRows.forEach(row=>{
    if(!matchesPeriod(row[ORD.saleDate], period)) return;
    const p = pMap[parseIntSafe(row[ORD.productId])];
    const name = p?.dostawca || 'Nieznany dostawca';
    bucket(name).sold += parseIntSafe(row[ORD.qty]);
  });

  returnRows.forEach(row=>{
    if(!matchesPeriod(row[RET.purchaseDate], period)) return;
    const p = pMap[parseIntSafe(row[RET.productId])];
    const name = p?.dostawca || 'Nieznany dostawca';
    bucket(name).returned += parseIntSafe(row[RET.qty]);
  });

  return Object.entries(byDostawca)
    .map(([name, v]) => ({ name, sold: v.sold, returned: v.returned, pct: v.sold > 0 ? (v.returned / v.sold * 100) : 0 }))
    .filter(d => d.sold >= MIN_SOLD_FOR_RANKING)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 50);
}

/* Pojedynczy wskaźnik dla całego sklepu w danym okresie: sprzedane vs zwrócone sztuki. */
export async function getStoreWideIndicator(period){
  const { returnRows, orderRows } = await loadRawData();
  let sold = 0, returned = 0;

  orderRows.forEach(row=>{ if(matchesPeriod(row[ORD.saleDate], period)) sold += parseIntSafe(row[ORD.qty]); });
  returnRows.forEach(row=>{ if(matchesPeriod(row[RET.purchaseDate], period)) returned += parseIntSafe(row[RET.qty]); });

  return { sold, returned, pct: sold > 0 ? (returned / sold * 100) : 0 };
}

/* Zwroty do rozliczenia — suma i lista pozycji z "Zwroty - kontrola", gdzie
   data zwrotu środków (kolumna C) wypada od dzisiaj włącznie w przyszłość. */
export async function getSettlement(){
  const rows = await fetchCsvRaw(CSV_SETTLEMENT);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const items = rows
    .map(row => ({ date: parseDate(row[SETTLE.dueDate]), rawDate: row[SETTLE.dueDate], value: parseNum(row[SETTLE.value]) }))
    .filter(item => item.date && item.date >= today)
    .sort((a, b) => a.date - b.date);

  const total = items.reduce((sum, item) => sum + item.value, 0);
  return { total, items };
}
