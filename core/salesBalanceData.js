import { parseNum, parseIntSafe, parseDate } from './format.js';
import { fetchCsvRaw, fetchCsvRawAll, col, authedFetchJson } from './csv.js';
import { DATA_BASE, WORKER_BASE } from './config.js';
import { getNumPref, setNumPref } from './prefs.js';

const CSV_ORDERS = DATA_BASE + 'ordery.csv';
const CSV_RETURNS = DATA_BASE + 'zwroty.csv';
const CSV_MARKETING = DATA_BASE + 'marketing.csv';
const CSV_PROMOTIONS = DATA_BASE + 'promocje.csv';
const CSV_ORDER_CUSTOMERS = DATA_BASE + 'zamowienia_klienci.csv'; // arkusz "Dane zamówień"

/* Ordery: C cena jednostkowa (BRUTTO, VAT 23% — potwierdzone), D data sprzedaży,
   F ilość, I koszt zakupu (per linia — realny COGS). Marża NIE jest już brana
   wprost z kolumny M arkusza — liczymy ją sami wg wzoru zweryfikowanego
   z wynikiem finansowym V2 (patrz komentarz przy budowaniu "series" niżej). */
const ORD = { price: col('C'), saleDate: col('D'), qty: col('F'), cogs: col('I') };
// Zwroty: E ID produktu, G cena brutto, H ilość, T data zakupu, U wartość
// zwróconego towaru wprowadzana z powrotem na stan (NETTO), R data zwrotu
// środków finansowych klientowi (rozliczenie księgowe, patrz RETURNS_MODE niżej).
const RET = { productId: col('E'), price: col('G'), qty: col('H'), purchaseDate: col('T'), restockValue: col('U'), refundDate: col('R') };
// Promocje (jak w cashflowData.js): A data, G info o promocji/NK.
const PROMO = { date: col('A'), info: col('G') };
// Dane zamówień: H kwota zamówienia BEZ kosztu przesyłki, J wybrana forma
// dostawy (tekst), T data zamówienia — potwierdzone przez właściciela.
const ORDER_CUST = { total: col('H'), delivery: col('J'), orderDate: col('T') };

/* Cennik dostaw wg formy (arkusz "Arkusz5"/"WYNIK FINANSOWY", tabela A2:C9,
   potwierdzone przez właściciela). freeFrom=null oznacza "zawsze płatne, bez
   progu darmowej dostawy" (wysyłka międzynarodowa) — w przeciwieństwie do
   metod krajowych, gdzie 350 zł (wartość zamówienia BEZ przesyłki, kolumna H)
   zwalnia klienta z opłaty. Trzymane jako stała — jeśli ceny się zmienią,
   trzeba poprawić tutaj (ten sam wzorzec co VAT_RATE/PROMO_BUDGET_DEFAULT_FALLBACK). */
const SHIPPING_METHODS = new Map([
  ['Kurier DPD',                        { price: 18, freeFrom: 350 }],
  ['DPD Pickup',                        { price: 13, freeFrom: 350 }],
  ['DPD Pickup - Automaty DPD Station', { price: 13, freeFrom: 350 }],
  ['Paczkomaty InPost',                 { price: 19, freeFrom: 350 }],
  ['Kurier INPOST',                     { price: 21, freeFrom: 350 }],
  ['DPD wysyłka międzynarodowa',        { price: 69, freeFrom: null }],
  ['Odbiór osobisty',                   { price: 0,  freeFrom: null }],
  ['Dostawa elektroniczna',             { price: 0,  freeFrom: null }],
]);

/* Opłata pobrana od klienta za TĘ konkretną dostawę — 0, jeśli metoda jest
   z definicji darmowa (odbiór osobisty, elektroniczna), albo jeśli wartość
   zamówienia (bez przesyłki) osiągnęła próg darmowej dostawy danej metody. */
function shippingFeeForOrder(deliveryName, orderTotal){
  const method = SHIPPING_METHODS.get((deliveryName || '').trim());
  if(!method || method.price === 0) return 0;
  if(method.freeFrom !== null && orderTotal >= method.freeFrom) return 0;
  return method.price;
}

/* Dwa sposoby przypisania zwrotu do miesiąca — użytkownik przełącza je w UI:
   - 'purchaseMonth': zwrot obciąża miesiąc ZAKUPU (kolumna T) — tak samo jak
     reszta aplikacji (Zwroty, Cash-Flow); zwrot zarejestrowany w połowie
     kolejnego miesiąca nadal liczy się do miesiąca, w którym sprzedano towar.
   - 'refundMonth': zwrot obciąża miesiąc, w którym FAKTYCZNIE wypłynęły
     pieniądze z konta (kolumna R) — ujęcie bliższe cash-flow/księgowości.
   W obu trybach koszt zwrotu liczony jest tak samo: Zwroty netto (G×H ÷
   VAT_RATE) minus wartość zwróconego towaru wprowadzana na stan (netto,
   kolumna U) — Marża liczona jest W PEŁNI NETTO (patrz komentarz przy
   budowaniu "series" w getSalesBalanceSeries), więc Zwroty też muszą być
   netto, nie brutto, żeby pasować do reszty formuły. */
export const RETURNS_MODE_PURCHASE = 'purchaseMonth';
export const RETURNS_MODE_REFUND = 'refundMonth';

export const VAT_RATE = 1.23;

/* Budżet marketingu dnia promocyjnego — WSPÓLNY dla wszystkich kont (D1 przez
   Worker, patrz worker/src/index.js: /promo-budgets), nie localStorage per
   przeglądarka jak wcześniej. OSOBNO DLA KAŻDEJ DATY (nie jeden wspólny,
   zbiorczy dla całego miesiąca). Jest jednak też edytowalna "domyślna kwota"
   — używana wyłącznie jako wypełnienie dla dat, których NIKT jeszcze ręcznie
   nie ustawił; jeśli dana data ma już własną zapisaną wartość, ta wygrywa i
   domyślna kwota jej nie nadpisuje (patrz getPromoDayBudget).

   Wzorzec identyczny jak core/reorderCart.js: lokalny cache stanu (żeby
   odczyty zostały synchroniczne — reszta apki i tak działa w oparciu o
   ponowny render() po zapisie, nie o wartość zwróconą z akcji), doładowywany
   przy każdym 'ferro:data-loaded', zapisy async przez Worker. */
const PROMO_BUDGETS_URL = `${WORKER_BASE}/promo-budgets`;
const PROMO_BUDGET_DEFAULT_KEY = 'default';
const PROMO_BUDGET_DEFAULT_FALLBACK = 4000;

let promoBudgetsState = {};

export async function loadPromoBudgets(){
  try{ promoBudgetsState = await authedFetchJson(PROMO_BUDGETS_URL) || {}; }
  catch(e){ /* błąd sieci nie blokuje UI — poprzedni stan (albo pusty na starcie) zostaje */ }
}

export function getPromoBudgetDefault(){
  return promoBudgetsState[PROMO_BUDGET_DEFAULT_KEY] ?? PROMO_BUDGET_DEFAULT_FALLBACK;
}
export async function setPromoBudgetDefault(value){
  await setPromoBudgetRaw(PROMO_BUDGET_DEFAULT_KEY, value);
}

export function getPromoDayBudget(dateKey){
  return promoBudgetsState[dateKey] ?? getPromoBudgetDefault();
}
export async function setPromoDayBudget(dateKey, value){
  await setPromoBudgetRaw(dateKey, value);
}

async function setPromoBudgetRaw(dateKey, amount){
  try{
    promoBudgetsState = await authedFetchJson(`${PROMO_BUDGETS_URL}/set`, {
      method: 'POST', body: JSON.stringify({ dateKey, amount }),
    }) || promoBudgetsState;
  } catch(e){ /* jw. */ }
}

document.addEventListener('ferro:data-loaded', loadPromoBudgets);

const MONTHS_PL = ['STYCZEŃ','LUTY','MARZEC','KWIECIEŃ','MAJ','CZERWIEC','LIPIEC','SIERPIEŃ','WRZESIEŃ','PAŹDZIERNIK','LISTOPAD','GRUDZIEŃ'];

function isoDateKey(d){ return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function daysInMonth(year, monthIndex){ return new Date(year, monthIndex+1, 0).getDate(); }

const cache = {};
function cached(key, loader){
  if(!cache[key]) cache[key] = loader();
  return cache[key];
}
const loadOrdersRaw = () => cached('orders', () => fetchCsvRaw(CSV_ORDERS));
const loadReturnsRaw = () => cached('returns', () => fetchCsvRaw(CSV_RETURNS));
const loadMarketingRaw = () => cached('marketing', () => fetchCsvRawAll(CSV_MARKETING));
const loadPromotionsRaw = () => cached('promo', () => fetchCsvRaw(CSV_PROMOTIONS));
const loadOrderCustomersRaw = () => cached('orderCustomers', () => fetchCsvRaw(CSV_ORDER_CUSTOMERS));

/* Dzień "promocyjny" = ten sam warunek co w cashflowData.js (% zniżki albo NK
   wpisane w arkuszu Promocje), tu potrzebujemy tylko samego faktu, nie wielkości. */
function isPromoInfo(text){
  if(!text) return false;
  const s = String(text).trim();
  if(/\bNK\b/i.test(s)) return true;
  if(/\d+(?:[.,]\d+)?\s*%/.test(s)) return true;
  if(/^0?[.,]\d+\b/.test(s)) return true;
  return false;
}

async function loadPromoDaysByMonth(){
  return cached('promoDaysByMonth', async () => {
    const rows = await loadPromotionsRaw();
    const map = new Map(); // 'YYYY-M' -> Set<'YYYY-MM-DD'>
    rows.forEach(row => {
      const d = parseDate(row[PROMO.date]);
      if(!d || !isPromoInfo(row[PROMO.info])) return;
      const monthKey = d.getFullYear() + '-' + d.getMonth();
      if(!map.has(monthKey)) map.set(monthKey, new Set());
      map.get(monthKey).add(isoDateKey(d));
    });
    return map;
  });
}

/* Znajduje kolumnę miesiąca w arkuszu V2 (marketing.csv) — po etykiecie w
   nagłówku, z fallbackiem na ostatnią kolumnę, w której wiersz "MARKETING" ma
   wypełnioną wartość (gdyby bieżący miesiąc jeszcze nie miał wpisanej kwoty).
   Współdzielone przez budżet marketingu i "pozostałe koszty" — obie pozycje
   muszą wskazywać na tę samą kolumnę/miesiąc. */
async function getMarketingSheetColumn(year, monthIndex){
  const rows = await loadMarketingRaw();
  const header = rows[0] || [];
  const marketingRow = rows.find(r => String(r[0]).trim().toUpperCase() === 'MARKETING') || [];
  const targetLabel = MONTHS_PL[monthIndex] + ' ' + year;

  let colIdx = header.findIndex(h => String(h).trim().toUpperCase() === targetLabel);
  if(colIdx === -1) colIdx = header.length - 1;
  while(colIdx > 0 && !parseNum(marketingRow[colIdx])) colIdx--;

  return { rows, colIdx, marketingRow, sourceLabel: String(header[colIdx] || '').trim() || targetLabel, targetLabel };
}

async function getMarketingMonthlyTotal(year, monthIndex){
  const { marketingRow, colIdx, sourceLabel, targetLabel } = await getMarketingSheetColumn(year, monthIndex);
  return { monthlyTotal: parseNum(marketingRow[colIdx]), sourceLabel, targetLabel };
}

/* "Pozostałe koszty" — domyślnie suma WYBRANYCH wierszy arkusza V2 (numeracja
   jak w Google Sheets, licząc od 1) dla kolumny wybranego miesiąca: 17-18
   (INPOST, DPD — koszt wysyłki PONOSZONY przez nas jako nadawcę), 19 (leasing)
   i 24, 26-28 (studio, kartony, medializer...). Wiersze 17-18 z powrotem w tym
   zestawie — odkąd Marża liczona jest od zera wg wzoru Przychody+Dostawy−
   KosztSprzedanego−Zwroty+Restock (patrz getSalesBalanceSeries), a nie z
   gotowej kolumny M, nic już nie odejmuje kosztu wysyłki nadawcy poza tym
   miejscem.
   Wiersz 20 (MARKETING) CELOWO POMINIĘTY — to ten sam budżet marketingu, który
   już wcześniej znajdujemy osobno przez wyszukanie wiersza o etykiecie
   "MARKETING" (getMarketingMonthlyTotal) i odejmujemy w Wyniku jako
   marketingBudget. Dodanie go tu policzyłoby marketing podwójnie.
   Wiersz 25 (WYPŁATY) zostaje — to osobny koszt (płace), nie marketing.
   UWAGA VAT — wiersze 17-19, 24, 26-28 są w V2 BRUTTO (dzielimy przez
   VAT_RATE przed użyciem w Wyniku), ale wiersz 25 (WYPŁATY) jest już NETTO
   (płace nie mają VAT-u, więc nie ma tu czego dzielić) — potwierdzone przez
   właściciela, dzielenie go przez VAT_RATE byłoby błędem. Dlatego liczymy od
   razu wynik NETTO (nie brutto-do-podzielenia-później jak wcześniej) —
   mieszanie dwóch różnych podstaw VAT w jednej "kwocie brutto" nie miałoby
   sensu. */
const OTHER_COSTS_SHEET_ROWS_GROSS = [17, 18, 19, 24, 26, 27, 28];
const OTHER_COSTS_SHEET_ROWS_NET = [25];

function sumSheetRows(rows, colIdx, sheetRowNumbers){
  return sheetRowNumbers.reduce((sum, sheetRow) => sum + parseNum((rows[sheetRow - 1] || [])[colIdx]), 0);
}

/* Zwraca od razu NETTO — wiersze brutto podzielone przez VAT_RATE, wiersz
   już netto (25, WYPŁATY) dodany wprost. */
async function getOtherCostsSheetDefault(year, monthIndex){
  const { rows, colIdx } = await getMarketingSheetColumn(year, monthIndex);
  const grossSum = sumSheetRows(rows, colIdx, OTHER_COSTS_SHEET_ROWS_GROSS);
  const netSum = sumSheetRows(rows, colIdx, OTHER_COSTS_SHEET_ROWS_NET);
  return grossSum / VAT_RATE + netSum;
}

function otherCostsPrefKey(year, monthIndex){ return 'sb.otherCosts.' + year + '-' + monthIndex; }

/* Wartość "pozostałych kosztów" dla danego miesiąca — TRZYMANA I EDYTOWANA
   JAKO NETTO (bo źródłowe wiersze V2 mieszają brutto i netto, więc jedyna
   spójna wspólna podstawa do wpisania "z łapy" to netto). Domyślnie wyliczona
   z V2 (getOtherCostsSheetDefault), ale edytowalna i trwale pamiętana OSOBNO
   dla każdego miesiąca (ten sam mechanizm co budżet dni promocyjnych). */
export async function getOtherCostsForMonth(year, monthIndex){
  const computedDefault = await getOtherCostsSheetDefault(year, monthIndex);
  const value = getNumPref(otherCostsPrefKey(year, monthIndex), computedDefault);
  return { value, computedDefault };
}
export function setOtherCostsForMonth(year, monthIndex, value){
  setNumPref(otherCostsPrefKey(year, monthIndex), value);
}

/* Dzienna stawka "pozostałych kosztów" (NETTO) — miesięczna wartość rozbita
   równo na wszystkie dni miesiąca (bez rozróżnienia dni promocyjnych, w
   odróżnieniu od budżetu marketingu), żeby wynik dnia i sumy dla dowolnego
   zakresu dat zawsze się zgadzały. */
async function computeOtherCostsDailyRates(start, end){
  const rates = new Map();
  const perMonth = new Map();
  for(const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)){
    const monthKey = d.getFullYear() + '-' + d.getMonth();
    if(!perMonth.has(monthKey)){
      const { value } = await getOtherCostsForMonth(d.getFullYear(), d.getMonth());
      perMonth.set(monthKey, value / daysInMonth(d.getFullYear(), d.getMonth()));
    }
    rates.set(isoDateKey(d), perMonth.get(monthKey));
  }
  return rates;
}

/* "Dostawy opłacone przez klientów brutto" — liczone WPROST z pojedynczych
   zamówień (arkusz "Dane zamówień", zamowienia_klienci.csv), zamiast z
   gotowej sumy miesięcznej rozjechanej równo na wszystkie dni. Dla każdego
   zamówienia w oknie [start, end]: sprawdzamy formę dostawy (kolumna J) i
   wartość zamówienia bez przesyłki (kolumna H) w cenniku SHIPPING_METHODS,
   i doliczamy opłatę do PRAWDZIWEJ daty zamówienia (kolumna T) — więc dzień
   z większą liczbą płatnych dostaw faktycznie pokazuje wyższą kwotę, a nie
   uśrednioną. Ta sama logika co formuła w arkuszu WYNIK FINANSOWY, tylko
   per dzień zamiast per miesiąc. */
async function computeShippingDailyRates(start, end){
  const rows = await loadOrderCustomersRaw();
  const rates = new Map();
  rows.forEach(row => {
    const date = parseDate(row[ORDER_CUST.orderDate]);
    if(!date || date < start || date > end) return;
    const fee = shippingFeeForOrder(row[ORDER_CUST.delivery], parseNum(row[ORDER_CUST.total]));
    if(fee <= 0) return;
    const key = isoDateKey(date);
    rates.set(key, (rates.get(key) || 0) + fee);
  });
  return rates;
}

/* Budżet marketingu dla całego miesiąca, rozbity na dni promocyjne (budżet
   każdej daty pamiętany OSOBNO na trwałe — getPromoDayBudget) i dzienną
   średnią dla reszty dni: (budżet_miesięczny − suma_budżetów_dni_promo) /
   (dni_w_miesiącu − liczba_dni_promo). */
export async function getMarketingBudgetForMonth(year, monthIndex){
  const [{ monthlyTotal, sourceLabel, targetLabel }, promoDaysByMonth] = await Promise.all([
    getMarketingMonthlyTotal(year, monthIndex),
    loadPromoDaysByMonth(),
  ]);

  const promoDates = [...(promoDaysByMonth.get(year + '-' + monthIndex) || [])].sort();
  const promoDayBudgets = new Map();
  let promoBudgetTotal = 0;
  promoDates.forEach(dateKey => {
    const amount = getPromoDayBudget(dateKey);
    promoDayBudgets.set(dateKey, amount);
    promoBudgetTotal += amount;
  });

  const totalDays = daysInMonth(year, monthIndex);
  const nonPromoDays = totalDays - promoDates.length;
  const nonPromoDailyRate = nonPromoDays > 0 ? (monthlyTotal - promoBudgetTotal) / nonPromoDays : 0;

  return { monthlyTotal, sourceLabel, targetLabel, totalDays, promoDates, promoDayBudgets, promoBudgetTotal, nonPromoDays, nonPromoDailyRate };
}

/* Stawka marketingu dla KAŻDEGO dnia w zakresie [start,end] — Map<dateKey, kwota>,
   z cache'em per-miesiąc (żeby dla zakresu obejmującego wiele miesięcy nie liczyć
   tego samego miesiąca wielokrotnie). */
async function computeMarketingDailyRates(start, end){
  const rates = new Map();
  const perMonth = new Map();
  for(const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)){
    const monthKey = d.getFullYear() + '-' + d.getMonth();
    if(!perMonth.has(monthKey)){
      perMonth.set(monthKey, await getMarketingBudgetForMonth(d.getFullYear(), d.getMonth()));
    }
    const budget = perMonth.get(monthKey);
    const dateKey = isoDateKey(d);
    rates.set(dateKey, budget.promoDayBudgets.has(dateKey) ? budget.promoDayBudgets.get(dateKey) : budget.nonPromoDailyRate);
  }
  return { rates, months: [...perMonth.values()] };
}

/* Seria dzienna dla zakresu [start,end] (inclusive) — po jednym przelocie po
   Ordery.csv i Zwroty.csv, każdy dzień w zakresie ma swój wiersz (nawet bez
   sprzedaży — ciągłość wykresu/kalendarza). returnsMode decyduje, do którego
   dnia przypisany jest zwrot — patrz RETURNS_MODE_PURCHASE/RETURNS_MODE_REFUND
   wyżej. Wpływa to na WSZYSTKO co dotyczy zwrotów naraz (kwoty, sztuki,
   % zwrotów, Wynik), żeby kafelek nie mieszał dwóch różnych konwencji. */
export async function getSalesBalanceSeries(start, end, returnsMode = RETURNS_MODE_PURCHASE){
  const [orderRows, returnRows, { rates: marketingRates, months: marketingMonths }, otherCostsRates, shippingRates] = await Promise.all([
    loadOrdersRaw(),
    loadReturnsRaw(),
    computeMarketingDailyRates(start, end),
    computeOtherCostsDailyRates(start, end),
    computeShippingDailyRates(start, end),
  ]);

  const byDay = new Map();
  for(const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)){
    byDay.set(isoDateKey(d), {
      date: new Date(d), salesGross: 0, cogs: 0,
      returnsGross: 0, restockValue: 0, qtySold: 0, qtyReturned: 0,
    });
  }

  orderRows.forEach(row => {
    const d = parseDate(row[ORD.saleDate]);
    if(!d) return;
    const bucket = byDay.get(isoDateKey(d));
    if(!bucket) return; // poza analizowanym zakresem
    const price = parseNum(row[ORD.price]);
    const qty = parseIntSafe(row[ORD.qty]);
    bucket.salesGross += price * qty;
    bucket.cogs += parseNum(row[ORD.cogs]);
    bucket.qtySold += qty;
  });

  const returnDateCol = returnsMode === RETURNS_MODE_REFUND ? RET.refundDate : RET.purchaseDate;
  returnRows.forEach(row => {
    const d = parseDate(row[returnDateCol]);
    if(!d) return;
    const bucket = byDay.get(isoDateKey(d));
    if(!bucket) return;
    bucket.returnsGross += parseNum(row[RET.price]) * parseIntSafe(row[RET.qty]);
    bucket.restockValue += parseNum(row[RET.restockValue]);
    bucket.qtyReturned += parseIntSafe(row[RET.qty]);
  });

  const series = [...byDay.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([dateKey, b]) => {
    const shippingGross = shippingRates.get(dateKey) || 0;
    const salesNet = b.salesGross / VAT_RATE;
    const shippingNet = shippingGross / VAT_RATE;
    const returnsNet = b.returnsGross / VAT_RATE;
    const marketingBudget = marketingRates.get(dateKey) || 0; // netto (0% VAT — odwrotne obciążenie)
    // Pozostałe koszty — dzienna stawka jest już NETTO u źródła (patrz
    // computeOtherCostsDailyRates/getOtherCostsSheetDefault: część wierszy V2
    // jest brutto i dzielona przez VAT_RATE, część już netto — mieszanie ich
    // w jedną "kwotę brutto do podzielenia" nie miałoby sensu).
    const otherCostsNet = otherCostsRates.get(dateKey) || 0;
    // Marża — W PEŁNI NETTO po obu stronach (przychodowej i kosztowej), żeby
    // VAT nigdy nie wchodził do wyniku/zarobku (VAT to zobowiązanie wobec
    // urzędu skarbowego, nie zarobek firmy — standardowa zasada rachunkowości).
    // Wcześniejsza wersja liczyła Przychody/Dostawy/Zwroty BRUTTO — dla sztuk
    // sprzedanych i zwróconych VAT się zerował (brutto na brutto), ale dla
    // reszty sprzedaży (tej NIEzwróconej) VAT zostawał "w plusie" i sztucznie
    // zawyżał wynik (potwierdzone z właścicielem, przeliczone ręcznie na
    // styczniu — różnica rzędu kilkudziesięciu-kilkuset tys. zł/miesiąc).
    // Koszt wysyłki PONOSZONY przez nas (kurierzy) nie jest tu odejmowany —
    // siedzi w "Pozostałe koszty" (wiersze INPOST/DPD w V2), żeby nie liczyć
    // go podwójnie.
    const margin = salesNet + shippingNet - returnsNet - b.cogs + b.restockValue;
    // Dzienny wynik finansowy z REALNYCH danych (nie z założeń % symulacji):
    // Marża (już netto) minus budżet marketingu (netto) minus pozostałe
    // koszty (już netto).
    const financialResult = margin - marketingBudget - otherCostsNet;
    return {
      dateKey, date: b.date,
      salesGross: b.salesGross, salesNet,
      shippingGross, shippingNet,
      inflowGross: b.salesGross + shippingGross,
      inflowNet: salesNet + shippingNet,
      cogs: b.cogs,
      margin,
      returnsGross: b.returnsGross, returnsNet,
      restockValue: b.restockValue,
      marketingBudget,
      otherCostsNet,
      financialResult,
      mer: marketingBudget > 0 ? salesNet / marketingBudget : null,
      qtySold: b.qtySold,
      qtyReturned: b.qtyReturned,
      returnRatePct: b.qtySold > 0 ? (b.qtyReturned / b.qtySold) * 100 : null,
    };
  });

  return { series, marketingMonths };
}

/* Zsumowany bilans dla całego zakresu (do kart z liczbami) — oparty o tę samą
   serię dzienną co wykres, więc liczby na kartach i na wykresie zawsze się zgadzają. */
export async function getSalesBalance(start, end, returnsMode = RETURNS_MODE_PURCHASE){
  const { series, marketingMonths } = await getSalesBalanceSeries(start, end, returnsMode);
  const sum = key => series.reduce((s, r) => s + r[key], 0);
  const salesNet = sum('salesNet');
  const marketingBudget = sum('marketingBudget');

  return {
    salesGross: sum('salesGross'), salesNet,
    shippingGross: sum('shippingGross'), shippingNet: sum('shippingNet'),
    inflowGross: sum('inflowGross'), inflowNet: sum('inflowNet'),
    cogs: sum('cogs'),
    margin: sum('margin'),
    returnsGross: sum('returnsGross'), returnsNet: sum('returnsNet'),
    restockValue: sum('restockValue'),
    marketingBudget,
    otherCostsNet: sum('otherCostsNet'),
    financialResult: sum('financialResult'),
    mer: marketingBudget > 0 ? salesNet / marketingBudget : null,
    qtySold: sum('qtySold'),
    qtyReturned: sum('qtyReturned'),
    returnRatePct: sum('qtySold') > 0 ? (sum('qtyReturned') / sum('qtySold')) * 100 : null,
    series,
    marketingMonths,
  };
}

/* ---------- SYMULACJA (czysta matematyka, bez pobierania danych) ----------
   Założenia biznesowe (potwierdzone): koszt sprzedanego towaru ~57% sprzedaży
   BRUTTO, zwroty do klienta ~30-35% sprzedaży brutto — realnie klientowi
   oddaje się kwotę BRUTTO (to liczy się do PŁYNNOŚCI finansowej), ale na
   WYNIK (zarobek) wpływa tylko część netto — VAT od zwracanej sprzedaży i
   tak nigdy nie był realnym przychodem, więc liczenie straty na zwrocie w
   kwocie brutto zawyżałoby koszt o ok. 18,7% (potwierdzone, poprawka na
   życzenie właściciela). Z tej samej (netto) wartości zwrotu ~40% pomniejsza
   koszt towaru (towar wraca do obrotu). Dodatkowo do wyniku (nie do MER —
   MER liczy się wyłącznie ze sprzedaży) dolicza się netto przychód z
   dostaw opłacanych przez klientów, bo to też realny wpływ pomijany dotąd
   w tej symulacji. "Pozostałe koszty" wpisywane są BRUTTO (tak jak w V2 w
   module Bilansu), a do Wyniku liczy się — tak samo jak zwroty — tylko część
   netto (÷ VAT_RATE). */
function simulationCore({ salesGross, cogsPct, returnsPct, returnsCogsRecoveryPct, shippingRevenueGross = 0, otherCostsGross = 0 }){
  const cogs = salesGross * (cogsPct / 100);
  const returnsOutflowGross = salesGross * (returnsPct / 100); // do płynności — nieużywane w Wyniku
  const returnsOutflowNet = returnsOutflowGross / VAT_RATE;
  const returnsCogsRecovery = returnsOutflowNet * (returnsCogsRecoveryPct / 100);
  const salesNet = salesGross / VAT_RATE;
  const shippingRevenueNet = shippingRevenueGross / VAT_RATE;
  const otherCostsNet = otherCostsGross / VAT_RATE;
  return { cogs, returnsOutflowGross, returnsOutflowNet, returnsCogsRecovery, salesNet, shippingRevenueNet, otherCostsGross, otherCostsNet };
}

/* Wariant 1: podajesz budżet marketingu -> wynik finansowy. */
export function simulateResult({ salesGross, cogsPct, returnsPct, returnsCogsRecoveryPct, shippingRevenueGross, otherCostsGross, marketingBudget }){
  const core = simulationCore({ salesGross, cogsPct, returnsPct, returnsCogsRecoveryPct, shippingRevenueGross, otherCostsGross });
  const result = core.salesNet + core.shippingRevenueNet - core.cogs - marketingBudget - core.returnsOutflowNet + core.returnsCogsRecovery - core.otherCostsNet;
  return { ...core, marketingBudget, result, mer: marketingBudget > 0 ? core.salesNet / marketingBudget : null };
}

/* Wariant 2: podajesz docelowy wynik (np. 0 = na zero) -> maksymalny budżet
   marketingu i odpowiadający mu MER. */
export function simulateRequiredMarketing({ salesGross, cogsPct, returnsPct, returnsCogsRecoveryPct, shippingRevenueGross, otherCostsGross, targetResult }){
  const core = simulationCore({ salesGross, cogsPct, returnsPct, returnsCogsRecoveryPct, shippingRevenueGross, otherCostsGross });
  const marketingBudget = core.salesNet + core.shippingRevenueNet - core.cogs - core.returnsOutflowNet + core.returnsCogsRecovery - core.otherCostsNet - targetResult;
  return { ...core, targetResult, marketingBudget, mer: marketingBudget > 0 ? core.salesNet / marketingBudget : null };
}

/* Wariant 3: podajesz docelowy MER + budżet marketingu (nie docelowy wynik!)
   -> jaką sprzedaż brutto trzeba zrobić, żeby ten budżet dał dokładnie taki
   MER. To zwykłe mnożenie (MER = sprzedaż netto ÷ budżet, więc sprzedaż netto
   = MER × budżet) — zawsze policzalne, bez przypadków "nieosiągalne". Wynik
   finansowy jest tu czystym outputem, nie trzeba go podawać. */
export function simulateRequiredSalesFromBudget({ cogsPct, returnsPct, returnsCogsRecoveryPct, shippingRevenueGross, otherCostsGross, targetMer, marketingBudget }){
  const salesNet = targetMer * marketingBudget;
  const salesGross = salesNet * VAT_RATE;
  const core = simulationCore({ salesGross, cogsPct, returnsPct, returnsCogsRecoveryPct, shippingRevenueGross, otherCostsGross });
  const result = core.salesNet + core.shippingRevenueNet - core.cogs - marketingBudget - core.returnsOutflowNet + core.returnsCogsRecovery - core.otherCostsNet;
  return { ...core, salesGross, marketingBudget, result, mer: targetMer };
}
