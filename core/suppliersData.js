import { products } from './data.js';
import { getAlertsSummary } from './alertsData.js';

/* Wszystkie rankingi grupują ten sam `products` (core/data.js, już złączony
   z DB po ID) po polu `dostawca` — produkty bez przypisanego dostawcy są
   pomijane (nie ma ich gdzie policzyć). */
function groupBySupplier(){
  const map = new Map();
  products.forEach(p => {
    if(!p.dostawca) return;
    if(!map.has(p.dostawca)) map.set(p.dostawca, []);
    map.get(p.dostawca).push(p);
  });
  return map;
}

/* 1. Wartość zamrożonego kapitału: ile netto (po cenie zakupu) leży
   w magazynie u danego dostawcy. */
export function getSupplierStockValueRanking(){
  const groups = groupBySupplier();
  return [...groups.entries()].map(([dostawca, items]) => {
    const detailRows = items
      .map(p => ({ id: p.id, name: p.name, img: p.img, metricValue: p.stan * p.cenaZakupu, stan: p.stan }))
      .sort((a, b) => b.metricValue - a.metricValue);
    const value = detailRows.reduce((sum, r) => sum + r.metricValue, 0);
    return { dostawca, value, skuCount: items.length, detailRows };
  }).sort((a, b) => b.value - a.value);
}

/* 2. Sprzedaż 30 dni: suma sztuk sprzedanych w ostatnich 30 dniach
   (kolumna już liczona w arkuszu Panel), per dostawca. */
export function getSupplierSalesRanking(){
  const groups = groupBySupplier();
  return [...groups.entries()].map(([dostawca, items]) => {
    const detailRows = items
      .map(p => ({ id: p.id, name: p.name, img: p.img, metricValue: p.s30 }))
      .sort((a, b) => b.metricValue - a.metricValue);
    const value = detailRows.reduce((sum, r) => sum + r.metricValue, 0);
    return { dostawca, value, skuCount: items.length, detailRows };
  }).sort((a, b) => b.value - a.value);
}

/* 3. Wskaźnik zwrotów: suma zwrotów / suma sprzedaży w ostatnich 30 dniach
   (ważone sprzedażą, nie prosta średnia z procentów per produkt — dostawca
   z jednym produktem i 100% zwrotem przy 1 sztuce nie powinien wygrywać
   z dostawcą sprzedającym tysiące sztuk). Dostawcy bez żadnej sprzedaży
   w oknie są pomijani — % zwrotów nie da się dla nich policzyć.

   WAŻNE: "Sprzedaż 30days" i "Returns 30days" to dwa NIEZALEŻNE okna
   czasowe (sprzedaże i zwroty policzone wg własnej daty), nie kohorta
   "ile z tego, co sprzedano w tym oknie, wróciło" — zwrot policzony w tym
   oknie może dotyczyć sprzedaży sprzed więcej niż 30 dni. Dlatego wynik
   może przekroczyć 100% (wróciło więcej sztuk niż sprzedano nowych w tym
   samym okresie) — to prawidłowe, nie ucinamy tego do 100%, bo to realny
   sygnał (potwierdzone też przez surową kolumnę "% returns" w arkuszu). */
export function getSupplierReturnsRanking(){
  const groups = groupBySupplier();
  return [...groups.entries()].map(([dostawca, items]) => {
    const sprzedaz = items.reduce((sum, p) => sum + p.s30, 0);
    const zwroty = items.reduce((sum, p) => sum + p.ret30, 0);
    const detailRows = items
      .map(p => ({ id: p.id, name: p.name, img: p.img, metricValue: p.s30 > 0 ? (p.ret30 / p.s30 * 100) : null, s30: p.s30, ret30: p.ret30 }))
      .sort((a, b) => (b.metricValue ?? -1) - (a.metricValue ?? -1));
    return { dostawca, value: sprzedaz > 0 ? (zwroty / sprzedaz * 100) : null, sprzedaz, zwroty, skuCount: items.length, detailRows };
  }).filter(r => r.value != null).sort((a, b) => b.value - a.value);
}

/* 4. Marża: średnia marża na sztukę (prosta średnia po SKU, nie ważona
   wolumenem — to ranking rentowności oferty dostawcy, nie jego obrotu;
   obrót jest już osobnym rankingiem w punkcie 2). */
export function getSupplierMarginRanking(){
  const groups = groupBySupplier();
  return [...groups.entries()].map(([dostawca, items]) => {
    const detailRows = items
      .map(p => ({ id: p.id, name: p.name, img: p.img, metricValue: p.narzut }))
      .sort((a, b) => b.metricValue - a.metricValue);
    const value = detailRows.reduce((sum, r) => sum + r.metricValue, 0) / items.length;
    return { dostawca, value, skuCount: items.length, detailRows };
  }).sort((a, b) => b.value - a.value);
}

/* 5. Popyt na braki: liczba zgłoszeń "chcę kupić, a nie ma na stanie" z
   danego okresu, per dostawca — plus ile z tych zgłoszonych produktów jest
   TERAZ faktycznie wyprzedanych (stan <= 0), żeby odróżnić "duże
   zainteresowanie" od "pilnie brakuje". */
export async function getSupplierDemandRanking(days){
  const { products: alertRows } = await getAlertsSummary(days);
  const dostawcaByProductId = new Map(products.map(p => [p.id, p]));

  const bySupplier = new Map();
  alertRows.forEach(r => {
    const p = dostawcaByProductId.get(r.productId);
    if(!p || !p.dostawca) return;
    if(!bySupplier.has(p.dostawca)) bySupplier.set(p.dostawca, { qty: 0, outOfStock: 0, detailRows: [] });
    const acc = bySupplier.get(p.dostawca);
    acc.qty += r.qty;
    if(p.stan <= 0) acc.outOfStock += 1;
    acc.detailRows.push({ id: p.id, name: p.name, img: p.img, metricValue: r.qty, stan: p.stan });
  });

  return [...bySupplier.entries()].map(([dostawca, acc]) => ({
    dostawca,
    value: acc.qty,
    outOfStock: acc.outOfStock,
    skuCount: acc.detailRows.length,
    detailRows: acc.detailRows.sort((a, b) => b.metricValue - a.metricValue),
  })).sort((a, b) => b.value - a.value);
}
