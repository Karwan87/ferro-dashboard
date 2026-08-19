import { navigateTo } from '../../core/router.js';
import { getReorderList } from '../../core/reorderData.js';
import { getAlertsForProduct } from '../../core/alertsData.js';
import { openModal } from '../../core/modal.js';
import { fmtPLN, imgUrl, PLACEHOLDER } from '../../core/format.js';
import { matchesProductQuery } from '../../core/search.js';
import { addToCart, removeFromCart, getOrderState, getProductCartStatus, getDeliveryProgress } from '../../core/reorderCart.js';

const ALERT_WINDOW_DAYS = 7; // ta sama liczba dni co przy budowie listy (getReorderList(7))
const COLSPAN = 10;
// Baza ma tysiące produktów — renderowanie wszystkich wierszy NARAZ (każdy ze
// zdjęciem, więc tysiące jednoczesnych żądań do assets.ferroboutique.pl) było
// głównym źródłem kilkusekundowego zawieszenia przy wejściu w ten ekran.
// Renderujemy więc stronami po PAGE_SIZE, dokładając kolejne partie w miarę
// zjeżdżania w dół (IntersectionObserver na sentinelu pod tabelą).
const PAGE_SIZE = 100;

let currentRows = [];
let currentFilter = 'all';
let currentSearch = '';
let selectedSuppliers = new Set();
let supplierPanelOpen = false;
let sortState = { key: 'sales7d', dir: 'desc' };
let qtyFormOpenFor = null;
let stockMin = null;
let stockMax = null;
let selectedStatuses = new Set();
let statusPanelOpen = false;
let filteredSortedRows = [];
let renderedCount = 0;
let loadMoreObserver = null;

/* Stałe 3 kategorie statusu (w przeciwieństwie do dostawców, nie wynikają
   z danych — pokazujemy je zawsze, niezależnie czy akurat coś w danym
   statusie istnieje). Etykiety 1:1 z tym, co pokazuje statusCellHtml.
   Stara ręczna flaga arkusza "Zamówiono?" wycofana — koszyk jest jedynym
   śledzonym źródłem statusu zamówienia. */
const STATUS_OPTIONS = [
  { key: 'listed', label: 'Oczekujący' },
  { key: 'ordered', label: 'Zamówiono' },
  { key: 'czeka', label: 'Czeka' },
];

export async function openReorderHub(){
  navigateTo('screen-reorder-dashboard', 'Zaopatrzenie');
  setupLoadMoreObserver();
  currentFilter = 'all';
  currentSearch = '';
  selectedSuppliers = new Set();
  supplierPanelOpen = false;
  sortState = { key: 'sales7d', dir: 'desc' };
  qtyFormOpenFor = null;
  stockMin = null;
  stockMax = null;
  selectedStatuses = new Set();
  statusPanelOpen = false;
  document.getElementById('reorderSearch').value = '';
  document.getElementById('reorderStockMin').value = '';
  document.getElementById('reorderStockMax').value = '';
  highlightFilter('all');

  ['reorderCount', 'reorderDoDomowienia', 'reorderWaiting'].forEach(id => {
    document.getElementById(id).textContent = '…';
  });
  document.getElementById('reorderError').textContent = '';
  document.getElementById('reorderTableInfo').textContent = 'Ładowanie…';
  document.getElementById('reorderTableBody').innerHTML = `<tr><td colspan="${COLSPAN}" class="empty-state">Ładowanie…</td></tr>`;

  try{
    const { rows, totals } = await getReorderList(ALERT_WINDOW_DAYS);
    currentRows = rows;

    document.getElementById('reorderCount').textContent = totals.count.toLocaleString('pl-PL');
    document.getElementById('reorderDoDomowienia').textContent = totals.doDomowienia.toLocaleString('pl-PL');
    document.getElementById('reorderWaiting').textContent = totals.czekaNaZamowienie.toLocaleString('pl-PL');

    renderTable();
  } catch(err){
    ['reorderCount', 'reorderDoDomowienia', 'reorderWaiting'].forEach(id => {
      document.getElementById(id).textContent = '—';
    });
    document.getElementById('reorderError').textContent =
      `Nie udało się pobrać danych (${err.message}). Sprawdź, czy arkusze Panel i Alerts są nadal udostępnione kontu serwisowemu.`;
    document.getElementById('reorderTableInfo').textContent = '';
    document.getElementById('reorderTableBody').innerHTML = `<tr><td colspan="${COLSPAN}" class="empty-state">Błąd.</td></tr>`;
  }
}

export function setReorderSort(key){
  if(sortState.key === key){ sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc'; }
  else { sortState = { key, dir: 'desc' }; }
  renderTable();
}

export function applyReorderFilter(key){
  currentFilter = key;
  highlightFilter(key);
  renderTable();
}

export function applyReorderSearch(value){
  currentSearch = value;
  renderTable();
}

/* Zakres "od–do" na stanie magazynowym — pole puste znaczy brak ograniczenia
   z tej strony (np. samo "do 3" pokaże też stan 0). */
export function applyReorderStockFilter(){
  const minVal = document.getElementById('reorderStockMin').value;
  const maxVal = document.getElementById('reorderStockMax').value;
  stockMin = minVal === '' ? null : Number(minVal);
  stockMax = maxVal === '' ? null : Number(maxVal);
  renderTable();
}

/* Filtr dostawcy jest CELOWO niezależny od pola szukajki (nazwa/ID) — oba
   warunki się AND-ują, ale żaden nie ogranicza opcji drugiego. Wielowybór
   "po excelowemu" — można zaznaczyć np. NEW Hurtownia I EDAN naraz. */
function allSuppliers(){
  return [...new Set(currentRows.map(r => r.dostawca).filter(Boolean))].sort();
}

export function toggleReorderSupplierPanel(){
  supplierPanelOpen = !supplierPanelOpen;
  renderSupplierPanel();
}

export function toggleReorderSupplier(s){
  if(selectedSuppliers.has(s)) selectedSuppliers.delete(s); else selectedSuppliers.add(s);
  renderTable();
  renderSupplierPanel();
}

export function selectAllReorderSuppliers(){
  selectedSuppliers = new Set(allSuppliers());
  renderTable();
  renderSupplierPanel();
}

export function clearReorderSuppliers(){
  selectedSuppliers = new Set();
  renderTable();
  renderSupplierPanel();
}

function renderSupplierPanel(){
  const panel = document.getElementById('reorderSupplierFilterPanel');
  const btn = document.querySelector('#reorderSupplierFilterWrap .ms-filter-btn');
  panel.classList.toggle('open', supplierPanelOpen);
  if(supplierPanelOpen){
    const suppliers = allSuppliers();
    panel.innerHTML = `
      <div class="ms-filter-actions">
        <button type="button" onclick="selectAllReorderSuppliers()">Zaznacz wszystko</button>
        <button type="button" onclick="clearReorderSuppliers()">Wyczyść</button>
      </div>
      ${suppliers.map(s => `
        <label class="ms-filter-option">
          <input type="checkbox" ${selectedSuppliers.has(s) ? 'checked' : ''} onchange="toggleReorderSupplier('${s.replace(/'/g, "\\'")}')">
          ${s}
        </label>`).join('')}
    `;
  }
  btn.textContent = (selectedSuppliers.size === 0 ? 'Wszyscy dostawcy' : `Dostawca (${selectedSuppliers.size})`) + ' ▾';
}

document.addEventListener('click', e => {
  const wrap = document.getElementById('reorderSupplierFilterWrap');
  if(supplierPanelOpen && wrap && !wrap.contains(e.target)){
    supplierPanelOpen = false;
    renderSupplierPanel();
  }
});

export function toggleReorderStatusPanel(){
  statusPanelOpen = !statusPanelOpen;
  renderStatusPanel();
}

export function toggleReorderStatus(key){
  if(selectedStatuses.has(key)) selectedStatuses.delete(key); else selectedStatuses.add(key);
  renderTable();
  renderStatusPanel();
}

export function selectAllReorderStatuses(){
  selectedStatuses = new Set(STATUS_OPTIONS.map(o => o.key));
  renderTable();
  renderStatusPanel();
}

export function clearReorderStatuses(){
  selectedStatuses = new Set();
  renderTable();
  renderStatusPanel();
}

function renderStatusPanel(){
  const panel = document.getElementById('reorderStatusFilterPanel');
  const btn = document.querySelector('#reorderStatusFilterWrap .ms-filter-btn');
  panel.classList.toggle('open', statusPanelOpen);
  if(statusPanelOpen){
    panel.innerHTML = `
      <div class="ms-filter-actions">
        <button type="button" onclick="selectAllReorderStatuses()">Zaznacz wszystko</button>
        <button type="button" onclick="clearReorderStatuses()">Wyczyść</button>
      </div>
      ${STATUS_OPTIONS.map(o => `
        <label class="ms-filter-option">
          <input type="checkbox" ${selectedStatuses.has(o.key) ? 'checked' : ''} onchange="toggleReorderStatus('${o.key}')">
          ${o.label}
        </label>`).join('')}
    `;
  }
  btn.textContent = (selectedStatuses.size === 0 ? 'Wszystkie statusy' : `Status (${selectedStatuses.size})`) + ' ▾';
}

document.addEventListener('click', e => {
  const wrap = document.getElementById('reorderStatusFilterWrap');
  if(statusPanelOpen && wrap && !wrap.contains(e.target)){
    statusPanelOpen = false;
    renderStatusPanel();
  }
});

function highlightFilter(key){
  document.querySelectorAll('#reorderFilters .pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.key === key);
  });
}

function sortLabel(k){
  return {
    stan: 'stan magazynowy', sales7d: 'sprzedaż 7 dni', cenaZakupu: 'cena zakupu',
    marzaPct: 'marża', zwrotyPct: '% zwrotów', alerty: 'liczba zgłoszeń',
  }[k];
}

/* "Zamówione" = status 'ordered' w koszyku (core/reorderCart.js) — jedyne
   dziś śledzone źródło. Stara ręczna flaga arkusza "Zamówiono?" wycofana
   jako zbędna (i tak nigdy się automatycznie nie odświeżała). */
function isEffectivelyOrdered(r){
  return getProductCartStatus(r.id) === 'ordered';
}

/* Nagłówek budowany na nowo przy każdym renderze — w zakładce "Zamówione"
   dochodzą kolumny Data zamówienia/Dostarczono, a znika Akcje (nie ma tu
   czego "zamawiać" — patrz actionsCellHtml). */
function renderTableHead(){
  const row = document.getElementById('reorderTableHead');
  const orderedCols = currentFilter === 'ordered' ? '<th>Data zamówienia</th><th>Dostarczono</th>' : '';
  const actionsCol = currentFilter === 'ordered' ? '' : '<th>Akcje</th>';
  row.innerHTML = `
    <th class="rank sticky-col"></th>
    <th class="identity-col sticky-col">Produkt</th>
    <th data-key="stan" onclick="setReorderSort('stan')">Stan <span class="arrow"></span></th>
    <th data-key="sales7d" onclick="setReorderSort('sales7d')">Sprzedaż 7D <span class="arrow"></span></th>
    <th data-key="cenaZakupu" onclick="setReorderSort('cenaZakupu')">Cena zakupu <span class="arrow"></span></th>
    <th data-key="marzaPct" onclick="setReorderSort('marzaPct')">Marża <span class="arrow"></span></th>
    <th data-key="zwrotyPct" onclick="setReorderSort('zwrotyPct')">% zwrotów <span class="arrow"></span></th>
    <th data-key="alerty" onclick="setReorderSort('alerty')">Alerty (7 dni) <span class="arrow"></span></th>
    <th>Status</th>
    ${orderedCols}
    ${actionsCol}
  `;
}

function currentColspan(){
  return currentFilter === 'ordered' ? COLSPAN + 1 : COLSPAN;
}

function rowHtml(r, i, isOrderedTab){
  const belowMin = r.minStock > 0 && r.stan < r.minStock;
  const orderedCells = isOrderedTab
    ? `<td id="reorderDateCell_${r.id}">—</td><td id="reorderDeliveredCell_${r.id}">—</td>`
    : '';
  const actionsCell = isOrderedTab ? '' : `<td onclick="event.stopPropagation()">${actionsCellHtml(r)}</td>`;
  return `<tr onclick="openReorderProductModal(${r.id})">
      <td class="rank sticky-col">${i + 1}</td>
      <td class="identity-col sticky-col">
        <div class="prod-cell">
          <img class="prod-thumb" src="${imgUrl(r.img) || PLACEHOLDER}" referrerpolicy="no-referrer" onerror="this.src='${PLACEHOLDER}'">
          <div>
            <div class="prod-name">${r.name}</div>
            <div class="prod-id">ID ${r.id}${r.dostawca ? ' · ' + r.dostawca : ''}</div>
          </div>
        </div>
      </td>
      <td class="num${belowMin ? ' reorder-below-min' : ''}">${r.stan}</td>
      <td class="num">${r.sales7d.toLocaleString('pl-PL')}</td>
      <td class="num">${fmtPLN(r.cenaZakupu)}</td>
      <td class="num">${r.marzaPct !== null ? r.marzaPct.toFixed(0) + '%' : '—'}</td>
      <td class="num">${r.zwrotyPct !== null ? r.zwrotyPct.toFixed(0) + '%' : '—'}</td>
      <td class="num">${r.alerty > 0 ? `<span class="reorder-alert-badge">${r.alerty}</span>` : '—'}</td>
      <td id="reorderStatusCell_${r.id}">${statusCellHtml(r)}</td>
      ${orderedCells}
      ${actionsCell}
    </tr>`;
}

function renderTable(){
  const info = document.getElementById('reorderTableInfo');
  const tbody = document.getElementById('reorderTableBody');
  renderTableHead();

  let rows = currentRows;
  // "Lista produktów" = KOMPLETNA baza, bez filtrowania po statusie (produkt
  // zamówiony nie znika — dalej można go domówić). "Zamówione" filtruje do
  // efektywnie zamówionych, patrz isEffectivelyOrdered.
  if(currentFilter === 'ordered') rows = rows.filter(isEffectivelyOrdered);
  if(currentSearch) rows = rows.filter(r => matchesProductQuery(currentSearch, r.id, r.name));
  if(selectedSuppliers.size > 0) rows = rows.filter(r => selectedSuppliers.has(r.dostawca));
  if(selectedStatuses.size > 0) rows = rows.filter(r => selectedStatuses.has(rowStatusKey(r)));
  if(stockMin !== null) rows = rows.filter(r => r.stan >= stockMin);
  if(stockMax !== null) rows = rows.filter(r => r.stan <= stockMax);

  document.querySelectorAll('#reorderTableHead th[data-key]').forEach(th => {
    th.classList.toggle('sorted', th.dataset.key === sortState.key);
    th.querySelector('.arrow').textContent = th.dataset.key === sortState.key ? (sortState.dir === 'asc' ? '▲' : '▼') : '';
  });

  const dir = sortState.dir === 'asc' ? 1 : -1;
  rows = [...rows].sort((a, b) => {
    const av = a[sortState.key], bv = b[sortState.key];
    if(av === null) return bv === null ? 0 : 1;
    if(bv === null) return -1;
    return (av - bv) * dir;
  });

  filteredSortedRows = rows;
  renderedCount = 0;

  if(rows.length === 0){
    info.textContent = currentRows.length === 0
      ? 'Brak produktów.'
      : 'Brak produktów dla wybranego filtra/wyszukiwania.';
    tbody.innerHTML = `<tr><td colspan="${currentColspan()}" class="empty-state">Brak produktów.</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  appendNextPage();
}

/* Dokłada kolejną porcję (PAGE_SIZE) wierszy do już wyrenderowanej tabeli —
   wołane zarówno przy pierwszym renderze (z pustym tbody), jak i przez
   IntersectionObserver na sentinelu pod tabelą (patrz setupLoadMoreObserver). */
function appendNextPage(){
  if(renderedCount >= filteredSortedRows.length) return;
  const info = document.getElementById('reorderTableInfo');
  const tbody = document.getElementById('reorderTableBody');
  const isOrderedTab = currentFilter === 'ordered';

  const chunk = filteredSortedRows.slice(renderedCount, renderedCount + PAGE_SIZE);
  const startIndex = renderedCount;
  tbody.insertAdjacentHTML('beforeend', chunk.map((r, i) => rowHtml(r, startIndex + i, isOrderedTab)).join(''));
  renderedCount += chunk.length;

  const pageInfo = renderedCount < filteredSortedRows.length ? ` (pokazano ${renderedCount})` : '';
  info.textContent = `${filteredSortedRows.length} produktów${pageInfo} · sortowanie: ${sortLabel(sortState.key)} ${sortState.dir === 'asc' ? 'rosnąco' : 'malejąco'}`;

  enrichOrderedStatuses(chunk);
}

/* Sentinel pod tabelą (index.html) — jak tylko wjedzie w pole widzenia
   (z 400px zapasu, żeby doładować zanim user faktycznie dojedzie do końca),
   dokładamy kolejną stronę. Sentinel jest statyczny w DOM (poza tbody), więc
   obserwator ustawiamy raz, nie trzeba go odtwarzać przy każdym renderze. */
function setupLoadMoreObserver(){
  if(loadMoreObserver) return;
  const sentinel = document.getElementById('reorderLoadMoreSentinel');
  if(!sentinel) return;
  loadMoreObserver = new IntersectionObserver(entries => {
    if(entries[0].isIntersecting) appendNextPage();
  }, { rootMargin: '400px' });
  loadMoreObserver.observe(sentinel);
}

/* Status wyłącznie z koszyka (core/reorderCart.js) — jedyne dziś śledzone
   źródło prawdy o zamówieniu (stara ręczna flaga arkusza "Zamówiono?"
   wycofana). Ten sam klucz zasila zarówno etykietę w tabeli, jak i filtr
   statusów (STATUS_OPTIONS) — jedno źródło prawdy dla obu. */
function rowStatusKey(r){
  const status = getProductCartStatus(r.id);
  if(status === 'listed') return 'listed';
  if(status === 'ordered') return 'ordered';
  return 'czeka';
}

function statusCellHtml(r){
  const key = rowStatusKey(r);
  if(key === 'listed') return '<span class="reorder-badge reorder-badge-listed">oczekujący</span>';
  if(key === 'ordered') return '<span class="reorder-badge reorder-badge-ordered">zamówiono…</span>';
  return '<span class="reorder-badge">czeka</span>';
}

/* Data zamówienia + postęp dostawy (X/Y) dla statusu "zamówiono" — osobny,
   async przebieg PO wyrenderowaniu tabeli (nie blokuje pierwszego rysowania)
   i tylko dla wierszy faktycznie zamówionych przez KOSZYK, nie całej bazy
   produktów (produkty "zamówione" tylko starą flagą arkusza nie mają daty/
   postępu w koszyku — patrz isEffectivelyOrdered — zostają z myślnikiem). */
async function enrichOrderedStatuses(rows){
  const isOrderedTab = currentFilter === 'ordered';
  const orderedRows = rows.filter(r => getProductCartStatus(r.id) === 'ordered');
  await Promise.all(orderedRows.map(async r => {
    const progress = await getDeliveryProgress(r.id);
    if(!progress) return;
    const label = progress.isComplete ? 'dostarczono' : 'zamówiono';
    const cls = progress.isComplete ? 'reorder-badge-ok' : 'reorder-badge-ordered';
    const dateLabel = fmtDatePl(new Date(progress.orderedAt));

    const statusCell = document.getElementById('reorderStatusCell_' + r.id);
    if(statusCell){
      statusCell.innerHTML = isOrderedTab
        ? `<span class="reorder-badge ${cls}">${label}</span>`
        : `<span class="reorder-badge ${cls}" title="Zamówiono: ${dateLabel}">${label} · ${progress.deliveredQty}/${progress.orderedQty} · ${dateLabel}</span>`;
    }
    if(isOrderedTab){
      const dateCell = document.getElementById('reorderDateCell_' + r.id);
      const deliveredCell = document.getElementById('reorderDeliveredCell_' + r.id);
      if(dateCell) dateCell.textContent = dateLabel;
      if(deliveredCell) deliveredCell.textContent = `${progress.deliveredQty} / ${progress.orderedQty}`;
    }
  }));
}

function actionsCellHtml(r){
  if(qtyFormOpenFor === r.id){
    return `<div class="reorder-qty-form">
      <input type="number" min="1" value="1" id="reorderQtyInput_${r.id}">
      <button class="reorder-action-btn-sm" onclick="confirmReorderQty(${r.id})">OK</button>
      <button class="reorder-action-btn-sm" onclick="cancelReorderQty()">✕</button>
    </div>`;
  }
  const status = getProductCartStatus(r.id);
  if(status === 'listed'){
    return `<span class="reorder-badge reorder-badge-listed">w koszyku: ${getOrderState(r.id).listedQty}</span>
      <button class="reorder-action-btn-sm" onclick="cartRemoveFromRow(${r.id})">✕</button>`;
  }
  // "ordered" NIE blokuje dalszego zamawiania — czasem trzeba domówić jeszcze,
  // zanim pierwsza tura w ogóle dojdzie (patrz core/reorderCart.js: kolejne
  // ZAMÓW sumuje się z otwartym zamówieniem przy wysyłce z koszyka).
  return `<button class="reorder-action-btn" onclick="toggleReorderQtyForm(${r.id})">Zamów</button>`;
}

export function toggleReorderQtyForm(id){
  qtyFormOpenFor = qtyFormOpenFor === id ? null : id;
  renderTable();
}

export function cancelReorderQty(){
  qtyFormOpenFor = null;
  renderTable();
}

export function confirmReorderQty(id){
  const qty = Number(document.getElementById('reorderQtyInput_' + id).value) || 0;
  if(qty > 0) addToCart(id, qty);
  qtyFormOpenFor = null;
  renderTable();
}

export function cartRemoveFromRow(id){
  removeFromCart(id);
}

document.addEventListener('ferro:cart-changed', () => {
  if(document.getElementById('screen-reorder-dashboard')?.classList.contains('active')) renderTable();
});

function fmtDatePl(d){ return d.toLocaleDateString('pl-PL'); }

/* Tylko w tym module modal produktu dostaje dodatkową sekcję: które warianty
   (rozmiary itp.) są zgłoszone w Alertach, z którego dnia i ile zgłoszeń
   danego dnia — żeby było widać, z czego dokładnie składa się liczba
   pokazana w kolumnie "Alerty (7 dni)". */
export async function openReorderProductModal(id){
  openModal(id, true, '<div class="modal-stat-label">Ładowanie zgłoszeń…</div>');
  try{
    const rows = await getAlertsForProduct(id, ALERT_WINDOW_DAYS);
    document.getElementById('modalExtra').innerHTML = buildAlertDetailHtml(rows);
  } catch(err){
    document.getElementById('modalExtra').innerHTML =
      `<div class="modal-stat-label">Nie udało się pobrać zgłoszeń (${err.message}).</div>`;
  }
}

function buildAlertDetailHtml(rows){
  if(rows.length === 0){
    return `<div class="modal-stat-label">Brak zgłoszeń w Alertach z ostatnich ${ALERT_WINDOW_DAYS} dni.</div>`;
  }

  const byAttr = new Map();
  rows.forEach(r => {
    const key = r.attr || 'bez wariantu';
    if(!byAttr.has(key)) byAttr.set(key, []);
    byAttr.get(key).push(r);
  });

  const groups = [...byAttr.entries()].map(([attr, entries]) => {
    const total = entries.reduce((sum, e) => sum + e.qty, 0);
    const entryRows = entries
      .map(e => `<div class="modal-alert-entry"><span>${fmtDatePl(e.date)}</span><span>${e.qty} zgł.</span></div>`)
      .join('');
    return `<div class="modal-alert-group">
      <div class="modal-alert-attr">${attr} <span class="modal-alert-total">(razem: ${total})</span></div>
      ${entryRows}
    </div>`;
  }).join('');

  return `
    <div class="modal-stat-label">Zgłoszenia wg wariantu i dnia (ostatnie ${ALERT_WINDOW_DAYS} dni)</div>
    <div class="modal-alert-groups">${groups}</div>
  `;
}
