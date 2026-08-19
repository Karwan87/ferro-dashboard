import { navigateTo } from '../../core/router.js';
import { fmtPLN, groupThousands } from '../../core/format.js';
import { getNumPref, setNumPref, getStrPref, setStrPref } from '../../core/prefs.js';
import {
  getSalesBalance, getMarketingBudgetForMonth, getPromoDayBudget, setPromoDayBudget,
  getPromoBudgetDefault, setPromoBudgetDefault, getOtherCostsForMonth, setOtherCostsForMonth,
  simulateResult, simulateRequiredMarketing, simulateRequiredSalesFromBudget,
  RETURNS_MODE_PURCHASE, RETURNS_MODE_REFUND,
} from '../../core/salesBalanceData.js';

const MONTH_NAMES = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];
const WEEKDAY_NAMES = ['Pon','Wt','Śr','Czw','Pt','Sob','Nd'];
const MONTHS_YEAR = 2026;

function startOfDay(d){ const x = new Date(d); x.setHours(0,0,0,0); return x; }
function fmtDatePl(d){ return d.toLocaleDateString('pl-PL'); }
function fmtMer(v){ return v == null ? '—' : v.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'x'; }
function fmtInt(v){ return v == null ? '—' : (v < 0 ? '-' : '') + groupThousands(String(Math.round(Math.abs(v)))); }
function fmtPct(v){ return v == null ? '—' : v.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'; }
// Kwota bez groszy — w gęstym kafelku kalendarza/roku precyzja co do grosza
// nie jest potrzebna, a każdy zaoszczędzony znak pomaga zmieścić wiersz w jednej linii.
function fmtPLNCompact(v){ return (v < 0 ? '-' : '') + groupThousands(String(Math.round(Math.abs(v)))) + ' zł'; }
function isoDate(d){ return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }

let currentPeriod = null; // { type:'month'|'year'|'range', start, end, label, year, monthIndex }
// Miesiąc, do którego ma wrócić "Wróć" po wejściu w pojedynczy dzień z kalendarza
// (patrz applySalesBalanceCalendarDay) — ekran dashboardu jest tym samym DOM-em
// dla widoku miesiąca i dnia, więc samo cofnięcie wpisu w historii nic by nie
// przywróciło; listener popstate niżej ręcznie odtwarza poprzedni stan.
let dayViewReturnPeriod = null;

/* Sposób przypisania zwrotu do miesiąca — trwale zapamiętany (obowiązuje na
   dashboardzie i na ekranie "2026"), przełączany pigułką w UI. Patrz
   RETURNS_MODE_PURCHASE/RETURNS_MODE_REFUND w core/salesBalanceData.js po
   dokładne wyjaśnienie różnicy. */
const RETURNS_MODE_PREF_KEY = 'sb.returnsMode';
let returnsMode = getStrPref(RETURNS_MODE_PREF_KEY, RETURNS_MODE_PURCHASE);

function syncReturnsModeToggle(){
  document.querySelectorAll('.sb-returns-mode-row .pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.returnsMode === returnsMode);
  });
}

export function applySalesBalanceReturnsMode(mode){
  returnsMode = mode;
  setStrPref(RETURNS_MODE_PREF_KEY, mode);
  if(document.getElementById('screen-sales-balance-dashboard')?.classList.contains('active')) render();
  else if(document.getElementById('screen-sales-balance-year')?.classList.contains('active')) renderYearGrid();
}

export function openSalesBalanceHub(){
  navigateTo('screen-sales-balance-periods', 'Bilans sprzedaży i marketing');
}

export function openSalesBalanceCurrentMonth(){
  const now = new Date();
  openSalesBalancePeriod('month', now.getFullYear(), now.getMonth());
}

/* Kafelek "2026" — zamiast jednej zbiorczej karty za cały rok, siatka 12
   kafelków miesięcy z tymi samymi liczbami co kafelek dnia w kalendarzu
   (MER, sprzedaż, marża, zwroty, sztuki, % zwrotów, marketing, pozostałe
   koszty, wynik), żeby od razu było widać, który miesiąc wypadł dobrze/źle. */
export function openSalesBalanceYear(){
  navigateTo('screen-sales-balance-year', 'Bilans sprzedaży i marketing · ' + MONTHS_YEAR);
  renderYearGrid();
}

async function renderYearGrid(){
  syncReturnsModeToggle();
  const grid = document.getElementById('sbYearGrid');
  grid.innerHTML = '<p class="chart-loading">Ładowanie…</p>';

  const now = new Date();
  const tiles = await Promise.all(MONTH_NAMES.map(async (name, idx) => {
    const isFuture = MONTHS_YEAR > now.getFullYear() || (MONTHS_YEAR === now.getFullYear() && idx > now.getMonth());
    if(isFuture) return `<div class="sb-year-cell sb-year-disabled">
      <span class="tile-soon">wkrótce</span>
      <div class="sb-year-title">${name}</div>
    </div>`;

    const { start, end } = computePeriodRange('month', MONTHS_YEAR, idx);
    const stats = await getSalesBalance(start, end, returnsMode);
    const resultClass = stats.financialResult >= 0 ? 'sb-cal-positive' : 'sb-cal-negative';
    const resultColor = stats.financialResult >= 0 ? 'var(--sage)' : 'var(--rust)';
    return `<div class="sb-year-cell ${resultClass}" onclick="openSalesBalancePeriod('month', ${MONTHS_YEAR}, ${idx})">
      <div class="sb-year-title">${name}</div>
      <div class="sb-cal-row"><span>MER</span><b style="color:${merColor(stats.mer)}">${fmtMer(stats.mer)}</b></div>
      <div class="sb-cal-row"><span>Sprzedaż</span><b>${fmtPLN(stats.salesNet)}</b></div>
      <div class="sb-cal-row"><span>Dostawy</span><b>${fmtPLN(stats.shippingNet)}</b></div>
      <div class="sb-cal-row"><span>Koszt tow.</span><b>${fmtPLN(stats.cogs)}</b></div>
      <div class="sb-cal-row"><span>Zwroty</span><b>${fmtPLN(stats.returnsNet)}</b></div>
      <div class="sb-cal-row"><span>Pomniejsz. zwr.</span><b>${fmtPLN(stats.restockValue)}</b></div>
      <div class="sb-cal-row sb-cal-subtotal"><span>Marża</span><b>${fmtPLN(stats.margin)}</b></div>
      <div class="sb-cal-row sb-cal-gap"><span>Szt. sprz./zwr.</span><b>${fmtInt(stats.qtySold)}/${fmtInt(stats.qtyReturned)} (${fmtPct(stats.returnRatePct)})</b></div>
      <div class="sb-cal-row sb-cal-gap"><span>Marketing</span><b>${fmtPLN(stats.marketingBudget)}</b></div>
      <div class="sb-cal-row"><span>Pozostałe</span><b>${fmtPLN(stats.otherCostsNet)}</b></div>
      <div class="sb-cal-row sb-cal-result"><span>Wynik</span><b style="color:${resultColor}">${fmtPLN(stats.financialResult)}</b></div>
    </div>`;
  }));

  grid.innerHTML = tiles.join('');
}

/* Przełączniki PILL na ekranie dashboardu (w odróżnieniu od kafelków huba/
   miesięcy) nie nawigują — tylko przeliczają bieżący ekran w miejscu, tak
   jak filtry w innych modułach (Zwroty, Cash-Flow, ...). */
export function applySalesBalancePreset(key){
  const now = new Date();
  if(key === 'currentMonth') setPeriodAndRender('month', now.getFullYear(), now.getMonth());
  else if(key === 'year') setPeriodAndRender('year', MONTHS_YEAR, null);
}

export function openSalesBalanceMonths(){
  const grid = document.getElementById('sbMonthsGrid');
  const now = new Date();
  grid.innerHTML = MONTH_NAMES.map((name, idx) => {
    const isFuture = MONTHS_YEAR > now.getFullYear() || (MONTHS_YEAR === now.getFullYear() && idx > now.getMonth());
    if(isFuture){
      return `<div class="tile disabled">
        <span class="tile-soon">wkrótce</span>
        <span class="tile-icon">🗓️</span>
        <p class="tile-name">${name} ${MONTHS_YEAR}</p>
        <p class="tile-desc">Dane pojawią się po rozpoczęciu tego miesiąca.</p>
      </div>`;
    }
    return `<div class="tile" onclick="openSalesBalancePeriod('month', ${MONTHS_YEAR}, ${idx})">
      <span class="tile-icon">🗓️</span>
      <p class="tile-name">${name} ${MONTHS_YEAR}</p>
      <p class="tile-desc">Bilans za ${name.toLowerCase()} ${MONTHS_YEAR}.</p>
    </div>`;
  }).join('');
  navigateTo('screen-sales-balance-months', 'Bilans sprzedaży i marketing · Miesiące ' + MONTHS_YEAR);
}

function computePeriodRange(type, year, monthIndex){
  const now = startOfDay(new Date());
  let start, end, label;
  if(type === 'month'){
    start = new Date(year, monthIndex, 1);
    const lastOfMonth = new Date(year, monthIndex + 1, 0);
    end = lastOfMonth < now ? lastOfMonth : now;
    label = MONTH_NAMES[monthIndex] + ' ' + year;
  } else {
    start = new Date(year, 0, 1);
    const lastOfYear = new Date(year, 11, 31);
    end = lastOfYear < now ? lastOfYear : now;
    label = String(year);
  }
  return { type, start, end, label, year, monthIndex };
}

function setPeriodAndRender(type, year, monthIndex){
  const now = new Date();
  dayViewReturnPeriod = null;
  currentPeriod = computePeriodRange(type, year, monthIndex);
  highlightPill(type === 'month' && year === now.getFullYear() && monthIndex === now.getMonth() ? 'currentMonth' : (type === 'year' ? 'year' : null));
  render();
}

/* Wejście z kafelków huba/miesięcy — dokłada wpis w historii ("Wróć" ma do
   czego wracać). Filtry pill NA ekranie dashboardu używają setPeriodAndRender
   bezpośrednio (patrz applySalesBalancePreset), bez nawigacji. */
export function openSalesBalancePeriod(type, year, monthIndex){
  navigateTo('screen-sales-balance-dashboard', 'Bilans sprzedaży i marketing · ' + computePeriodRange(type, year, monthIndex).label);
  setPeriodAndRender(type, year, monthIndex);
}

export function applySalesBalanceCustomRange(){
  const fromEl = document.getElementById('sbDateFrom');
  const toEl = document.getElementById('sbDateTo');
  if(!fromEl.value || !toEl.value) return;
  const start = startOfDay(new Date(fromEl.value));
  const end = startOfDay(new Date(toEl.value));
  currentPeriod = { type: 'range', start, end, label: `Zakres: ${fromEl.value} – ${toEl.value}` };
  highlightPill(null);
  render();
}

export function applySalesBalanceSingleDate(){
  const el = document.getElementById('sbDateSingle');
  if(!el.value) return;
  const day = startOfDay(new Date(el.value));
  currentPeriod = { type: 'range', start: day, end: day, label: fmtDatePl(day) };
  highlightPill(null);
  render();
}

function highlightPill(key){
  document.querySelectorAll('#sbFilters .pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.key === key);
  });
}

/* Zapis WYŁĄCZNIE na kliknięcie "Zapisz" (albo Enter) — NIE na każdy klawisz
   (oninput). Wcześniej oninput odpalał pełny render() przy każdej cyfrze, co
   przebudowywało całe pole (w tym to, w którym akurat się pisze) i zabierało
   mu fokus — trzeba było klikać z powrotem po każdej cyfrze. */
export async function applySalesBalancePromoOverride(dateKey){
  const input = document.getElementById('sbPromoInput_' + dateKey);
  const num = Number(input.value) || 0;
  await setPromoDayBudget(dateKey, num);
  render({ keepPromoEditor: true });
}

/* Kliknięcie kafelka dnia w kalendarzu — pokazuje bilans TEGO jednego dnia,
   tak samo jak ręczne wpisanie konkretnej daty w polu wyżej. Dokłada wpis do
   historii (ten sam ekran co widok miesiąca), żeby "Wróć" cofało do miesiąca,
   z którego wyszliśmy, a nie od razu do wyboru miesięcy — patrz listener
   popstate niżej, który faktycznie przywraca tamten widok. */
export function applySalesBalanceCalendarDay(dateKey){
  const day = startOfDay(new Date(dateKey));
  dayViewReturnPeriod = currentPeriod;
  navigateTo('screen-sales-balance-dashboard', fmtDatePl(day));
  currentPeriod = { type: 'range', start: day, end: day, label: fmtDatePl(day) };
  highlightPill(null);
  render();
}

window.addEventListener('popstate', () => {
  if(!dayViewReturnPeriod) return;
  const dashboard = document.getElementById('screen-sales-balance-dashboard');
  if(!dashboard || !dashboard.classList.contains('active')) return;
  currentPeriod = dayViewReturnPeriod;
  dayViewReturnPeriod = null;
  const now = new Date();
  highlightPill(currentPeriod.type === 'month' && currentPeriod.year === now.getFullYear() && currentPeriod.monthIndex === now.getMonth() ? 'currentMonth' : (currentPeriod.type === 'year' ? 'year' : null));
  render();
});

/* --------------------------------------------------------------------- */

/* keepPromoEditor:true — używane po zapisie POJEDYNCZEGO dnia promo
   (applySalesBalancePromoOverride/savePromoBudgetDefault). Pełny render()
   przebudowywał CAŁY panel promo od zera, więc jeśli ktoś miał już wpisane
   (ale jeszcze niezapisane) kwoty w innych, sąsiednich polach, zapis JEDNEGO
   pola kasował je z powrotem do wartości domyślnej. Z tą flagą zostawiamy
   DOM panelu promo w spokoju — reszta (statystyki, kalendarz, wykres) i tak
   przelicza się na nowo, bo te akurat NIE trzymają niezapisanego stanu. */
async function render(options = {}){
  const keepPromoEditor = options.keepPromoEditor || false;
  syncReturnsModeToggle();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  document.getElementById('sbDateSingle').max = isoDate(yesterday);

  const info = document.getElementById('sbRangeLabel');
  const marketingInfo = document.getElementById('sbMarketingInfo');
  const promoEditor = document.getElementById('sbPromoEditor');
  const calendar = document.getElementById('sbCalendar');
  const error = document.getElementById('sbError');
  const otherCostsField = document.getElementById('sbOtherCostsField');
  info.textContent = `${fmtDatePl(currentPeriod.start)} – ${fmtDatePl(currentPeriod.end)}`;
  error.textContent = '';
  marketingInfo.textContent = 'Ładowanie…';
  if(!keepPromoEditor) promoEditor.innerHTML = '';
  otherCostsField.innerHTML = '';
  calendar.innerHTML = currentPeriod.type === 'month' ? '<p class="chart-loading">Ładowanie kalendarza…</p>' : '';
  [
    'sbSalesGross','sbSalesNet','sbShippingGross','sbShippingNet','sbInflowGross','sbInflowNet',
    'sbCogs','sbMargin','sbReturnsGross','sbRestockValue','sbFinancialResult','sbMarketingDaily','sbMer',
  ].forEach(id => { document.getElementById(id).textContent = '…'; });
  document.getElementById('sbChart').innerHTML = '<p class="chart-loading">Ładowanie…</p>';

  try{
    const stats = await getSalesBalance(currentPeriod.start, currentPeriod.end, returnsMode);

    document.getElementById('sbSalesGross').textContent = fmtPLN(stats.salesGross);
    document.getElementById('sbSalesNet').textContent = fmtPLN(stats.salesNet);
    document.getElementById('sbShippingGross').textContent = fmtPLN(stats.shippingGross);
    document.getElementById('sbShippingNet').textContent = fmtPLN(stats.shippingNet);
    document.getElementById('sbInflowGross').textContent = fmtPLN(stats.inflowGross);
    document.getElementById('sbInflowNet').textContent = fmtPLN(stats.inflowNet);
    document.getElementById('sbCogs').textContent = fmtPLN(stats.cogs);
    document.getElementById('sbMargin').textContent = fmtPLN(stats.margin);
    document.getElementById('sbReturnsGross').textContent = fmtPLN(stats.returnsGross);
    document.getElementById('sbRestockValue').textContent = fmtPLN(stats.restockValue);
    document.getElementById('sbFinancialResult').textContent = fmtPLN(stats.financialResult);
    document.getElementById('sbFinancialResult').style.color = stats.financialResult >= 0 ? 'var(--sage)' : 'var(--rust)';
    const daysCount = stats.series.length;
    document.getElementById('sbMarketingDaily').textContent =
      daysCount > 0 ? fmtPLN(stats.marketingBudget / daysCount) + ' / dzień' : '—';
    document.getElementById('sbMer').textContent = fmtMer(stats.mer);

    marketingInfo.textContent = stats.marketingMonths.length
      ? 'Budżet marketingu wzięty pod uwagę: ' + stats.marketingMonths.map(m => {
          const fallback = m.sourceLabel !== m.targetLabel ? ` (z braku danych za ${m.targetLabel} wzięto ${m.sourceLabel})` : '';
          return `${m.targetLabel}: ${fmtPLN(m.monthlyTotal)} na cały miesiąc [${m.promoDates.length} dni promo × śr. ${fmtPLN(m.promoBudgetTotal / (m.promoDates.length || 1))}, reszta ${fmtPLN(m.nonPromoDailyRate)}/dzień]${fallback}`;
        }).join('  ·  ')
      : 'Brak danych o budżecie marketingu w tym okresie.';

    if(currentPeriod.type === 'month'){
      const budget = await getMarketingBudgetForMonth(currentPeriod.year, currentPeriod.monthIndex);
      if(!keepPromoEditor) renderPromoEditor(budget);
      renderCalendar(currentPeriod.year, currentPeriod.monthIndex, stats.series, new Set(budget.promoDates));
      await renderOtherCostsField(currentPeriod.year, currentPeriod.monthIndex);
    } else {
      calendar.innerHTML = '';
    }

    renderChart(stats.series);
  } catch(err){
    error.textContent = `Nie udało się pobrać danych (${err.message}). Sprawdź, czy arkusze Ordery/Marketing/Promocje są udostępnione kontu serwisowemu.`;
    marketingInfo.textContent = '';
    calendar.innerHTML = '';
    document.getElementById('sbChart').innerHTML = '';
  }
}

/* Pola tekstowe (nie type="number") — bez strzałek góra/dół, i tak, żeby
   dało się wpisać kilka cyfr ciągiem: zapis dopiero na "Zapisz"/Enter, nie
   na każdy znak (patrz applySalesBalancePromoOverride/savePromoBudgetDefault). */
function renderPromoEditor(budget){
  const el = document.getElementById('sbPromoEditor');
  const defaultRow = `
    <div class="sb-promo-default-row">
      <label for="sbPromoBudgetDefault">Domyślna kwota (dla dat promo bez własnego ustawienia)</label>
      <input type="text" inputmode="numeric" class="finance-date-input" id="sbPromoBudgetDefault" value="${getPromoBudgetDefault()}"
        onkeydown="if(event.key==='Enter') savePromoBudgetDefault()">
      <button class="sim-save-default" onclick="savePromoBudgetDefault()">Zapisz jako domyślne</button>
    </div>
  `;
  if(budget.promoDates.length === 0){
    el.innerHTML = defaultRow + '<p class="finance-range-label">Brak dni promocyjnych w tym miesiącu (wg arkusza Promocje).</p>';
    return;
  }
  el.innerHTML = defaultRow + `
    <p class="finance-range-label">Budżet dni promocyjnych — każda data pamiętana osobno (edycja przelicza średnią dzienną dla reszty miesiąca):</p>
    <div class="sb-promo-list">
      ${budget.promoDates.map(dateKey => {
        const amount = budget.promoDayBudgets.get(dateKey);
        const d = new Date(dateKey);
        return `<div class="sb-promo-row">
          <span>${fmtDatePl(d)}</span>
          <input type="text" inputmode="numeric" class="finance-date-input sb-promo-input" id="sbPromoInput_${dateKey}" value="${amount}"
            onkeydown="if(event.key==='Enter') applySalesBalancePromoOverride('${dateKey}')">
          <button class="sim-save-default" onclick="applySalesBalancePromoOverride('${dateKey}')">Zapisz</button>
        </div>`;
      }).join('')}
    </div>
  `;
}

export async function savePromoBudgetDefault(){
  const value = Number(document.getElementById('sbPromoBudgetDefault').value) || 0;
  await setPromoBudgetDefault(value);
  render({ keepPromoEditor: true });
}

/* "Pozostałe koszty" (kafelek Marketing/MER/wynik) — pole edytowalne "z łapy",
   domyślnie wypełnione sumą wybranych wierszy arkusza V2 dla danego miesiąca
   (patrz getOtherCostsForMonth). Wpisywana/domyślna kwota jest NETTO — w V2
   część tych wierszy jest brutto, a wiersz 25 (WYPŁATY) już netto, więc
   jedyna spójna wspólna podstawa do ręcznej edycji to netto; przeliczenie mieszanych
   wierszy na netto dzieje się już przy liczeniu domyślnej wartości
   (getOtherCostsSheetDefault), nie tutaj. Pole dostępne tylko w widoku
   miesiąca, bo wartość z V2 dotyczy zawsze konkretnego miesiąca — dla
   zakresu/dnia liczy się mimo to poprawnie w tle (rozbita na dzienną stawkę),
   tylko bez edycji z tego ekranu. */
async function renderOtherCostsField(year, monthIndex){
  const el = document.getElementById('sbOtherCostsField');
  const { value, computedDefault } = await getOtherCostsForMonth(year, monthIndex);
  el.innerHTML = `
    <div class="modal-stat-label">Pozostałe koszty (netto)</div>
    <input type="number" class="finance-date-input sb-other-costs-input" id="sbOtherCosts" step="10" value="${value}"
      oninput="applySalesBalanceOtherCosts(${year}, ${monthIndex}, this.value)">
    <div class="sim-default-hint">domyślnie z V2 (netto): ${fmtPLN(computedDefault)}</div>
  `;
}

export function applySalesBalanceOtherCosts(year, monthIndex, value){
  setOtherCostsForMonth(year, monthIndex, Number(value) || 0);
  render();
}

/* Kolor MER: poniżej progu "na zero" (6x) zawsze pomarańczowy (niezależnie
   jak nisko) — poniżej tego progu appka i tak sygnalizuje "uwaga", więc
   dalsze schodzenie w czerwień nic by nie dodało. Od 6x w górę płynne przejście
   pomarańczowy -> zielony, nasycenie rośnie do 10x (powyżej — pełna zieleń). */
const MER_WARN_THRESHOLD = 6;
const MER_GREAT_THRESHOLD = 10;
function merColor(mer){
  if(mer == null) return '#8A8272';
  if(mer < MER_WARN_THRESHOLD) return '#C97A2A';
  const t = Math.min(1, (mer - MER_WARN_THRESHOLD) / (MER_GREAT_THRESHOLD - MER_WARN_THRESHOLD));
  const from = [201, 122, 42];   // pomarańczowy
  const to = [58, 140, 80];      // wyrazista zieleń
  const rgb = from.map((c, i) => Math.round(c + (to[i] - c) * t));
  return `rgb(${rgb.join(',')})`;
}

/* ---------- kalendarz miesiąca — kafelek na każdy dzień z kluczowymi
   liczbami (MER, sprzedaż, marża, zwroty, marketing, pozostałe koszty, wynik).
   Dni przyszłe
   (poza zebranymi danymi, bo currentPeriod.end nie wychodzi poza "dziś")
   pokazują tylko numer dnia, wyszarzone. Dni z promocją (wg arkusza Promocje)
   mają niebieskawe tło, niezależnie od wyniku dnia. ---------- */
function renderCalendar(year, monthIndex, series, promoDatesSet){
  const el = document.getElementById('sbCalendar');
  const byDate = new Map(series.map(r => [r.dateKey, r]));
  const totalDays = new Date(year, monthIndex + 1, 0).getDate();
  const firstWeekday = (new Date(year, monthIndex, 1).getDay() + 6) % 7; // 0=Pon
  const todayKey = isoDate(new Date());

  const headerCells = WEEKDAY_NAMES.map(w => `<div class="sb-cal-weekday">${w}</div>`).join('');
  const leadingBlanks = Array.from({ length: firstWeekday }, () => '<div class="sb-cal-cell sb-cal-blank"></div>').join('');

  const dayCells = Array.from({ length: totalDays }, (_, i) => {
    const dayNum = i + 1;
    const dateKey = year + '-' + String(monthIndex + 1).padStart(2, '0') + '-' + String(dayNum).padStart(2, '0');
    const r = byDate.get(dateKey);
    const promoClass = promoDatesSet.has(dateKey) ? ' sb-cal-promo' : '';
    if(!r){
      return `<div class="sb-cal-cell sb-cal-empty${promoClass}"><div class="sb-cal-day">${dayNum}</div></div>`;
    }
    // Dziś — dane w trakcie dnia, jeszcze niepełne, więc kolor wyniku nie jest
    // ostateczny (patrz .sb-cal-today w finance.css, nadpisuje ramkę na szaro).
    const todayClass = dateKey === todayKey ? ' sb-cal-today' : '';
    const resultClass = r.financialResult >= 0 ? 'sb-cal-positive' : 'sb-cal-negative';
    const resultColor = r.financialResult >= 0 ? 'var(--sage)' : 'var(--rust)';
    return `<div class="sb-cal-cell ${resultClass}${promoClass}${todayClass}" onclick="applySalesBalanceCalendarDay('${dateKey}')">
      <div class="sb-cal-day">${dayNum}</div>
      <div class="sb-cal-row"><span>MER</span><b style="color:${merColor(r.mer)}">${fmtMer(r.mer)}</b></div>
      <div class="sb-cal-row"><span>Sprzedaż</span><b>${fmtPLNCompact(r.salesNet)}</b></div>
      <div class="sb-cal-row"><span>Dostawy</span><b>${fmtPLNCompact(r.shippingNet)}</b></div>
      <div class="sb-cal-row"><span>Koszt tow.</span><b>${fmtPLNCompact(r.cogs)}</b></div>
      <div class="sb-cal-row"><span>Zwroty</span><b>${fmtPLNCompact(r.returnsNet)}</b></div>
      <div class="sb-cal-row"><span>Pomniejsz. zwr.</span><b>${fmtPLNCompact(r.restockValue)}</b></div>
      <div class="sb-cal-row sb-cal-subtotal"><span>Marża</span><b>${fmtPLNCompact(r.margin)}</b></div>
      <div class="sb-cal-row sb-cal-gap"><span>Szt. sprz./zwr.</span><b>${fmtInt(r.qtySold)}/${fmtInt(r.qtyReturned)} (${fmtPct(r.returnRatePct)})</b></div>
      <div class="sb-cal-row sb-cal-gap"><span>Marketing</span><b>${fmtPLNCompact(r.marketingBudget)}</b></div>
      <div class="sb-cal-row"><span>Pozostałe</span><b>${fmtPLNCompact(r.otherCostsNet)}</b></div>
      <div class="sb-cal-row sb-cal-result"><span>Wynik</span><b style="color:${resultColor}">${fmtPLNCompact(r.financialResult)}</b></div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <p class="finance-range-label sb-cal-note">Wszystkie kwoty w kalendarzu są netto (bez VAT).</p>
    <div class="sb-cal-grid">
      ${headerCells}
      ${leadingBlanks}
      ${dayCells}
    </div>
  `;
}

/* ---------- wykres MER w czasie — dzienne punkty dla krótszych okresów,
   miesięczne (sumy → iloraz sum, nie średnia z procentów) dla dłuższych. ---------- */
function bucketSeriesForChart(series){
  if(series.length <= 45){
    return series.map(r => ({ label: r.dateKey.slice(5), mer: r.mer }));
  }
  const byMonth = new Map();
  series.forEach(r => {
    const key = r.date.getFullYear() + '-' + String(r.date.getMonth() + 1).padStart(2, '0');
    if(!byMonth.has(key)) byMonth.set(key, { salesNet: 0, marketingBudget: 0 });
    const b = byMonth.get(key);
    b.salesNet += r.salesNet;
    b.marketingBudget += r.marketingBudget;
  });
  return [...byMonth.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([key, b]) => ({
    label: MONTH_NAMES[parseInt(key.slice(5), 10) - 1].slice(0, 3),
    mer: b.marketingBudget > 0 ? b.salesNet / b.marketingBudget : null,
  }));
}

const VB_W = 720, VB_H = 200;
const M_LEFT = 46, M_RIGHT = 14, M_TOP = 14, M_BOTTOM = 26;
const PLOT_W = VB_W - M_LEFT - M_RIGHT;
const PLOT_H = VB_H - M_TOP - M_BOTTOM;

function niceMax(max){
  if(max <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const norm = max / pow;
  let niceNorm;
  if(norm <= 1) niceNorm = 1;
  else if(norm <= 2) niceNorm = 2;
  else if(norm <= 5) niceNorm = 5;
  else niceNorm = 10;
  return niceNorm * pow;
}

function renderChart(series){
  const container = document.getElementById('sbChart');
  const points = bucketSeriesForChart(series).filter(p => p.mer != null);
  if(points.length === 0){
    container.innerHTML = '<p class="empty-state">Brak danych do wyliczenia MER w tym okresie (brak budżetu marketingu lub sprzedaży).</p>';
    return;
  }

  const maxVal = niceMax(Math.max(...points.map(p => p.mer), 0));
  const xAt = i => M_LEFT + (points.length <= 1 ? PLOT_W / 2 : (i / (points.length - 1)) * PLOT_W);
  const yAt = v => M_TOP + PLOT_H - (maxVal === 0 ? 0 : v / maxVal) * PLOT_H;

  const GRID_TICKS = 4;
  let gridMarkup = '';
  for(let t = 0; t <= GRID_TICKS; t++){
    const y = M_TOP + PLOT_H - (t / GRID_TICKS) * PLOT_H;
    gridMarkup += `<line x1="${M_LEFT}" y1="${y}" x2="${VB_W - M_RIGHT}" y2="${y}" stroke="#E4DCC9" stroke-width="1"/>`;
    gridMarkup += `<text x="${M_LEFT - 8}" y="${y + 4}" text-anchor="end" class="chart-axis-label">${(maxVal * t / GRID_TICKS).toFixed(1)}x</text>`;
  }

  const xIdxs = points.length <= 6 ? points.map((_, i) => i) : [0, Math.floor((points.length - 1) / 2), points.length - 1];
  let xLabelMarkup = '';
  xIdxs.forEach(i => {
    xLabelMarkup += `<text x="${xAt(i)}" y="${VB_H - 6}" text-anchor="middle" class="chart-axis-label">${points[i].label}</text>`;
  });

  const line = points.map((p, i) => `${xAt(i)},${yAt(p.mer)}`).join(' ');
  const markers = points.map((p, i) => `<circle cx="${xAt(i)}" cy="${yAt(p.mer)}" r="3.5" fill="var(--gold)" class="chart-marker"/>`).join('');

  container.innerHTML = `
    <div class="chart-svg-wrap">
      <svg viewBox="0 0 ${VB_W} ${VB_H}" class="stock-chart-svg" preserveAspectRatio="xMidYMid meet">
        ${gridMarkup}
        <polyline points="${line}" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        ${markers}
        ${xLabelMarkup}
        <rect class="chart-hover-capture" x="${M_LEFT}" y="0" width="${PLOT_W}" height="${VB_H}" fill="transparent"/>
        <line class="chart-crosshair" x1="0" y1="${M_TOP}" x2="0" y2="${M_TOP + PLOT_H}" opacity="0"/>
      </svg>
      <div class="chart-tooltip" hidden></div>
    </div>
  `;
  attachChartHover(container, points, xAt);
}

function attachChartHover(container, points, xAt){
  const wrap = container.querySelector('.chart-svg-wrap');
  const svg = container.querySelector('.stock-chart-svg');
  const capture = container.querySelector('.chart-hover-capture');
  const crosshair = container.querySelector('.chart-crosshair');
  const tooltip = container.querySelector('.chart-tooltip');
  if(!capture) return;

  function update(clientX){
    const svgRect = svg.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const scaleX = VB_W / svgRect.width;
    const localX = (clientX - svgRect.left) * scaleX;
    let idx = points.length <= 1 ? 0 : Math.round(((localX - M_LEFT) / PLOT_W) * (points.length - 1));
    idx = Math.max(0, Math.min(points.length - 1, idx));

    const xPix = xAt(idx);
    crosshair.setAttribute('x1', xPix);
    crosshair.setAttribute('x2', xPix);
    crosshair.setAttribute('opacity', '1');

    tooltip.innerHTML = `<div class="tooltip-date">${points[idx].label}</div>
      <div class="tooltip-row"><span class="tooltip-label">MER</span><strong class="tooltip-val">${fmtMer(points[idx].mer)}</strong></div>`;
    tooltip.hidden = false;

    const pixelX = (xPix / VB_W) * svgRect.width + (svgRect.left - wrapRect.left);
    const tooltipWidth = tooltip.offsetWidth || 100;
    tooltip.style.left = Math.max(4, Math.min(wrapRect.width - tooltipWidth - 4, pixelX + 10)) + 'px';
    tooltip.style.top = '6px';
  }

  capture.addEventListener('mousemove', e => update(e.clientX));
  capture.addEventListener('mouseleave', () => {
    crosshair.setAttribute('opacity', '0');
    tooltip.hidden = true;
  });
}

/* ---------- SYMULACJA ---------- */
let simMode = 'result'; // 'result' = podaj budżet -> wynik | 'budget' = podaj docelowy wynik -> budżet

/* Wartości domyślne inputów symulacji — trwale zapamiętane w przeglądarce
   (core/prefs.js), edytowalne z UI przyciskiem "Zapisz jako domyślne" przy
   każdym polu, bez potrzeby zmian w kodzie. unit steruje tylko formatowaniem
   podpowiedzi ("domyślnie: ..."), nie wpływa na przeliczenia. */
/* Wartości skalibrowane na realnych, już poprawionych (w pełni netto) danych
   marca 2026 z kafelka "2026" — cogsPct/returnsPct liczone względem sprzedaży
   BRUTTO (tak, jak wymaga tego wzór symulacji: cogs = salesGross × cogsPct/100),
   recoveryPct liczone jako Restock netto ÷ Zwroty netto. simShippingRevenue i
   simOtherCosts to odpowiedniki brutto marcowych wartości netto (× VAT_RATE),
   bo te pola w symulacji przyjmują brutto i same dzielą przez VAT_RATE —
   przez to dokładnie odtwarzają marcowe kwoty netto po przeliczeniu.
   Z targetResult=0 wychodzi budżet marketingu ok. 205 tys. zł (o ~42 tys. zł
   więcej niż realnie wydane 163 tys. zł w marcu — bo marzec faktycznie
   zamknął się na plusie 42 235,33 zł, więc "na zero" jest miejsce na
   wyższy budżet). */
const SIM_FIELDS = {
  simSalesGross:      { key: 'sim.salesGross',      fallback: 1390000, unit: 'zl' },
  simCogsPct:         { key: 'sim.cogsPct',          fallback: 46.8,    unit: 'pct' },
  simReturnsPct:       { key: 'sim.returnsPct',       fallback: 30.6,    unit: 'pct' },
  simRecoveryPct:      { key: 'sim.recoveryPct',      fallback: 58.1,    unit: 'pct' },
  simShippingRevenue:  { key: 'sim.shippingRevenue',  fallback: 52576,   unit: 'zl' },
  simOtherCosts:       { key: 'sim.otherCosts',        fallback: 211789,  unit: 'zl' },
  simMarketingBudget:  { key: 'sim.marketingBudget',  fallback: 163000,  unit: 'zl' },
  simTargetResult:     { key: 'sim.targetResult',     fallback: 0,       unit: 'zl' },
  simTargetMer:        { key: 'sim.targetMer',        fallback: 10,      unit: 'x' },
};

function fmtDefaultHint(value, unit){
  if(unit === 'pct') return value + '%';
  if(unit === 'x') return value.toFixed(1) + 'x';
  return fmtPLN(value);
}

function refreshSimDefaultHint(inputId){
  const cfg = SIM_FIELDS[inputId];
  const el = document.getElementById(inputId + 'Default');
  if(el) el.textContent = 'domyślnie: ' + fmtDefaultHint(getNumPref(cfg.key, cfg.fallback), cfg.unit);
}

export function saveSimDefault(inputId){
  const cfg = SIM_FIELDS[inputId];
  const value = Number(document.getElementById(inputId).value) || 0;
  setNumPref(cfg.key, value);
  refreshSimDefaultHint(inputId);
}

/* Kluczowe założenia (koszt towaru, zwroty, odzysk) — osobny kafelek NAD
   resztą formularza, zablokowany do edycji domyślnie (to wskaźniki, od
   których najbardziej zależy wynik symulacji, więc przypadkowa literówka
   tu boli najbardziej). "Edytuj" odblokowuje pola, "Reset" przywraca
   wartości skalibrowane na realnych danych marca 2026 (SIM_FIELDS fallback). */
const SIM_KEY_FIELD_IDS = ['simCogsPct', 'simReturnsPct', 'simRecoveryPct'];
let simKeyUnlocked = false;

export function toggleSimKeyEdit(){
  simKeyUnlocked = !simKeyUnlocked;
  SIM_KEY_FIELD_IDS.forEach(id => { document.getElementById(id).disabled = !simKeyUnlocked; });
  document.getElementById('simKeyEditBtn').textContent = simKeyUnlocked ? 'Zablokuj' : 'Edytuj';
}

export function applySimKeyInput(inputId, value){
  setNumPref(SIM_FIELDS[inputId].key, Number(value) || 0);
  runSimulation();
}

export function resetSimKeyAssumptions(){
  SIM_KEY_FIELD_IDS.forEach(id => {
    const value = SIM_FIELDS[id].fallback;
    document.getElementById(id).value = value;
    setNumPref(SIM_FIELDS[id].key, value);
  });
  runSimulation();
}

export function openSalesBalanceSimulation(){
  navigateTo('screen-sales-balance-simulation', 'Bilans sprzedaży i marketing · Symulacja');
  Object.entries(SIM_FIELDS).forEach(([inputId, cfg]) => {
    document.getElementById(inputId).value = getNumPref(cfg.key, cfg.fallback);
    refreshSimDefaultHint(inputId);
  });
  simKeyUnlocked = false;
  SIM_KEY_FIELD_IDS.forEach(id => { document.getElementById(id).disabled = true; });
  document.getElementById('simKeyEditBtn').textContent = 'Edytuj';
  applySalesBalanceSimMode('result');
}

export function applySalesBalanceSimMode(mode){
  simMode = mode;
  document.querySelectorAll('#simModeFilters .pill').forEach(btn => btn.classList.toggle('active', btn.dataset.key === mode));
  document.getElementById('simSalesGrossRow').style.display = mode === 'sales' ? 'none' : '';
  document.getElementById('simTargetMerRow').style.display = mode === 'sales' ? '' : 'none';
  document.getElementById('simMarketingBudgetRow').style.display = mode === 'budget' ? 'none' : '';
  document.getElementById('simTargetResultRow').style.display = mode === 'budget' ? '' : 'none';
  runSimulation();
}

function fmtOrDash(v){ return v == null ? '—' : fmtPLN(v); }

export function runSimulation(){
  const num = id => Number(document.getElementById(id).value) || 0;
  const shared = {
    cogsPct: num('simCogsPct'),
    returnsPct: num('simReturnsPct'),
    returnsCogsRecoveryPct: num('simRecoveryPct'),
    shippingRevenueGross: num('simShippingRevenue'),
    otherCostsGross: num('simOtherCosts'),
  };

  let r, salesGrossDisplay;
  if(simMode === 'result'){
    salesGrossDisplay = num('simSalesGross');
    r = simulateResult({ ...shared, salesGross: salesGrossDisplay, marketingBudget: num('simMarketingBudget') });
  } else if(simMode === 'budget'){
    salesGrossDisplay = num('simSalesGross');
    r = simulateRequiredMarketing({ ...shared, salesGross: salesGrossDisplay, targetResult: num('simTargetResult') });
  } else {
    r = simulateRequiredSalesFromBudget({ ...shared, targetMer: num('simTargetMer'), marketingBudget: num('simMarketingBudget') });
    salesGrossDisplay = r.salesGross;
  }

  document.getElementById('simSalesGrossResult').textContent = fmtOrDash(salesGrossDisplay);
  document.getElementById('simSalesNet').textContent = fmtOrDash(r.salesNet);
  document.getElementById('simShippingRevenueNet').textContent = fmtOrDash(r.shippingRevenueNet);
  document.getElementById('simCogsResult').textContent = fmtOrDash(r.cogs);
  document.getElementById('simReturnsOutflow').textContent = fmtOrDash(r.returnsOutflowNet);
  document.getElementById('simReturnsRecovery').textContent = fmtOrDash(r.returnsCogsRecovery);
  document.getElementById('simOtherCostsResult').textContent = fmtOrDash(r.otherCostsNet);
  document.getElementById('simMarketingBudgetResult').textContent = fmtOrDash(r.marketingBudget);
  document.getElementById('simFinancialResult').textContent = fmtOrDash(r.result ?? r.targetResult);
  document.getElementById('simMer').textContent = fmtMer(r.mer);

  const resultEl = document.getElementById('simResultValue');
  if(simMode === 'result'){
    document.getElementById('simResultLabel').textContent = 'Wynik finansowy';
    resultEl.textContent = fmtPLN(r.result);
    resultEl.style.color = r.result >= 0 ? 'var(--sage)' : 'var(--rust)';
  } else if(simMode === 'budget'){
    document.getElementById('simResultLabel').textContent = 'Maksymalny budżet marketingu';
    resultEl.textContent = fmtPLN(r.marketingBudget);
    resultEl.style.color = r.marketingBudget >= 0 ? 'var(--sage)' : 'var(--rust)';
  } else {
    document.getElementById('simResultLabel').textContent = 'Wymagana sprzedaż brutto';
    resultEl.textContent = fmtPLN(r.salesGross);
    resultEl.style.color = '';
  }
}
