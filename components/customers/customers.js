import { navigateTo } from '../../core/router.js';
import { loadCustomersData } from '../../core/customersData.js';
import { fmtPLN } from '../../core/format.js';

/* Ekran wyboru okresu (screen-customers-years) miesza dwa rodzaje kafelków:
   konkretne lata kalendarzowe (2026 aktywny, 2027 zarezerwowany na przyszłość)
   oraz ruchome okna "ostatnie N dni" liczone od dzisiejszej daty — te drugie
   nie są przypisane do żadnego roku, więc stoją na tym samym poziomie co lata,
   nie wewnątrz nich. */
const ACTIVE_YEAR = 2026;

/* Katalog kolumn możliwych do pokazania w raportach klienckich — analogicznie
   do components/sales/sales.js: każdy raport (CUSTOMER_VIEW_DEFS) wybiera
   swój podzbiór i decyduje o widoczności na urządzeniach mobilnych. */
const COLUMN_DEFS = {
  orders:        { label:'Liczba zamówień' },
  unitsOrdered:  { label:'Zamówione sztuki' },
  unitsReturned: { label:'Zwrócone sztuki' },
  orderValue:    { label:'Wartość zamówień' },
  margin:        { label:'Uzyskana marża' },
  returnedValue: { label:'Wartość zwrotów' },
  lostMargin:    { label:'Utracona marża' },
  marginNet:     { label:'Marża po zwrotach' },
  returnShare:   { label:'Udział zwrotów' },
  returnPercent: { label:'% zwrotów' },
};

/* minOrders / maxReturnSharePct — progi filtrujące dany raport (patrz
   computeCustomerRows). defaultSort — sortowanie startowe po wejściu w raport. */
const CUSTOMER_VIEW_DEFS = {
  topGross: {
    title:'Najbardziej dochodowi klienci',
    subtitle:'Pełne zestawienie, bez dodatkowych warunków',
    columns:[
      {key:'orders',        mobile:true},
      {key:'unitsOrdered',  mobile:true},
      {key:'unitsReturned', mobile:false},
      {key:'orderValue',    mobile:true},
      {key:'margin',        mobile:true},
      {key:'lostMargin',    mobile:false},
      {key:'marginNet',     mobile:false},
    ],
    defaultSort:{key:'orderValue', dir:'desc'},
  },
  topNet: {
    title:'Dochodowość netto klientów',
    subtitle:'Marża pomniejszona o utraconą marżę na zwrotach',
    columns:[
      {key:'unitsOrdered',  mobile:false},
      {key:'unitsReturned', mobile:false},
      {key:'margin',        mobile:true},
      {key:'returnedValue', mobile:true},
      {key:'marginNet',     mobile:true},
    ],
    defaultSort:{key:'marginNet', dir:'desc'},
  },
  best: {
    title:'Najlepsi klienci',
    subtitle:'Min. 5 zamówień w roku, zwroty do 10%',
    columns:[
      {key:'orders',        mobile:false},
      {key:'unitsOrdered',  mobile:false},
      {key:'unitsReturned', mobile:false},
      {key:'margin',        mobile:true},
      {key:'returnShare',   mobile:true},
    ],
    minOrders:5,
    maxReturnSharePct:10,
    defaultSort:{key:'margin', dir:'desc'},
  },
  worst: {
    title:'Klienci z najwyższym wskaźnikiem zwrotów',
    subtitle:'Min. 5 zamówień w roku',
    columns:[
      {key:'orders',        mobile:false},
      {key:'unitsOrdered',  mobile:false},
      {key:'unitsReturned', mobile:false},
      {key:'margin',        mobile:true},
      {key:'returnedValue', mobile:true},
      {key:'returnPercent', mobile:true},
      {key:'lostMargin',    mobile:false},
      {key:'marginNet',     mobile:false},
    ],
    minOrders:5,
    defaultSort:{key:'returnPercent', dir:'desc'},
  },
  mostActive: {
    title:'Najaktywniejsi klienci',
    subtitle:'Min. 5 zamówień w roku',
    columns:[
      {key:'orders',        mobile:true},
      {key:'unitsOrdered',  mobile:false},
      {key:'unitsReturned', mobile:false},
      {key:'margin',        mobile:true},
      {key:'lostMargin',    mobile:false},
      {key:'marginNet',     mobile:false},
    ],
    minOrders:5,
    defaultSort:{key:'orders', dir:'desc'},
  },
};

let currentView = null;
let sortState = null;
let currentRecords = [];
let currentRows = [];
let currentPeriod = null;
let currentPeriodLabel = '';

export function openCustomersHub(){
  navigateTo('screen-customers-years', 'Klienci');
}

export function openCustomersYear(year){
  if(year !== ACTIVE_YEAR) return;
  currentPeriod = { type:'year', year };
  currentPeriodLabel = String(year);
  navigateTo('screen-customers-category', 'Klienci · ' + year);
}

export function openCustomersRolling(days){
  currentPeriod = { type:'days', days };
  currentPeriodLabel = 'Ostatnie ' + days + ' dni';
  navigateTo('screen-customers-category', 'Klienci · ' + currentPeriodLabel);
}

export async function openCustomersView(key){
  currentView = key;
  const def = CUSTOMER_VIEW_DEFS[key];
  sortState = { ...def.defaultSort };
  navigateTo('screen-customers-table', def.title + ' · ' + currentPeriodLabel);
  renderCustomersTableHead();
  renderLoading();

  try{
    currentRecords = await loadCustomersData(currentPeriod);
    renderCustomersTable();
  } catch(err){
    renderError(err);
  }
}

export function setCustomersSort(key){
  if(sortState.key === key){ sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc'; }
  else { sortState = { key, dir:'desc' }; }
  renderCustomersTable();
}

function computeCustomerRows(){
  const def = CUSTOMER_VIEW_DEFS[currentView];
  let rows = currentRecords;
  if(def.minOrders) rows = rows.filter(r => r.orders >= def.minOrders);
  if(def.maxReturnSharePct !== undefined) rows = rows.filter(r => r.returnShare <= def.maxReturnSharePct);

  rows = [...rows].sort((a, b)=>{
    const dir = sortState.dir === 'asc' ? 1 : -1;
    return (a[sortState.key] - b[sortState.key]) * dir;
  });

  return rows.slice(0, 50);
}

function cellHtml(key, r){
  switch(key){
    case 'orders': return String(r.orders);
    case 'unitsOrdered': return String(r.unitsOrdered);
    case 'unitsReturned': return String(r.unitsReturned);
    case 'orderValue': return fmtPLN(r.orderValue);
    case 'margin': return fmtPLN(r.margin);
    case 'returnedValue': return fmtPLN(r.returnedValue);
    case 'lostMargin': return fmtPLN(r.lostMargin);
    case 'marginNet': return fmtPLN(r.marginNet);
    case 'returnShare': return r.returnShare.toFixed(1) + '%';
    case 'returnPercent': return r.returnPercent.toFixed(1) + '%';
  }
}

function renderCustomersTableHead(){
  const def = CUSTOMER_VIEW_DEFS[currentView];
  const row = document.getElementById('custTableHeadRow');
  row.innerHTML = `<th class="rank sticky-col"></th><th class="identity-col sticky-col">Klient</th>` + def.columns.map(c=>{
    const cls = c.mobile ? '' : ' mobile-hide';
    return `<th data-key="${c.key}" class="${cls}" onclick="setCustomersSort('${c.key}')">${COLUMN_DEFS[c.key].label} <span class="arrow"></span></th>`;
  }).join('');
}

function renderLoading(){
  const def = CUSTOMER_VIEW_DEFS[currentView];
  document.getElementById('custTableInfo').textContent = 'Ładowanie danych klientów…';
  document.getElementById('custTableBody').innerHTML =
    `<tr><td colspan="${def.columns.length + 2}" class="empty-state">Ładowanie…</td></tr>`;
}

function renderError(err){
  const def = CUSTOMER_VIEW_DEFS[currentView];
  document.getElementById('custTableInfo').textContent = 'Błąd pobierania danych klientów';
  document.getElementById('custTableBody').innerHTML = `<tr><td colspan="${def.columns.length + 2}" class="empty-state">
    Nie udało się pobrać danych (${err.message}). Sprawdź, czy arkusze Zwroty / Ordery / Dane zamówień
    są udostępnione kontu serwisowemu i czy pliki data/zwroty.csv, data/ordery.csv, data/zamowienia_klienci.csv istnieją.
  </td></tr>`;
}

function renderCustomersTable(){
  const def = CUSTOMER_VIEW_DEFS[currentView];
  const rows = computeCustomerRows();

  document.getElementById('custTableInfo').textContent =
    def.subtitle + ' · ' + rows.length + ' klientów · sortowanie: ' + COLUMN_DEFS[sortState.key].label.toLowerCase() +
    (sortState.dir === 'asc' ? ' rosnąco' : ' malejąco');

  document.querySelectorAll('#custTableHeadRow th[data-key]').forEach(th=>{
    th.classList.toggle('sorted', th.dataset.key === sortState.key);
    th.querySelector('.arrow').textContent = th.dataset.key === sortState.key ? (sortState.dir === 'asc' ? '▲' : '▼') : '';
  });

  currentRows = rows;
  const tbody = document.getElementById('custTableBody');
  if(rows.length === 0){
    tbody.innerHTML = `<tr><td colspan="${def.columns.length + 2}" class="empty-state">Brak klientów spełniających kryteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((r, i)=>{
    const cells = def.columns.map(c=>`<td class="num${c.mobile ? '' : ' mobile-hide'}">${cellHtml(c.key, r)}</td>`).join('');
    return `<tr onclick="openCustomerModal(${i})">
      <td class="rank sticky-col">${i + 1}</td>
      <td class="identity-col sticky-col">
        <div class="cust-cell"><div class="cust-name">${r.name}</div></div>
      </td>
      ${cells}
    </tr>`;
  }).join('');
}

/* Modal ze wszystkimi kolumnami bieżącego raportu — na mobile część kolumn
   jest ukryta w tabeli (mobile-hide), więc to jedyny sposób, by zobaczyć
   pełny komplet danych klienta bez przełączania się na desktop. */
export function openCustomerModal(index){
  const def = CUSTOMER_VIEW_DEFS[currentView];
  const r = currentRows[index];
  if(!r) return;

  document.getElementById('custModalName').textContent = r.name;
  document.getElementById('custModalGrid').innerHTML = def.columns.map(c=>`
    <div><div class="modal-stat-label">${COLUMN_DEFS[c.key].label}</div><div class="modal-stat-val">${cellHtml(c.key, r)}</div></div>
  `).join('');
  document.getElementById('custOverlay').classList.add('active');
}

export function closeCustomerModal(){
  document.getElementById('custOverlay').classList.remove('active');
}

document.addEventListener('keydown', e=>{ if(e.key === 'Escape') closeCustomerModal(); });
