import { parseNum, parseIntSafe, parseDate } from './format.js';
import { fetchCsvRaw, col } from './csv.js';
import { DATA_BASE } from './config.js';

/* =========================================================
   ŹRÓDŁA DANYCH — trzy arkusze bez nazwanych nagłówków (kolumny
   adresowane literą, jak w specyfikacji), aktualizowane przez
   workflow GitHub Actions razem z danymi produktowymi.
   ========================================================= */
const CSV_RETURNS         = DATA_BASE + 'zwroty.csv';            // arkusz "Zwroty"
const CSV_ORDERS          = DATA_BASE + 'ordery.csv';             // arkusz "Ordery"
const CSV_ORDER_CUSTOMERS = DATA_BASE + 'zamowienia_klienci.csv'; // arkusz "Dane zamówień"

// Zwroty: A nr zamówienia, C imię i nazwisko, G cena, H ilość, Q data zwrotu, T data zakupu, V utracona marża
const RET = { orderNo: col('A'), name: col('C'), price: col('G'), qty: col('H'), returnDate: col('Q'), purchaseDate: col('T'), lostMargin: col('V') };
// Ordery: C cena, D data sprzedaży, F ilość, G nr zamówienia, M uzyskana marża
const ORD = { price: col('C'), saleDate: col('D'), qty: col('F'), orderNo: col('G'), margin: col('M') };
// Dane zamówień: A nr zamówienia, C imię i nazwisko
const MAP = { orderNo: col('A'), name: col('C') };

/* Okres, dla którego liczymy raport:
   - {type:'year', year}  -> cały wskazany rok kalendarzowy
   - {type:'days', days}  -> ruchome okno "ostatnie N dni" liczone od dzisiaj
     (ta sama logika co zakładki sprzedażowe "7/14/30 dni" w components/sales). */
function matchesPeriod(dateStr, period){
  const d = parseDate(dateStr);
  if(!d) return false;
  if(period.type === 'year') return d.getFullYear() === period.year;
  const cutoff = new Date();
  cutoff.setHours(0,0,0,0);
  cutoff.setDate(cutoff.getDate() - period.days);
  return d >= cutoff;
}

function periodKey(period){
  return period.type === 'year' ? `year:${period.year}` : `days:${period.days}`;
}

/* customerRecords: Map<periodKey, Array<record>> — pełne, niesfiltrowane, nieposortowane
   dane per klient dla danego okresu. Każdy widok (CUSTOMER_VIEW_DEFS w customers.js)
   sam filtruje i sortuje ten zestaw wg swoich kryteriów. */
const customerRecords = new Map();
const loadingPromises = new Map();

function buildOrderCustomerMap(mapRows){
  const map = {};
  mapRows.forEach(row=>{
    const orderNo = row[MAP.orderNo];
    const name = row[MAP.name];
    if(orderNo && name) map[orderNo] = name;
  });
  return map;
}

function aggregateOrders(orderRows, orderCustomerMap, period){
  const byCustomer = {};
  let unmatched = 0;
  orderRows.forEach(row=>{
    if(!matchesPeriod(row[ORD.saleDate], period)) return;
    const orderNo = row[ORD.orderNo];
    const name = orderCustomerMap[orderNo];
    if(!name){ unmatched++; return; }
    const price = parseNum(row[ORD.price]);
    const qty = parseIntSafe(row[ORD.qty]);
    const margin = parseNum(row[ORD.margin]);
    if(!byCustomer[name]) byCustomer[name] = { orders:new Set(), unitsOrdered:0, orderValue:0, margin:0 };
    const c = byCustomer[name];
    c.orders.add(orderNo);
    c.unitsOrdered += qty;
    c.orderValue += price * qty;
    c.margin += margin;
  });
  if(unmatched > 0) console.warn(`[customersData] ${unmatched} wierszy Ordery bez dopasowania klienta (brak nr zamówienia w arkuszu "Dane zamówień")`);
  return byCustomer;
}

function aggregateReturns(returnRows, period){
  const byCustomer = {};
  returnRows.forEach(row=>{
    if(!matchesPeriod(row[RET.purchaseDate], period)) return;
    const name = row[RET.name];
    if(!name) return;
    const price = parseNum(row[RET.price]);
    const qty = parseIntSafe(row[RET.qty]);
    const lostMargin = parseNum(row[RET.lostMargin]);
    if(!byCustomer[name]) byCustomer[name] = { unitsReturned:0, returnedValue:0, lostMargin:0 };
    const c = byCustomer[name];
    c.unitsReturned += qty;
    c.returnedValue += price * qty;
    c.lostMargin += lostMargin;
  });
  return byCustomer;
}

function buildRecords(ordersByCustomer, returnsByCustomer){
  const names = new Set([...Object.keys(ordersByCustomer), ...Object.keys(returnsByCustomer)]);
  const records = [];
  names.forEach(name=>{
    const o = ordersByCustomer[name] || { orders:new Set(), unitsOrdered:0, orderValue:0, margin:0 };
    const r = returnsByCustomer[name] || { unitsReturned:0, returnedValue:0, lostMargin:0 };
    const returnRate = o.unitsOrdered > 0 ? (r.unitsReturned / o.unitsOrdered * 100) : 0;
    records.push({
      name,
      orders: o.orders.size,
      unitsOrdered: o.unitsOrdered,
      unitsReturned: r.unitsReturned,
      orderValue: o.orderValue,
      margin: o.margin,
      returnedValue: r.returnedValue,
      lostMargin: r.lostMargin,
      marginNet: o.margin - r.lostMargin,
      returnShare: returnRate,
      returnPercent: returnRate,
    });
  });
  return records;
}

/* Pobiera i wylicza dane raz na okres, wynik trzymany w pamięci — kolejne
   wejścia w zakładkę Klienci dla tego samego okresu nie odpytują sieci ponownie.
   loadingPromises jest kluczowane per okres, żeby równoległe żądania dla różnych
   okresów (rok vs. ostatnie 90/180 dni) się nie nadpisywały. */
export async function loadCustomersData(period){
  const key = periodKey(period);
  if(customerRecords.has(key)) return customerRecords.get(key);
  if(loadingPromises.has(key)) return loadingPromises.get(key);

  const promise = (async ()=>{
    const [returnRows, orderRows, mapRows] = await Promise.all([
      fetchCsvRaw(CSV_RETURNS), fetchCsvRaw(CSV_ORDERS), fetchCsvRaw(CSV_ORDER_CUSTOMERS)
    ]);
    const orderCustomerMap = buildOrderCustomerMap(mapRows);
    const ordersByCustomer = aggregateOrders(orderRows, orderCustomerMap, period);
    const returnsByCustomer = aggregateReturns(returnRows, period);
    const records = buildRecords(ordersByCustomer, returnsByCustomer);
    customerRecords.set(key, records);
    return records;
  })();
  loadingPromises.set(key, promise);

  try{
    return await promise;
  } finally {
    loadingPromises.delete(key);
  }
}
