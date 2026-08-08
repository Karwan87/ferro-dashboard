import { navigateTo } from '../../core/router.js';
import { getCashflowStats } from '../../core/cashflowData.js';
import { fmtPLN, groupThousands } from '../../core/format.js';
import { getNumPref, setNumPref, getStrPref, setStrPref } from '../../core/prefs.js';

const MONTH_NAMES = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];
const WEEKDAY_NAMES = ['Pon','Wt','Śr','Czw','Pt','Sob','Nd'];
const CF_YEAR = 2026;

function startOfDay(d){ const x = new Date(d); x.setHours(0,0,0,0); return x; }
function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function fmtDate(d){ return d.toLocaleDateString('pl-PL'); }
function fmtPLNCompact(v){ return (v < 0 ? '-' : '') + groupThousands(String(Math.round(Math.abs(v)))) + ' zł'; }

function mondayOf(date){
  const d = startOfDay(date);
  const day = d.getDay(); // 0=nd..6=sob
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(d, diff);
}
function sundayOf(monday){ return addDays(monday, 6); }

/* Każdy filtr wyznacza PARĘ zakresów: "miniony" (do porównania plan/realizacja)
   i "prognoza" (czysta prognoza). `mode` mówi, które panele mają sens:
   - 'both'      — miniony i prognoza to dwie połówki JEDNEGO okresu (część
                    już minęła, część dopiero nadejdzie) — pokazujemy oba.
   - 'prognozaOnly' — miniony to tylko odniesienie z innego okresu (np.
                    bieżący miesiąc przy planowaniu następnego) — nieistotne,
                    liczy się wyłącznie prognoza.
   - 'minionyOnly'  — analogicznie, prognoza (np. bieżący miesiąc) jest tu
                    nieistotna, bo pytamy o okres już zamknięty. */
const FILTERS = {
  weekRemainder: () => {
    const today = startOfDay(new Date());
    const monday = mondayOf(today);
    const yesterday = addDays(today, -1);
    return {
      label: 'Pozostałe dni bieżącego tygodnia',
      mode: 'both',
      miniony: { start: monday, end: yesterday >= monday ? yesterday : monday },
      prognoza: { start: today, end: sundayOf(monday) },
    };
  },
  pickedWeek: (dateStr) => {
    if(!dateStr) return null;
    const monday = mondayOf(new Date(dateStr));
    const sunday = sundayOf(monday);
    const prevMonday = addDays(monday, -7);
    const prevSunday = addDays(monday, -1);
    return {
      label: `Tydzień ${fmtDate(monday)} – ${fmtDate(sunday)}`,
      mode: 'both',
      miniony: { start: prevMonday, end: prevSunday },
      prognoza: { start: monday, end: sunday },
    };
  },
  monthRemainder: () => {
    const today = startOfDay(new Date());
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const last = new Date(today.getFullYear(), today.getMonth()+1, 0);
    const yesterday = addDays(today, -1);
    return {
      label: 'Pozostałe dni bieżącego miesiąca',
      mode: 'both',
      miniony: { start: first, end: yesterday >= first ? yesterday : first },
      prognoza: { start: today, end: last },
    };
  },
  nextMonth: () => {
    const today = startOfDay(new Date());
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const yesterday = addDays(today, -1);
    const nextFirst = new Date(today.getFullYear(), today.getMonth()+1, 1);
    const nextLast = new Date(today.getFullYear(), today.getMonth()+2, 0);
    return {
      label: 'Następny miesiąc',
      mode: 'prognozaOnly',
      miniony: { start: first, end: yesterday >= first ? yesterday : first },
      prognoza: { start: nextFirst, end: nextLast },
    };
  },
  prevMonth: () => {
    const today = startOfDay(new Date());
    const prevFirst = new Date(today.getFullYear(), today.getMonth()-1, 1);
    const prevLast = new Date(today.getFullYear(), today.getMonth(), 0);
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    return {
      label: 'Poprzedni miesiąc',
      mode: 'minionyOnly',
      miniony: { start: prevFirst, end: prevLast },
      prognoza: { start: first, end: today },
    };
  },
};

let currentFilterKey = 'weekRemainder';

/* Założenia planowanego przychodu (brak promocji/niska promocja/wysoka/NK) —
   trwale zapamiętane (core/prefs.js), żeby widoki "2026" i kalendarz miesiąca
   (bez własnych inputów) mogły korzystać z tych samych, ostatnio ustawionych
   wartości co widok tabelaryczny, zamiast duplikować pola edycji wszędzie. */
const OVERRIDE_DEFAULTS = { none: 15000, low: 40000, high: 60000 };

function getPersistedOverrides(){
  const nkRaw = getStrPref('cf.overrideNk', '');
  return {
    none: getNumPref('cf.overrideNone', OVERRIDE_DEFAULTS.none),
    low: getNumPref('cf.overrideLow', OVERRIDE_DEFAULTS.low),
    high: getNumPref('cf.overrideHigh', OVERRIDE_DEFAULTS.high),
    nk: nkRaw === '' ? null : Number(nkRaw),
  };
}

function readOverrides(){
  const val = (id) => {
    const v = document.getElementById(id).value;
    return v === '' ? null : Number(v);
  };
  const overrides = {
    none: val('cfNone') ?? OVERRIDE_DEFAULTS.none,
    low: val('cfLow') ?? OVERRIDE_DEFAULTS.low,
    high: val('cfHigh') ?? OVERRIDE_DEFAULTS.high,
    nk: val('cfNk'),
  };
  setNumPref('cf.overrideNone', overrides.none);
  setNumPref('cf.overrideLow', overrides.low);
  setNumPref('cf.overrideHigh', overrides.high);
  setStrPref('cf.overrideNk', overrides.nk === null ? '' : String(overrides.nk));
  return overrides;
}

/* Kafelek "Cash-Flow" na hubie Finansów — wybór między widokiem tabelarycznym
   (pozostałe dni tygodnia/miesiąca, następny/poprzedni miesiąc) a widokiem
   "2026" (miesiące -> dni całego roku). */
export function openCashflowHub(){
  navigateTo('screen-cashflow-periods', 'Finanse · Cash-Flow');
}

export function openCashflowTabular(){
  navigateTo('screen-cashflow-dashboard', 'Finanse · Cash-Flow · Wersja tabelaryczna');
  const overrides = getPersistedOverrides();
  document.getElementById('cfNone').value = overrides.none;
  document.getElementById('cfLow').value = overrides.low;
  document.getElementById('cfHigh').value = overrides.high;
  document.getElementById('cfNk').value = overrides.nk === null ? '' : overrides.nk;
  highlightActive('weekRemainder');
  applyCashflowFilter('weekRemainder');
}

export function applyCashflowFilter(key){
  currentFilterKey = key;
  highlightActive(key);
  const pair = key === 'pickedWeek' ? FILTERS.pickedWeek(document.getElementById('cfWeekDate').value) : FILTERS[key]();
  if(!pair) return;
  render(pair);
}

export function applyCashflowPickedWeek(){
  applyCashflowFilter('pickedWeek');
}

export function applyCashflowOverrides(){
  applyCashflowFilter(currentFilterKey);
}

function highlightActive(key){
  document.querySelectorAll('#cashflowFilters .pill').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.key === key);
  });
}

async function render(pair){
  document.getElementById('cfRangeLabel').textContent = pair.label;
  document.getElementById('cfMinionyLabel').textContent =
    `${fmtDate(pair.miniony.start)} – ${fmtDate(pair.miniony.end)}`;
  document.getElementById('cfPrognozaLabel').textContent =
    `${fmtDate(pair.prognoza.start)} – ${fmtDate(pair.prognoza.end)}`;

  // Panele o które nikt nie pytał w danym widoku (np. porównanie z bieżącym
  // miesiącem przy planowaniu następnego) są tu tylko szumem — chowamy je.
  document.getElementById('cfMiniony').style.display = pair.mode === 'prognozaOnly' ? 'none' : '';
  document.getElementById('cfPrognoza').style.display = pair.mode === 'minionyOnly' ? 'none' : '';

  ['cfMiniony', 'cfPrognoza'].forEach(id=>{
    document.getElementById(id).querySelectorAll('.modal-stat-val').forEach(el=>el.textContent='…');
    document.getElementById(id).querySelectorAll('.cf-fv-breakdown').forEach(el=>el.innerHTML='');
  });
  document.querySelector('.cf-week-summary').querySelectorAll('.modal-stat-val').forEach(el=>el.textContent='…');
  document.getElementById('cfLiquidity').textContent = '';
  document.getElementById('cfMarketingRateInfo').textContent = '';

  const overrides = readOverrides();

  try{
    const [miniony, prognoza] = await Promise.all([
      getCashflowStats(pair.miniony.start, pair.miniony.end, overrides),
      getCashflowStats(pair.prognoza.start, pair.prognoza.end, overrides),
    ]);

    const costsOf = (s) => s.marketingCost + s.invoicesDue + s.returnsOutflow;
    const fvBreakdownHtml = (s) =>
      `<span class="cf-fv-tag cf-fv-so">ŚO: ${fmtPLN(s.invoicesWorkingCapital)}</span>` +
      `<span class="cf-fv-tag cf-fv-kup">KUP: ${fmtPLN(s.invoicesKup)}</span>`;
    const minionyCosts = costsOf(miniony);
    const prognozaCosts = costsOf(prognoza);

    const includeMiniony = pair.mode !== 'prognozaOnly';
    const includePrognoza = pair.mode !== 'minionyOnly';

    // Info diagnostyczne: jaka dzienna stawka marketingu została faktycznie
    // zastosowana (i z jakiej kolumny arkusza wzięta, jeśli był fallback) —
    // przydaje się, gdy koszt marketingu "nie zgadza się" z oczekiwaniami.
    const breakdownSources = [
      ...(includeMiniony ? miniony.marketingBreakdown : []),
      ...(includePrognoza ? prognoza.marketingBreakdown : []),
    ];
    const seenMonths = new Set();
    const mergedBreakdown = breakdownSources.filter(b=>{
      if(seenMonths.has(b.targetLabel)) return false;
      seenMonths.add(b.targetLabel);
      return true;
    });
    document.getElementById('cfMarketingRateInfo').textContent = mergedBreakdown.length
      ? 'Zastosowany koszt marketingu dziennie: ' + mergedBreakdown.map(b=>{
          const fallback = b.sourceLabel !== b.targetLabel ? ` (z braku danych za ${b.targetLabel} wzięto ${b.sourceLabel})` : '';
          return `${b.targetLabel}: ${fmtPLN(b.dailyRate)}/dzień [${fmtPLN(b.monthlyTotal)} ÷ ${b.days} dni]${fallback}`;
        }).join('  ·  ')
      : '';

    // Lewa kolumna "miniony": co było zaplanowane (te same koszty co po prawej,
    // bo koszty nie są prognozowane osobno — tylko przychód ma wariant plan/realizacja).
    const plannedBalance = miniony.plannedRevenue - minionyCosts;
    const realBalance = miniony.realRevenue - minionyCosts;
    const deviation = realBalance - plannedBalance;
    const deviationPct = plannedBalance !== 0 ? (deviation / Math.abs(plannedBalance) * 100) : 0;

    document.getElementById('cfPlannedMiniony').textContent = fmtPLN(miniony.plannedRevenue);
    document.getElementById('cfMarketingMinionyPlan').textContent = '- ' + fmtPLN(miniony.marketingCost);
    document.getElementById('cfInvoicesMinionyPlan').textContent = '- ' + fmtPLN(miniony.invoicesDue);
    document.getElementById('cfInvoicesMinionyPlanBreakdown').innerHTML = fvBreakdownHtml(miniony);
    document.getElementById('cfReturnsMinionyPlan').textContent = '- ' + fmtPLN(miniony.returnsOutflow);
    document.getElementById('cfPlannedBalance').textContent = fmtPLN(plannedBalance);

    document.getElementById('cfRealMiniony').textContent = fmtPLN(miniony.realRevenue);
    document.getElementById('cfMarketingMiniony').textContent = '- ' + fmtPLN(miniony.marketingCost);
    document.getElementById('cfInvoicesMiniony').textContent = '- ' + fmtPLN(miniony.invoicesDue);
    document.getElementById('cfInvoicesMinionyBreakdown').innerHTML = fvBreakdownHtml(miniony);
    document.getElementById('cfReturnsMiniony').textContent = '- ' + fmtPLN(miniony.returnsOutflow);
    document.getElementById('cfBalanceMiniony').textContent = fmtPLN(realBalance);

    document.getElementById('cfDeviation').textContent = `${fmtPLN(deviation)} (${deviationPct.toFixed(1)}%)`;
    document.getElementById('cfPromosMiniony').innerHTML = miniony.promoEvents.length
      ? miniony.promoEvents.map(p=>`${p.date}: ${p.label}`).join('<br>')
      : 'Brak promocji w tym okresie.';

    const netForecast = prognoza.plannedRevenue - prognozaCosts;

    document.getElementById('cfPlannedPrognoza').textContent = fmtPLN(prognoza.plannedRevenue);
    document.getElementById('cfInvoicesPrognoza').textContent = '- ' + fmtPLN(prognoza.invoicesDue);
    document.getElementById('cfInvoicesPrognozaBreakdown').innerHTML = fvBreakdownHtml(prognoza);
    document.getElementById('cfMarketingPrognoza').textContent = '- ' + fmtPLN(prognoza.marketingCost);
    document.getElementById('cfReservePrognoza').textContent = '- ' + fmtPLN(prognoza.returnsOutflow);
    document.getElementById('cfNetForecast').textContent = fmtPLN(netForecast);
    document.getElementById('cfPromosPrognoza').innerHTML = prognoza.promoEvents.length
      ? prognoza.promoEvents.map(p=>`${p.date}: ${p.label}`).join('<br>')
      : 'Brak zaplanowanych promocji.';

    // Podsumowanie całego okresu: w trybie 'both' łączy realizację (miniony)
    // z prognozą (przyszłość); w trybach jednopanelowych liczy tylko z
    // widocznej strony — schowana strona wnosi 0, więc liczby zostają spójne
    // (np. "zrealizowano dotąd: 0 zł" dla okresu, który jeszcze się nie zaczął).
    const fullRangeStart = includeMiniony ? pair.miniony.start : pair.prognoza.start;
    const fullRangeEnd = includePrognoza ? pair.prognoza.end : pair.miniony.end;
    document.getElementById('cfFullRangeLabel').textContent =
      `${fmtDate(fullRangeStart)} – ${fmtDate(fullRangeEnd)}`;

    const fullPlanned = (includeMiniony ? miniony.plannedRevenue : 0) + (includePrognoza ? prognoza.plannedRevenue : 0);
    const fullRealized = includeMiniony ? miniony.realRevenue : 0;
    const fullRemaining = includePrognoza ? prognoza.plannedRevenue : 0;
    document.getElementById('cfFullPlanned').textContent = fmtPLN(fullPlanned);
    document.getElementById('cfFullRealized').textContent = fmtPLN(fullRealized);
    document.getElementById('cfFullRemaining').textContent = fmtPLN(fullRemaining);

    const fullCostsPlanned = (includeMiniony ? minionyCosts : 0) + (includePrognoza ? prognozaCosts : 0);
    const fullCostsRealized = includeMiniony ? minionyCosts : 0;
    const fullCostsRemaining = includePrognoza ? prognozaCosts : 0;
    document.getElementById('cfFullCostsPlanned').textContent = '- ' + fmtPLN(fullCostsPlanned);
    document.getElementById('cfFullCostsRealized').textContent = '- ' + fmtPLN(fullCostsRealized);
    document.getElementById('cfFullCostsRemaining').textContent = '- ' + fmtPLN(fullCostsRemaining);

    const fullResult = (fullRealized + fullRemaining) - (fullCostsRealized + fullCostsRemaining);
    document.getElementById('cfFullResult').textContent = fmtPLN(fullResult);

    document.getElementById('cfLiquidity').innerHTML = fullResult >= 0
      ? '✅ Płynność finansowa zabezpieczona.'
      : '⚠️ Prognoza wskazuje ujemny bilans — możliwy problem z płynnością.';
    document.getElementById('cfLiquidity').style.color = fullResult >= 0 ? 'var(--sage)' : 'var(--rust)';

  } catch(err){
    document.getElementById('cfLiquidity').textContent = `Błąd pobierania danych (${err.message}).`;
    document.getElementById('cfLiquidity').style.color = 'var(--rust)';
  }
}

/* ---------- CASH-FLOW "2026" — miesiące i dni, plan i realizacja obok
   siebie. W odróżnieniu od Bilansu (tylko fakty), Cash-Flow zawsze ma PLAN —
   nawet dla przyszłości, to jego sens. REALIZACJA istnieje tylko dla
   okresów, które już się zaczęły (computeRealRevenue naturalnie zwraca 0 dla
   przyszłości) — dla okresów w całości przyszłych chowamy więc wiersze
   "fakt" i kolorujemy ramkę wg planu, tak jak robi to już tryb
   'prognozaOnly' filtrów w widoku tabelarycznym. Kolory/klasy (.sb-cal-*,
   .sb-year-*) współdzielone z Bilansem sprzedaży dla spójnego wyglądu. */
function cfCosts(s){ return s.marketingCost + s.invoicesDue + s.returnsOutflow; }

function cfTileRows(stats, isFuture){
  const costs = cfCosts(stats);
  const plannedBalance = stats.plannedRevenue - costs;
  const realBalance = stats.realRevenue - costs;
  const balance = isFuture ? plannedBalance : realBalance;
  const resultClass = balance >= 0 ? 'sb-cal-positive' : 'sb-cal-negative';
  const resultColor = balance >= 0 ? 'var(--sage)' : 'var(--rust)';

  const rows = [`<div class="sb-cal-row"><span>Sprzedaż plan</span><b>${fmtPLNCompact(stats.plannedRevenue)}</b></div>`];
  if(!isFuture) rows.push(`<div class="sb-cal-row"><span>Sprzedaż fakt</span><b>${fmtPLNCompact(stats.realRevenue)}</b></div>`);
  rows.push(`<div class="sb-cal-row sb-cal-gap"><span>Marketing</span><b>${fmtPLNCompact(stats.marketingCost)}</b></div>`);
  rows.push(`<div class="sb-cal-row"><span>Faktury FV</span><b>${fmtPLNCompact(stats.invoicesDue)}</b></div>`);
  rows.push(`<div class="sb-cal-row"><span>Zwroty</span><b>${fmtPLNCompact(stats.returnsOutflow)}</b></div>`);
  if(isFuture){
    rows.push(`<div class="sb-cal-row sb-cal-result"><span>Bilans plan</span><b style="color:${resultColor}">${fmtPLNCompact(plannedBalance)}</b></div>`);
  } else {
    rows.push(`<div class="sb-cal-row sb-cal-subtotal"><span>Bilans plan</span><b>${fmtPLNCompact(plannedBalance)}</b></div>`);
    rows.push(`<div class="sb-cal-row sb-cal-result"><span>Bilans fakt</span><b style="color:${resultColor}">${fmtPLNCompact(realBalance)}</b></div>`);
  }
  return { html: rows.join(''), resultClass };
}

export async function openCashflowYear(){
  navigateTo('screen-cashflow-year', 'Finanse · Cash-Flow · ' + CF_YEAR);
  const grid = document.getElementById('cfYearGrid');
  grid.innerHTML = '<p class="chart-loading">Ładowanie…</p>';

  const overrides = getPersistedOverrides();
  const today = startOfDay(new Date());
  const tiles = await Promise.all(MONTH_NAMES.map(async (name, idx) => {
    const start = new Date(CF_YEAR, idx, 1);
    const end = new Date(CF_YEAR, idx + 1, 0);
    const isFuture = start > today;
    const stats = await getCashflowStats(start, end, overrides);
    const { html, resultClass } = cfTileRows(stats, isFuture);
    const futureClass = isFuture ? ' sb-cal-future' : '';
    return `<div class="sb-year-cell ${resultClass}${futureClass}" onclick="openCashflowMonth(${idx})">
      <div class="sb-year-title">${name}</div>
      ${html}
    </div>`;
  }));

  grid.innerHTML = tiles.join('');
}

export async function openCashflowMonth(monthIndex){
  navigateTo('screen-cashflow-month', 'Finanse · Cash-Flow · ' + MONTH_NAMES[monthIndex] + ' ' + CF_YEAR);
  const el = document.getElementById('cfMonthCalendar');
  el.innerHTML = '<p class="chart-loading">Ładowanie…</p>';

  const overrides = getPersistedOverrides();
  const today = startOfDay(new Date());
  const totalDays = new Date(CF_YEAR, monthIndex + 1, 0).getDate();
  const firstWeekday = (new Date(CF_YEAR, monthIndex, 1).getDay() + 6) % 7; // 0=Pon

  const headerCells = WEEKDAY_NAMES.map(w => `<div class="sb-cal-weekday">${w}</div>`).join('');
  const leadingBlanks = Array.from({ length: firstWeekday }, () => '<div class="sb-cal-cell sb-cal-blank"></div>').join('');

  const dayCells = await Promise.all(Array.from({ length: totalDays }, async (_, i) => {
    const dayNum = i + 1;
    const day = new Date(CF_YEAR, monthIndex, dayNum);
    const isFuture = day > today;
    const isToday = day.getTime() === today.getTime();
    const stats = await getCashflowStats(day, day, overrides);
    const { html, resultClass } = cfTileRows(stats, isFuture);
    const stateClass = isFuture ? ' sb-cal-future' : (isToday ? ' sb-cal-today' : '');
    return `<div class="sb-cal-cell ${resultClass}${stateClass}">
      <div class="sb-cal-day">${dayNum}</div>
      ${html}
    </div>`;
  }));

  el.innerHTML = `
    <div class="sb-cal-grid">
      ${headerCells}
      ${leadingBlanks}
      ${dayCells.join('')}
    </div>
  `;
}
