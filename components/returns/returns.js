import { navigateTo } from '../../core/router.js';
import { getReturnedProducts, getSuppliersRanking, getStoreWideIndicator, getSettlement } from '../../core/returnsData.js';
import { fmtPLN, imgUrl, PLACEHOLDER } from '../../core/format.js';

const MONTH_NAMES = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];
const MONTHS_YEAR = 2026;

/* Okresy dostępne dla raportów zwrotów — 3 ruchome okna + cały rok 2026 +
   12 miesięcy 2026 (dodane niżej), każdy prowadzi do tych samych 3 raportów
   (produkt/dostawca/wskaźnik). */
const PERIOD_DEFS = {
  d30:  { label:'Ostatnie 30 dni',  period:{ type:'days', days:30 } },
  d60:  { label:'Ostatnie 60 dni',  period:{ type:'days', days:60 } },
  d90:  { label:'Ostatnie 90 dni',  period:{ type:'days', days:90 } },
  y2026:{ label:'2026',            period:{ type:'year', year:2026 } },
};
MONTH_NAMES.forEach((name, idx)=>{
  PERIOD_DEFS['m' + (idx + 1)] = { label: name + ' ' + MONTHS_YEAR, period:{ type:'month', year:MONTHS_YEAR, month:idx } };
});

let currentPeriodKey = null;

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
  document.getElementById('retTableInfo').textContent = 'Ładowanie…';
  document.getElementById('retTableHeadRow').innerHTML =
    `<th class="rank sticky-col"></th><th class="identity-col sticky-col">Produkt</th><th data-key="qty">Zwrócone szt.</th>`;
  tbody.innerHTML = `<tr><td colspan="3" class="empty-state">Ładowanie…</td></tr>`;

  try{
    const rows = await getReturnedProducts(periodDef().period);
    document.getElementById('retTableInfo').textContent = `${rows.length} produktów · sortowanie: zwrócone sztuki malejąco`;
    if(rows.length === 0){
      tbody.innerHTML = `<tr><td colspan="3" class="empty-state">Brak zwrotów w tym okresie.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((r, i)=>{
      const p = r.product;
      const thumb = imgUrl(p.img) || PLACEHOLDER;
      return `<tr onclick="openModal(${p.id}, true)">
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

/* ---------- RAPORT 2: dostawca z największym % zwrotów ---------- */
export async function openReturnsSuppliers(){
  navigateTo('screen-returns-table', 'Dostawca z największym % zwrotów · ' + periodDef().label);
  const tbody = document.getElementById('retTableBody');
  document.getElementById('retTableInfo').textContent = 'Ładowanie…';
  document.getElementById('retTableHeadRow').innerHTML =
    `<th class="rank sticky-col"></th><th class="identity-col sticky-col">Dostawca</th>
     <th data-key="sold">Sprzedano szt.</th><th data-key="returned">Zwrócono szt.</th><th data-key="pct">% zwrotów</th>`;
  tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Ładowanie…</td></tr>`;

  try{
    const rows = await getSuppliersRanking(periodDef().period);
    document.getElementById('retTableInfo').textContent =
      `${rows.length} dostawców (min. 5 sprzedanych szt. w okresie) · sortowanie: % zwrotów malejąco`;
    if(rows.length === 0){
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Brak dostawców spełniających kryteria w tym okresie.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((r, i)=>`
      <tr>
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

function renderTableError(err, colspan){
  document.getElementById('retTableInfo').textContent = 'Błąd pobierania danych';
  document.getElementById('retTableBody').innerHTML = `<tr><td colspan="${colspan}" class="empty-state">
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
    `;
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
