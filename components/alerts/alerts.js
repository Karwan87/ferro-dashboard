import { navigateTo } from '../../core/router.js';
import { getAlertsSummary } from '../../core/alertsData.js';
import { imgUrl, PLACEHOLDER } from '../../core/format.js';
import { products } from '../../core/data.js';

const PERIOD_DEFS = {
  d1:  { label:'Ostatniego dnia (wczoraj)', days:1 },
  d3:  { label:'Ostatnie 3 dni',  days:3 },
  d7:  { label:'Ostatnie 7 dni',  days:7 },
  d14: { label:'Ostatnie 14 dni', days:14 },
  d30: { label:'Ostatnie 30 dni', days:30 },
};

const NO_SUPPLIER = '__brak__';
let currentRows = []; // {productId, name, attr, qty, known, dostawca}
let currentSupplier = 'all';

export function openAlertsHub(){
  navigateTo('screen-alerts-periods', 'Alerty');
}

export async function openAlertsPeriod(periodKey){
  const def = PERIOD_DEFS[periodKey];
  navigateTo('screen-alerts-report', 'Alerty · ' + def.label);

  currentSupplier = 'all';
  document.getElementById('alertsTotalValue').textContent = '…';
  document.getElementById('alertsSupplierFilter').innerHTML = '<option value="all">Wszyscy dostawcy</option>';
  document.getElementById('alertsTableInfo').textContent = 'Ładowanie…';
  document.getElementById('alertsTableBody').innerHTML = `<tr><td colspan="4" class="empty-state">Ładowanie…</td></tr>`;

  try{
    const { total, products: rows } = await getAlertsSummary(def.days);
    document.getElementById('alertsTotalValue').textContent = String(total);

    currentRows = rows.map(r => {
      const known = products.find(p => p.id === r.productId);
      return { ...r, known, dostawca: known?.dostawca || null };
    });

    renderSupplierFilter();
    renderAlertsTable();
  } catch(err){
    currentRows = [];
    document.getElementById('alertsTotalValue').textContent = '—';
    document.getElementById('alertsTableInfo').textContent = 'Błąd pobierania danych';
    document.getElementById('alertsTableBody').innerHTML = `<tr><td colspan="4" class="empty-state">
      Nie udało się pobrać danych (${err.message}). Sprawdź, czy arkusz Alerts jest udostępniony kontu serwisowemu.
    </td></tr>`;
  }
}

function renderSupplierFilter(){
  const select = document.getElementById('alertsSupplierFilter');
  const suppliers = [...new Set(currentRows.map(r => r.dostawca).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'pl'));
  const hasUnknown = currentRows.some(r => !r.dostawca);

  select.innerHTML = '<option value="all">Wszyscy dostawcy</option>'
    + suppliers.map(s => `<option value="${s}">${s}</option>`).join('')
    + (hasUnknown ? `<option value="${NO_SUPPLIER}">Brak przypisanego dostawcy</option>` : '');
  select.value = 'all';
}

export function filterAlertsBySupplier(){
  currentSupplier = document.getElementById('alertsSupplierFilter').value;
  renderAlertsTable();
}

function renderAlertsTable(){
  const info = document.getElementById('alertsTableInfo');
  const tbody = document.getElementById('alertsTableBody');

  let rows = currentRows;
  if(currentSupplier === NO_SUPPLIER) rows = rows.filter(r => !r.dostawca);
  else if(currentSupplier !== 'all') rows = rows.filter(r => r.dostawca === currentSupplier);

  if(rows.length === 0){
    info.textContent = currentRows.length === 0
      ? 'Brak zgłoszeń w tym okresie.'
      : 'Brak zgłoszeń dla wybranego dostawcy.';
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Brak zgłoszeń.</td></tr>`;
    return;
  }

  info.textContent = `${rows.length} produktów · sortowanie: liczba zgłoszeń malejąco`;
  tbody.innerHTML = rows.map((r, i) => {
    const known = r.known;
    const thumb = known ? (imgUrl(known.img) || PLACEHOLDER) : PLACEHOLDER;
    const displayName = known ? known.name : (r.name || ('Produkt #' + r.productId));
    const rowAttrs = known
      ? `onclick="openModal(${r.productId}, true)"`
      : '';
    return `<tr ${rowAttrs}>
      <td class="rank sticky-col">${i + 1}</td>
      <td class="identity-col sticky-col">
        <div class="prod-cell">
          <img class="prod-thumb" src="${thumb}" referrerpolicy="no-referrer" onerror="this.src='${PLACEHOLDER}'">
          <div>
            <div class="prod-name">${displayName}</div>
            <div class="prod-id">ID ${r.productId}${r.attr ? ' · ' + r.attr : ''}</div>
          </div>
        </div>
      </td>
      <td>${r.dostawca || '—'}</td>
      <td class="num">${r.qty}</td>
    </tr>`;
  }).join('');
}
