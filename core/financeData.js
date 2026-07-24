import { parseNum, parseIntSafe, parseDate } from './format.js';
import { fetchCsvRaw, col } from './csv.js';
import { DATA_BASE } from './config.js';

const CSV_ORDERS = DATA_BASE + 'ordery.csv';

/* Ordery: C cena jednostkowa, D data sprzedaży, F ilość, G nr zamówienia,
   J zysk netto (bez VAT, już uwzględnia ilość — potwierdzone), M marża
   (gotowa kolumna, sumowana wprost — potwierdzone). */
const ORD = { price: col('C'), saleDate: col('D'), qty: col('F'), orderNo: col('G'), profit: col('J'), margin: col('M') };

/* Jeśli wartość CAŁEGO zamówienia (brutto, wszystkie pozycje) w okresie jest
   niższa niż próg, doliczamy jednorazowo (per zamówienie, nie per pozycję)
   ryczałt jako dodatkowy przychód z pokrycia kosztu wysyłki przez odbiorcę. */
const SHIPPING_THRESHOLD = 350;
const SHIPPING_FEE = 20;

let rawPromise = null;
function loadRaw(){
  if(!rawPromise) rawPromise = fetchCsvRaw(CSV_ORDERS);
  return rawPromise;
}

function inRange(dateStr, start, end){
  const d = parseDate(dateStr);
  return d && d >= start && d <= end;
}

export async function getFinanceSummary(start, end){
  const rows = await loadRaw();

  let grossSales = 0, netProfit = 0, margin = 0;
  const orderTotals = {};

  rows.forEach(row=>{
    if(!inRange(row[ORD.saleDate], start, end)) return;
    const price = parseNum(row[ORD.price]);
    const qty = parseIntSafe(row[ORD.qty]);
    const lineGross = price * qty;

    grossSales += lineGross;
    netProfit += parseNum(row[ORD.profit]);
    margin += parseNum(row[ORD.margin]);

    const orderNo = row[ORD.orderNo];
    orderTotals[orderNo] = (orderTotals[orderNo] || 0) + lineGross;
  });

  let shippingRevenue = 0;
  Object.values(orderTotals).forEach(total => {
    if(total < SHIPPING_THRESHOLD) shippingRevenue += SHIPPING_FEE;
  });

  return { grossSales, netProfit, margin, shippingRevenue };
}
