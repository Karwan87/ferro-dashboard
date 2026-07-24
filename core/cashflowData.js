import { parseNum, parseIntSafe, parseDate } from './format.js';
import { fetchCsvRaw, fetchCsvRawAll, col } from './csv.js';
import { DATA_BASE } from './config.js';

const CSV_PROMOTIONS = DATA_BASE + 'promocje.csv';
const CSV_MARKETING = DATA_BASE + 'marketing.csv';
const CSV_FV_TERMIN = DATA_BASE + 'fv_termin.csv';
const CSV_NBP_EUR = DATA_BASE + 'nbp_eur.csv';
const CSV_ORDERS = DATA_BASE + 'ordery.csv';
const CSV_SETTLEMENT = DATA_BASE + 'zwroty_kontrola.csv';

// Promocje (Arkusz1): A data, G wielkość promocji (%) — może zawierać też
// dopiski tekstowe (NK, SALE, DROP...) do pominięcia, chyba że to "NK".
const PROMO = { date: col('A'), info: col('G') };
// Ordery: C cena, D data sprzedaży, F ilość, G nr zamówienia (jak w innych modułach).
const ORD = { price: col('C'), saleDate: col('D'), qty: col('F'), orderNo: col('G') };
// Zwroty - kontrola: C zwrot środków do dnia, D wartość do zwrotu — jedyne
// źródło "wypływu gotówki na zwroty" w Cash-Flow, dla obu paneli (miniony:
// co faktycznie trzeba było wypłacić; prognoza: co jeszcze będzie trzeba).
const SETTLE = { dueDate: col('C'), value: col('D') };
// FV termin: A termin płatności (jeśli puste -> C data wystawienia), B kwota (PLN/EUR), L ŚO/k.u.p.
const FV = { dueDate: col('A'), amount: col('B'), issueDate: col('C'), split: col('L') };

const MONTHS_PL = ['STYCZEŃ','LUTY','MARZEC','KWIECIEŃ','MAJ','CZERWIEC','LIPIEC','SIERPIEŃ','WRZESIEŃ','PAŹDZIERNIK','LISTOPAD','GRUDZIEŃ'];

function isoDateKey(d){
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function daysInMonth(year, monthIndex){
  return new Date(year, monthIndex+1, 0).getDate();
}

/* --- ładowanie i cache surowych danych (raz na sesję) --- */
const cache = {};
function cached(key, loader){
  if(!cache[key]) cache[key] = loader();
  return cache[key];
}
const loadPromotionsRaw = () => cached('promo', () => fetchCsvRaw(CSV_PROMOTIONS));
const loadMarketingRaw = () => cached('marketing', () => fetchCsvRawAll(CSV_MARKETING));
const loadFvTerminRaw = () => cached('fv', () => fetchCsvRaw(CSV_FV_TERMIN));
const loadOrdersRaw = () => cached('orders', () => fetchCsvRaw(CSV_ORDERS));
const loadSettlementRaw = () => cached('settlement', () => fetchCsvRaw(CSV_SETTLEMENT));
const loadNbpRates = () => cached('nbp', async () => {
  const rows = await fetchCsvRaw(CSV_NBP_EUR); // A=Data, B=KursEUR (nagłówek pomijany jak zwykle)
  const map = new Map();
  rows.forEach(r => { if(r[0]) map.set(r[0], parseFloat(String(r[1]).replace(',', '.'))); });
  return map;
});

/* --- promocje/NK: Map<'YYYY-MM-DD', {pct:number|null, isNK:boolean}> --- */
function parsePromoCell(text){
  if(!text) return { pct: null, isNK: false };
  const s = String(text).trim();
  const isNK = /\bNK\b/i.test(s);
  let pct = null;
  const withPercent = s.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if(withPercent){
    pct = parseFloat(withPercent[1].replace(',', '.'));
  } else {
    const asFraction = s.match(/^0?[.,](\d+)\b/);
    if(asFraction) pct = parseFloat('0.' + asFraction[1]) * 100;
  }
  return { pct, isNK };
}

async function loadPromotionsMap(){
  return cached('promoMap', async () => {
    const rows = await loadPromotionsRaw();
    const map = new Map();
    rows.forEach(row => {
      const d = parseDate(row[PROMO.date]);
      if(!d) return;
      const info = parsePromoCell(row[PROMO.info]);
      if(info.pct != null || info.isNK) map.set(isoDateKey(d), info);
    });
    return map;
  });
}

/* --- marketing: dzienna średnia dla danego dnia, z fallbackiem na ostatnią
   wypełnioną kolumnę i dzieleniem przez liczbę dni BIEŻĄCEGO (analizowanego)
   miesiąca — zgodnie z ustaloną regułą. Zwraca też źródło stawki (z którego
   miesiąca faktycznie wzięto kwotę), żeby dało się zweryfikować w UI, gdy
   coś "nie zgadza się" z arkuszem. --- */
async function getMarketingDailyRate(date){
  const rows = await loadMarketingRaw();
  const header = rows[0] || [];
  // Szukamy wiersza po etykiecie "MARKETING" w kolumnie A, a nie po sztywnym
  // numerze wiersza — puste wiersze-separatory w arkuszu są pomijane przez
  // parser (skipEmptyLines), więc numer wiersza po sparsowaniu CSV nie
  // odpowiada numerowi wiersza w arkuszu.
  const marketingRow = rows.find(r => String(r[0]).trim().toUpperCase() === 'MARKETING') || [];
  const targetLabel = MONTHS_PL[date.getMonth()] + ' ' + date.getFullYear();

  let colIdx = header.findIndex(h => String(h).trim().toUpperCase() === targetLabel);
  if(colIdx === -1) colIdx = header.length - 1;
  while(colIdx > 0 && !parseNum(marketingRow[colIdx])) colIdx--;

  const sourceLabel = String(header[colIdx] || '').trim() || targetLabel;
  const monthlyTotal = parseNum(marketingRow[colIdx]);
  const days = daysInMonth(date.getFullYear(), date.getMonth());
  return { dailyRate: monthlyTotal / days, targetLabel, sourceLabel, monthlyTotal, days };
}

/* --- FV: wykrycie waluty po symbolu w tekście i przeliczenie po kursie NBP
   najbliższym (wstecz) danej dacie — tabela A NBP nie publikuje w weekendy/święta. --- */
function detectCurrency(raw){
  return /€|eur/i.test(String(raw)) ? 'EUR' : 'PLN';
}

function nbpRateNear(nbpMap, date){
  const d = new Date(date);
  for(let i=0; i<10; i++){
    const key = isoDateKey(d);
    if(nbpMap.has(key)) return nbpMap.get(key);
    d.setDate(d.getDate() - 1);
  }
  return null;
}

/* --- wyliczenia dla wskazanego zakresu dat (inclusive) --- */
async function computePlannedRevenue(start, end, overrides){
  const promos = await loadPromotionsMap();
  let total = 0;
  const promoEvents = [];

  for(const d = new Date(start); d <= end; d.setDate(d.getDate()+1)){
    const key = isoDateKey(d);
    const info = promos.get(key);
    let rate;
    if(info?.isNK){
      rate = (overrides.nk !== null && overrides.nk !== undefined && overrides.nk !== '') ? Number(overrides.nk) : overrides.none;
      promoEvents.push({ date: key, label: 'NK' + (info.pct != null ? ` (${info.pct}%)` : '') });
    } else if(info?.pct != null){
      rate = info.pct <= 15 ? overrides.low : overrides.high;
      promoEvents.push({ date: key, label: info.pct + '%' });
    } else {
      rate = overrides.none;
    }
    total += rate;
  }
  return { total, promoEvents };
}

async function computeRealRevenue(start, end){
  const rows = await loadOrdersRaw();
  let total = 0;
  const orders = new Set();
  rows.forEach(row => {
    const d = parseDate(row[ORD.saleDate]);
    if(!d || d < start || d > end) return;
    total += parseNum(row[ORD.price]) * parseIntSafe(row[ORD.qty]);
    orders.add(row[ORD.orderNo]);
  });
  return { total, ordersCount: orders.size };
}

async function computeMarketingCost(start, end){
  let total = 0;
  const breakdown = new Map(); // targetLabel -> {sourceLabel, dailyRate, monthlyTotal, days}
  for(const d = new Date(start); d <= end; d.setDate(d.getDate()+1)){
    const info = await getMarketingDailyRate(new Date(d));
    total += info.dailyRate;
    if(!breakdown.has(info.targetLabel)) breakdown.set(info.targetLabel, info);
  }
  return { total, breakdown: [...breakdown.values()] };
}

async function computeInvoicesDue(start, end){
  const rows = await loadFvTerminRaw();
  const nbpMap = await loadNbpRates();
  let total = 0, kup = 0, workingCapital = 0;

  rows.forEach(row => {
    let due = parseDate(row[FV.dueDate]);
    if(!due) due = parseDate(row[FV.issueDate]);
    if(!due || due < start || due > end) return;

    const raw = row[FV.amount];
    const value = parseNum(raw);
    const currency = detectCurrency(raw);
    const amountPLN = currency === 'EUR' ? value * (nbpRateNear(nbpMap, due) || 1) : value;

    total += amountPLN;
    // Wiersze bez treści w kolumnach za prawo od L (bo API Sheets ucina
    // końcowe puste komórki) mają row[FV.split] === undefined — String(undefined)
    // dałoby "undefined" (prawdziwe po trim!), więc trzeba sprawdzić najpierw
    // istnienie wartości, inaczej każdy taki wiersz KUP trafiał błędnie do ŚO.
    if(row[FV.split] && String(row[FV.split]).trim()) workingCapital += amountPLN;
    else kup += amountPLN;
  });

  return { total, kup, workingCapital };
}

async function computeReturnsOutflow(start, end){
  const rows = await loadSettlementRaw();
  let total = 0;
  rows.forEach(row => {
    const d = parseDate(row[SETTLE.dueDate]);
    if(!d || d < start || d > end) return;
    total += parseNum(row[SETTLE.value]);
  });
  return total;
}

/* Komplet statystyk dla jednego zakresu dat — wywołujący (UI) sam liczy
   bilans (przychód - koszty marketingu - faktury FV - wypłaty za zwroty),
   bo dla "minionego" robi to raz z realRevenue, a dla "prognozy" raz
   z plannedRevenue, korzystając z tych samych pól kosztowych. */
export async function getCashflowStats(start, end, overrides){
  const [planned, real, marketing, invoices, returnsOutflow] = await Promise.all([
    computePlannedRevenue(start, end, overrides),
    computeRealRevenue(start, end),
    computeMarketingCost(start, end),
    computeInvoicesDue(start, end),
    computeReturnsOutflow(start, end),
  ]);

  return {
    plannedRevenue: planned.total,
    promoEvents: planned.promoEvents,
    realRevenue: real.total,
    ordersCount: real.ordersCount,
    avgBasket: real.ordersCount > 0 ? real.total / real.ordersCount : 0,
    marketingCost: marketing.total,
    marketingBreakdown: marketing.breakdown,
    invoicesDue: invoices.total,
    invoicesKup: invoices.kup,
    invoicesWorkingCapital: invoices.workingCapital,
    returnsOutflow,
  };
}
