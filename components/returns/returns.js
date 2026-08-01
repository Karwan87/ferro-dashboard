import { navigateTo } from '../../core/router.js';
import { getReturnedProducts, getSuppliersRanking, getSupplierProducts, getStoreWideIndicator, getSettlement, getProductReturnDetail } from '../../core/returnsData.js';
import { fmtPLN, imgUrl, PLACEHOLDER } from '../../core/format.js';
import { openModal } from '../../core/modal.js';

const MONTH_NAMES = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];
const MONTHS_YEAR = 2026;

/* Okresy dostępne dla raportów zwrotów — cały rok 2026 + 12 miesięcy 2026
   (dodane niżej), każdy prowadzi do tych samych 3 raportów (produkt/dostawca/
   wskaźnik). Świadomie NIE ma tu ruchomych okien "ostatnie N dni" — zawsze
   obejmują zakupy sprzed <14 dni, które fizycznie nie zdążyły jeszcze wrócić
   (klient ma 14 dni na zwrot), więc sztucznie zaniżały % zwrotów. Miesiące
   kalendarzowe nie mają tego problemu, poza samym bieżącym miesiącem — stąd
   ostrzeżenie doklejane w reportach dla bieżącego miesiąca, patrz niżej. */
const PERIOD_DEFS = {
  y2026:{ label:'2026',            period:{ type:'year', year:2026 } },
};
MONTH_NAMES.forEach((name, idx)=>{
  PERIOD_DEFS['m' + (idx + 1)] = { label: name + ' ' + MONTHS_YEAR, period:{ type:'month', year:MONTHS_YEAR, month:idx } };
});

function isCurrentMonthPeriod(period){
  const now = new Date();
  return period.type === 'month' && period.year === now.getFullYear() && period.month === now.getMonth();
}

const CURRENT_MONTH_NOTE = 'Bieżący miesiąc jeszcze się "domyka" — klienci mają 14 dni na zwrot, więc wynik będzie się zmieniał (na ogół w dół) mniej więcej do połowy przyszłego miesiąca.';

export function openReturnsCurrentMonth(){
  const now = new Date();
  openReturnsPeriod('m' + (now.getMonth() + 1));
}

let currentPeriodKey = null;
let currentSupplierRows = [];

export function openReturnsHub(){
  navigateTo('screen-returns-periods', 'Zwroty');
}

export function openReturnsMonths(){
  renderMonthTiles();
  navigateTo('screen-returns-months', 'Zwroty · Miesiące ' + MONTHS_YEAR);
}

function renderMonthTiles(){
  const grid = document.getElementById('returnsMonthsGrid');
  const now = new Date();
  grid.innerHTML = MONTH_NAMES.map((name, idx)=>{
    const isFuture = MONTHS_YEAR > now.getFullYear() || (MONTHS_YEAR === now.getFullYear() && idx > now.getMonth());
    if(isFuture){
      return `<div class="tile disabled">
        <span class="tile-soon">wkrótce</span>
        <span class="tile-icon">🗓️</span>
        <p class="tile-name">${name} ${MONTHS_YEAR}</p>
        <p class="tile-desc">Dane pojawią się po rozpoczęciu tego miesiąca.</p>
      </div>`;
    }
    return `<div class="tile" onclick="openReturnsPeriod('m${idx + 1}')">
      <span class="tile-icon">🗓️</span>
      <p class="tile-name">${name} ${MONTHS_YEAR}</p>
      <p class="tile-desc">Zwroty za ${name.toLowerCase()} ${MONTHS_YEAR}.</p>
    </div>`;
  }).join('');
}

export function openReturnsPeriod(periodKey){
  currentPeriodKey = periodKey;
  navigateTo('screen-returns-category', 'Zwroty · ' + PERIOD_DEFS[periodKey].label);
}

function periodDef(){
  return PERIOD_DEFS[currentPeriodKey];
}

/* ---------- RAPORT 1: najczęściej zwracany produkt ---------- */
export async function openReturnsProducts(){
  navigateTo('screen-returns-table', 'Najczęściej zwracany produkt · ' + periodDef().label);
  const tbody = document.getElementById('retTableBody');
  const totalsEl = document.getElementById('retTableTotals');
  totalsEl.style.display = 'none';
  totalsEl.innerHTML = '';
  document.getElementById('retTableInfo').textContent = 'Ładowanie…';
  document.getElementById('retTableHeadRow').innerHTML =
    `<th class="rank sticky-col"></th><th class="identity-col sticky-col">Produkt</th><th data-key="qty">Zwrócone szt.</th>`;
  tbody.innerHTML = `<tr><td colspan="3" class="empty-state">Ładowanie…</td></tr>`;

  try{
    const { rows, totals } = await getReturnedProducts(periodDef().period);
    totalsEl.innerHTML = `
      <div><div class="modal-stat-label">Utracona marża · ${periodDef().label}</div><div class="modal-stat-val">${fmtPLN(totals.lostMargin)}</div></div>
      <div><div class="modal-stat-label">Wartość wrócona na stan</div><div class="modal-stat-val">${fmtPLN(totals.restockValue)}</div></div>
    `;
    totalsEl.style.display = 'grid';
    document.getElementById('retTableInfo').textContent = `${rows.length} produktów · sortowanie: zwrócone sztuki malejąco`
      + (isCurrentMonthPeriod(periodDef().period) ? ` · ${CURRENT_MONTH_NOTE}` : '');
    if(rows.length === 0){
      tbody.innerHTML = `<tr><td colspan="3" class="empty-state">Brak zwrotów w tym okresie.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((r, i)=>{
      const p = r.product;
      const thumb = imgUrl(p.img) || PLACEHOLDER;
      return `<tr onclick="openReturnsProductModal(${p.id})">
        <td class="rank sticky-col">${i + 1}</td>
        <td class="identity-col sticky-col">
          <div class="prod-cell">
            <img class="prod-thumb" src="${thumb}" referrerpolicy="no-referrer" onerror="this.src='${PLACEHOLDER}'">
            <div>
              <div class="prod-name">${p.name}</div>
              <div class="prod-id">ID ${p.id}${p.kod ? ' · ' + p.kod : ''}</div>
            </div>
          </div>
        </td>
        <td class="num">${r.returnedQty}</td>
      </tr>`;
    }).join('');
  } catch(err){
    renderTableError(err, 3);
  }
}

/* Modal produktu otwierany z raportu "Najczęściej zwracany produkt" — jak w
   module "Do zamówienia" (reorder.js), doklejamy do wspólnego modala sekcję
   #modalExtra z informacjami specyficznymi dla zwrotów. */
export async function openReturnsProductModal(id){
  openModal(id, true, '<div class="modal-stat-label">Ładowanie danych o zwrotach…</div>');
  try{
    const d = await getProductReturnDetail(id, periodDef().period);
    document.getElementById('modalExtra').innerHTML = buildReturnDetailHtml(d);
  } catch(err){
    document.getElementById('modalExtra').innerHTML =
      `<div class="modal-stat-label">Nie udało się pobrać danych o zwrotach (${err.message}).</div>`;
  }
}

function fmtProfit(v){
  return (v >= 0 ? 'Zarobiono ' : 'Stracono ') + fmtPLN(Math.abs(v));
}

function buildReturnDetailHtml(d){
  const period = periodDef();
  const currentYear = new Date().getFullYear();
  // "Wynik netto · rok" ma sens jako osobna linia tylko gdy badany okres to
  // konkretny miesiąc — przy raporcie za cały rok byłby identyczny z wynikiem okresu.
  const yearLine = period.period.type !== 'year'
    ? `<div><div class="modal-stat-label">Wynik netto · ${currentYear}</div><div class="modal-stat-val">${fmtProfit(d.netProfitYear)}</div></div>`
    : '';
  // Kolejność par celowo odzwierciedla tok liczenia: sprzedano → marża z tego,
  // zwrócono → ile marży to kosztowało, wynik okresu → wynik dla całego roku.
  return `
    <div class="modal-grid">
      <div><div class="modal-stat-label">Sprzedano · ${period.label}</div><div class="modal-stat-val">${d.unitsSoldPeriod} szt.</div></div>
      <div><div class="modal-stat-label">Marża ze sprzedaży · ${period.label}</div><div class="modal-stat-val">${fmtPLN(d.grossMarginPeriod)}</div></div>
      <div><div class="modal-stat-label">Zwrócono · ${period.label}</div><div class="modal-stat-val">${d.unitsReturnedPeriod} szt.</div></div>
      <div><div class="modal-stat-label">Utracona marża · ${period.label}</div><div class="modal-stat-val">${fmtPLN(d.lostMarginPeriod)}</div></div>
      <div><div class="modal-stat-label">Wynik netto · ${period.label}</div><div class="modal-stat-val">${fmtProfit(d.netProfitPeriod)}</div></div>
      ${yearLine}
    </div>
  `;
}

/* ---------- RAPORT 2: dostawca z największym % zwrotów ---------- */
export async function openReturnsSuppliers(){
  navigateTo('screen-returns-table', 'Dostawca z największym % zwrotów · ' + periodDef().label);
  const tbody = document.getElementById('retTableBody');
  const totalsEl = document.getElementById('retTableTotals');
  totalsEl.style.display = 'none';
  totalsEl.innerHTML = '';
  document.getElementById('retTableInfo').textContent = 'Ładowanie…';
  document.getElementById('retTableHeadRow').innerHTML =
    `<th class="rank sticky-col"></th><th class="identity-col sticky-col">Dostawca</th>
     <th data-key="sold">Sprzedano szt.</th><th data-key="returned">Zwrócono szt.</th><th data-key="pct">% zwrotów</th>`;
  tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Ładowanie…</td></tr>`;

  try{
    const rows = await getSuppliersRanking(periodDef().period);
    document.getElementById('retTableInfo').textContent =
      `${rows.length} dostawców (min. 5 sprzedanych szt. w okresie) · sortowanie: % zwrotów malejąco`
      + (isCurrentMonthPeriod(periodDef().period) ? ` · ${CURRENT_MONTH_NOTE}` : '');
    if(rows.length === 0){
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Brak dostawców spełniających kryteria w tym okresie.</td></tr>`;
      return;
    }
    currentSupplierRows = rows;
    tbody.innerHTML = rows.map((r, i)=>`
      <tr onclick="openReturnsSupplierProducts(${i})">
        <td class="rank sticky-col">${i + 1}</td>
        <td class="identity-col sticky-col"><div class="cust-cell"><div class="cust-name">${r.name}</div></div></td>
        <td class="num">${r.sold}</td>
        <td class="num">${r.returned}</td>
        <td class="num">${r.pct.toFixed(1)}%</td>
      </tr>`).join('');
  } catch(err){
    renderTableError(err, 5);
  }
}

/* ---------- RAPORT 2b: produkty jednego dostawcy (po kliknięciu w wiersz powyżej) ----------
   Renderuje do OSOBNEGO ekranu (screen-returns-supplier-table), nie do współdzielonego
   #retTableBody z raportów produkt/dostawca — patrz komentarz przy tym ekranie w index.html. */
export async function openReturnsSupplierProducts(index){
  const supplier = currentSupplierRows[index];
  if(!supplier) return;
  navigateTo('screen-returns-supplier-table', supplier.name + ' · ' + periodDef().label);
  const tbody = document.getElementById('retSupplierTableBody');
  document.getElementById('retSupplierTableInfo').textContent = 'Ładowanie…';
  tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Ładowanie…</td></tr>`;

  try{
    const rows = await getSupplierProducts(supplier.name, periodDef().period);
    document.getElementById('retSupplierTableInfo').textContent =
      `${rows.length} produktów dostawcy „${supplier.name}” · sortowanie: % zwrotów malejąco`
      + (isCurrentMonthPeriod(periodDef().period) ? ` · ${CURRENT_MONTH_NOTE}` : '');
    if(rows.length === 0){
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Brak sprzedaży ani zwrotów w tym okresie.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((r, i)=>{
      const p = r.product;
      const thumb = imgUrl(p.img) || PLACEHOLDER;
      return `<tr onclick="openReturnsProductModal(${p.id})">
        <td class="rank sticky-col">${i + 1}</td>
        <td class="identity-col sticky-col">
          <div class="prod-cell">
            <img class="prod-thumb" src="${thumb}" referrerpolicy="no-referrer" onerror="this.src='${PLACEHOLDER}'">
            <div>
              <div class="prod-name">${p.name}</div>
              <div class="prod-id">ID ${p.id}${p.kod ? ' · ' + p.kod : ''}</div>
            </div>
          </div>
        </td>
        <td class="num">${r.sold}</td>
        <td class="num">${r.returned}</td>
        <td class="num">${r.pct.toFixed(1)}%</td>
      </tr>`;
    }).join('');
  } catch(err){
    renderTableError(err, 5, 'retSupplierTableInfo', 'retSupplierTableBody');
  }
}

function renderTableError(err, colspan, infoElId = 'retTableInfo', bodyElId = 'retTableBody'){
  document.getElementById(infoElId).textContent = 'Błąd pobierania danych';
  document.getElementById(bodyElId).innerHTML = `<tr><td colspan="${colspan}" class="empty-state">
    Nie udało się pobrać danych (${err.message}). Sprawdź, czy arkusze Zwroty / Ordery są udostępnione kontu serwisowemu.
  </td></tr>`;
}

/* ---------- RAPORT 3: wskaźnik % zwrotów (sprzedaż vs zwroty) ---------- */
export async function openReturnsIndicator(){
  navigateTo('screen-returns-indicator', 'Wskaźnik % zwrotów · ' + periodDef().label);
  const grid = document.getElementById('retIndicatorGrid');
  document.getElementById('retIndicatorPct').textContent = '…';
  grid.innerHTML = '';

  try{
    const stat = await getStoreWideIndicator(periodDef().period);
    document.getElementById('retIndicatorPct').textContent = stat.pct.toFixed(1) + '%';
    grid.innerHTML = `
      <div><div class="modal-stat-label">Sprzedano sztuk</div><div class="modal-stat-val">${stat.sold}</div></div>
      <div><div class="modal-stat-label">Zwrócono sztuk</div><div class="modal-stat-val">${stat.returned}</div></div>
      <div><div class="modal-stat-label">Utracona marża</div><div class="modal-stat-val">${fmtPLN(stat.lostMargin)}</div></div>
      <div><div class="modal-stat-label">Wartość wrócona na stan</div><div class="modal-stat-val">${fmtPLN(stat.restockValue)}</div></div>
    ` + (isCurrentMonthPeriod(periodDef().period) ? `<p class="returns-note">${CURRENT_MONTH_NOTE}</p>` : '');
  } catch(err){
    document.getElementById('retIndicatorPct').textContent = '—';
    grid.innerHTML = `<div class="empty-state">Nie udało się pobrać danych (${err.message}).</div>`;
  }
}

/* ---------- RAPORT 6: zwroty do rozliczenia ---------- */
export async function openReturnsSettlement(){
  navigateTo('screen-returns-settlement', 'Zwroty do rozliczenia');
  const tbody = document.getElementById('settleTableBody');
  document.getElementById('settleTotalValue').textContent = '…';
  tbody.innerHTML = `<tr><td colspan="2" class="empty-state">Ładowanie…</td></tr>`;

  try{
    const { total, items } = await getSettlement();
    document.getElementById('settleTotalValue').textContent = fmtPLN(total);
    if(items.length === 0){
      tbody.innerHTML = `<tr><td colspan="2" class="empty-state">Brak zwrotów oczekujących na rozliczenie.</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(item => `
      <tr><td>${item.rawDate}</td><td class="num">${fmtPLN(item.value)}</td></tr>
    `).join('');
  } catch(err){
    document.getElementById('settleTotalValue').textContent = '—';
    tbody.innerHTML = `<tr><td colspan="2" class="empty-state">
      Nie udało się pobrać danych (${err.message}). Sprawdź, czy zakładka "Zwroty - kontrola" istnieje i jest udostępniona.
    </td></tr>`;
  }
}
