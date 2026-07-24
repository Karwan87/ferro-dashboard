import { navigateTo } from '../../core/router.js';
import { getReorderList } from '../../core/reorderData.js';
import { getAlertsForProduct } from '../../core/alertsData.js';
import { openModal } from '../../core/modal.js';
import { fmtPLN, imgUrl, PLACEHOLDER } from '../../core/format.js';

const ALERT_WINDOW_DAYS = 30; // ta sama liczba dni co przy budowie listy (getReorderList(30))

let currentRows = [];
let currentFilter = 'all';

export async function openReorderHub(){
  navigateTo('screen-reorder-dashboard', 'Do zamówienia / braki');
  currentFilter = 'all';
  highlightFilter('all');

  ['reorderCount', 'reorderValueBraku', 'reorderValueDomowienia'].forEach(id => {
    document.getElementById(id).textContent = '…';
  });
  document.getElementById('reorderError').textContent = '';
  document.getElementById('reorderTableInfo').textContent = 'Ładowanie…';
  document.getElementById('reorderTableBody').innerHTML = `<tr><td colspan="8" class="empty-state">Ładowanie…</td></tr>`;

  try{
    const { rows, totals } = await getReorderList(ALERT_WINDOW_DAYS);
    currentRows = rows;

    document.getElementById('reorderCount').textContent = totals.count.toLocaleString('pl-PL');
    document.getElementById('reorderValueBraku').textContent = fmtPLN(totals.wartoscBraku);
    document.getElementById('reorderValueDomowienia').textContent = fmtPLN(totals.wartoscDomowienia);

    renderTable();
  } catch(err){
    ['reorderCount', 'reorderValueBraku', 'reorderValueDomowienia'].forEach(id => {
      document.getElementById(id).textContent = '—';
    });
    document.getElementById('reorderError').textContent =
      `Nie udało się pobrać danych (${err.message}). Sprawdź, czy arkusze Panel i Alerts są nadal udostępnione kontu serwisowemu.`;
    document.getElementById('reorderTableInfo').textContent = '';
    document.getElementById('reorderTableBody').innerHTML = `<tr><td colspan="8" class="empty-state">Błąd.</td></tr>`;
  }
}

export function applyReorderFilter(key){
  currentFilter = key;
  highlightFilter(key);
  renderTable();
}

function highlightFilter(key){
  document.querySelectorAll('#reorderFilters .pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.key === key);
  });
}

function renderTable(){
  const info = document.getElementById('reorderTableInfo');
  const tbody = document.getElementById('reorderTableBody');

  let rows = currentRows;
  if(currentFilter === 'waiting') rows = rows.filter(r => !r.zamowiono);
  else if(currentFilter === 'ordered') rows = rows.filter(r => r.zamowiono);

  if(rows.length === 0){
    info.textContent = currentRows.length === 0
      ? 'Brak produktów oznaczonych do domówienia.'
      : 'Brak produktów dla wybranego filtra.';
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Brak produktów.</td></tr>`;
    return;
  }

  info.textContent = `${rows.length} produktów · sortowanie: liczba zgłoszeń, potem wartość braku`;
  tbody.innerHTML = rows.map((r, i) => {
    const belowMin = r.minStock > 0 && r.stan < r.minStock;
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
      <td class="num${belowMin ? ' reorder-below-min' : ''}">${r.stan} / ${r.minStock || '—'}</td>
      <td class="num">${r.ilDoDomowienia.toLocaleString('pl-PL')}</td>
      <td class="num">${fmtPLN(r.wartoscBraku)}</td>
      <td class="num">${fmtPLN(r.wartoscDomowienia)}</td>
      <td class="num">${r.alerty > 0 ? `<span class="reorder-alert-badge">${r.alerty}</span>` : '—'}</td>
      <td>${r.zamowiono ? '<span class="reorder-badge reorder-badge-ok">zamówione</span>' : '<span class="reorder-badge">czeka</span>'}</td>
    </tr>`;
  }).join('');
}

function fmtDatePl(d){ return d.toLocaleDateString('pl-PL'); }

/* Tylko w tym module modal produktu dostaje dodatkową sekcję: które warianty
   (rozmiary itp.) są zgłoszone w Alertach, z którego dnia i ile zgłoszeń
   danego dnia — żeby było widać, z czego dokładnie składa się liczba
   pokazana w kolumnie "Alerty (30 dni)". */
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
