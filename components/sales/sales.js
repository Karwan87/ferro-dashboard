import { navigateTo } from '../../core/router.js';
import { products } from '../../core/data.js';
import { fmtPLN, imgUrl, PLACEHOLDER } from '../../core/format.js';
import { matchesProductQuery } from '../../core/search.js';

/* Katalog kolumn możliwych do pokazania w tabeli — każdy widok (VIEW_DEFS)
   wybiera swój podzbiór przez pole "columns" oraz decyduje, czy dana
   kolumna ma być widoczna na urządzeniach mobilnych (mobile:true/false). */
const COLUMN_DEFS = {
  units:       { label:'Sztuki' },
  stan:        { label:'Stan magazynowy' },
  value:       { label:'Wartość sprzedaży' },
  margin:      { label:'Marża' },
  marginPct:   { label:'Marża %' },
  cena:        { label:'Cena sprzedaży' },
  cenaZakupu:  { label:'Cena zakupu' },
  returns:     { label:'% zwrotów (30d)' },
  capital:     { label:'Zablokowany kapitał' },
  potential:   { label:'Potencjalny zysk' },
  retUnits:    { label:'Zwroty (szt.)' },
  flags:       { label:'Flagi' },
};

const SALES_COLUMNS  = [
  {key:'units',   mobile:true},
  {key:'stan',    mobile:false},
  {key:'value',   mobile:false},
  {key:'margin',  mobile:false},
  {key:'returns', mobile:true},
];

const TREND_COLUMNS = [
  {key:'units',   mobile:true},
  {key:'stan',    mobile:false},
  {key:'value',   mobile:false},
  {key:'margin',  mobile:false},
  {key:'flags',   mobile:true},
  {key:'returns', mobile:true},
];

const VIEW_DEFS = {
  best7:  {title:'Najlepsza sprzedaż · 7 dni',  period:'s7',  mode:'best', columns:SALES_COLUMNS},
  best14: {title:'Najlepsza sprzedaż · 14 dni', period:'s14+', mode:'best', columns:SALES_COLUMNS},
  best21: {title:'Najlepsza sprzedaż · 21 dni', period:'s21+', mode:'best', columns:SALES_COLUMNS},
  best28: {title:'Najlepsza sprzedaż · 28 dni', period:'s28+', mode:'best', columns:SALES_COLUMNS},
  best30: {title:'Najlepsza sprzedaż · 30 dni', period:'s30',  mode:'best', columns:SALES_COLUMNS},
  noSale: {title:'Brak sprzedaży · 30 dni',     period:'s30',  mode:'noSale', columns:[
    {key:'units',     mobile:false},
    {key:'stan',      mobile:true},
    {key:'capital',   mobile:true},
    {key:'potential', mobile:true},
  ]},
  lowSale:{title:'Niska sprzedaż · 30 dni',     period:'s30',  mode:'lowSale', columns:[
    {key:'units',     mobile:true},
    {key:'stan',      mobile:true},
    {key:'value',     mobile:false},
    {key:'margin',    mobile:false},
    {key:'returns',   mobile:false},
    {key:'capital',   mobile:true},
    {key:'potential', mobile:true},
  ]},
  highRet:{title:'Największe zwroty · 30 dni',  period:'s30',  mode:'highRet', columns:[
    {key:'units',     mobile:true},
    {key:'retUnits',  mobile:true},
    {key:'stan',      mobile:false},
    {key:'value',     mobile:false},
    {key:'margin',    mobile:false},
    {key:'returns',   mobile:true},
  ]},
  margin: {title:'Ranking rentowności', mode:'margin', columns:[
    {key:'cena',       mobile:false},
    {key:'cenaZakupu', mobile:false},
    {key:'margin',     mobile:true},
    {key:'marginPct',  mobile:true},
    {key:'stan',       mobile:false},
  ]},
  trendUp:   {title:'Trend sprzedaży · rosnące',   period:'s30', mode:'trend', trendDirection:'up',   columns:TREND_COLUMNS},
  trendFlat: {title:'Trend sprzedaży · stagnacja', period:'s30', mode:'trend', trendDirection:'flat', columns:TREND_COLUMNS},
  trendDown: {title:'Trend sprzedaży · spadkowe',  period:'s30', mode:'trend', trendDirection:'down', columns:TREND_COLUMNS},
};

/* Kolekcje NK wychodzą co wtorek (zawsze różnica 7 dni) — data w arkuszu
   (kolumna "Kategorie", patrz core/data.js:parseCategories) zapisana jako
   "DD.MM", bez roku. Żeby posortować "N ostatnich" poprawnie także w
   okolicach przełomu roku, rozwiązujemy każdą datę do najbliższego dnia W
   PRZESZŁOŚCI (albo dziś) o tym dniu/miesiącu — jeśli w bieżącym roku
   wypadałaby w przyszłości, cofamy o rok. */
function resolveNkDate(ddmm, today){
  const [d, m] = ddmm.split('.').map(Number);
  if(!d || !m) return null;
  let date = new Date(today.getFullYear(), m - 1, d);
  if(date > today) date = new Date(today.getFullYear() - 1, m - 1, d);
  return date;
}

function recentNkCollections(count = 8){
  const today = new Date();
  const resolved = new Map(); // "DD.MM" -> Date
  products.forEach(p => {
    (p.nkDates || []).forEach(ddmm => {
      if(resolved.has(ddmm)) return;
      const d = resolveNkDate(ddmm, today);
      if(d) resolved.set(ddmm, d);
    });
  });
  return [...resolved.entries()].sort((a, b) => b[1] - a[1]).slice(0, count).map(([ddmm]) => ddmm);
}

function unitsFor(p, key){
  switch(key){
    case 's7': return p.s7;
    case 's14+': return p.s7+p.s14;
    case 's21+': return p.s7+p.s14+p.s21;
    case 's28+': return p.s7+p.s14+p.s21+p.s28;
    case 's30': return p.s30;
  }
}

let currentView = null;
let sortState = {key:'units', dir:'desc'};
let currentSearch = '';
let selectedNkCollections = new Set();
let nkPanelOpen = false;
let saleOnly = false;

export function openCategory(){
  navigateTo('screen-category', 'Dane sprzedażowe');
}

export function openView(key){
  currentView = key;
  currentSearch = '';
  selectedNkCollections = new Set();
  nkPanelOpen = false;
  saleOnly = false;
  document.getElementById('tableSearch').value = '';
  const def = VIEW_DEFS[key];
  if(def.mode==='highRet') sortState = {key:'retUnits', dir:'desc'};
  else if(def.mode==='noSale') sortState = {key:'capital', dir:'desc'};
  else if(def.mode==='lowSale') sortState = {key:'units', dir:'asc'};
  else if(def.mode==='margin') sortState = {key:'margin', dir:'desc'};
  else if(def.mode==='trend') sortState = {key:'units', dir:'desc'};
  else sortState = {key:'units', dir:'desc'};
  navigateTo('screen-table', def.title);
  setupSalesLoadMoreObserver();
  renderTableHead();
  renderNkCollectionPanel();
  updateSaleFilterButton();
  renderTable();
}

export function applySalesSearch(value){
  currentSearch = value;
  renderTable();
}

/* SALE — przełącznik (nie osobny widok): filtruje r.p.isSale RAZEM z
   aktualnie otwartym widokiem (best7/14/.../30, margin, trend...), tak samo
   jak filtr kolekcji NK poniżej — dodatkowy warunek w computeRows, nie
   zamiennik trybu. */
export function toggleSaleOnly(){
  saleOnly = !saleOnly;
  updateSaleFilterButton();
  renderTable();
}

function updateSaleFilterButton(){
  document.getElementById('saleFilterBtn')?.classList.toggle('active', saleOnly);
}

/* Filtr wielokrotnego wyboru kolekcji NK — działa RAZEM z aktywnym widokiem
   (best7/30, margin, trend...), nie zamiast niego: to dodatkowy warunek
   w computeRows, więc np. "SALE + kolekcja 18.08" filtruje po obu naraz. */
export function toggleNkCollectionPanel(){
  nkPanelOpen = !nkPanelOpen;
  renderNkCollectionPanel();
}

export function toggleNkCollection(date){
  if(selectedNkCollections.has(date)) selectedNkCollections.delete(date); else selectedNkCollections.add(date);
  renderTable();
  renderNkCollectionPanel();
}

export function selectAllNkCollections(){
  selectedNkCollections = new Set(recentNkCollections());
  renderTable();
  renderNkCollectionPanel();
}

export function clearNkCollections(){
  selectedNkCollections = new Set();
  renderTable();
  renderNkCollectionPanel();
}

function renderNkCollectionPanel(){
  const panel = document.getElementById('nkCollectionFilterPanel');
  const btn = document.querySelector('#nkCollectionFilterWrap .ms-filter-btn');
  if(!panel || !btn) return;
  panel.classList.toggle('open', nkPanelOpen);
  if(nkPanelOpen){
    const options = recentNkCollections();
    panel.innerHTML = `
      <div class="ms-filter-actions">
        <button type="button" onclick="selectAllNkCollections()">Zaznacz wszystko</button>
        <button type="button" onclick="clearNkCollections()">Wyczyść</button>
      </div>
      ${options.map(d => `
        <label class="ms-filter-option">
          <input type="checkbox" ${selectedNkCollections.has(d) ? 'checked' : ''} onchange="toggleNkCollection('${d}')">
          ${d}
        </label>`).join('') || '<div class="ms-filter-option">Brak danych o kolekcjach</div>'}
    `;
  }
  btn.textContent = (selectedNkCollections.size === 0 ? 'Kolekcja NK' : `Kolekcja NK (${selectedNkCollections.size})`) + ' ▾';
}

document.addEventListener('click', e => {
  const wrap = document.getElementById('nkCollectionFilterWrap');
  if(nkPanelOpen && wrap && !wrap.contains(e.target)){
    nkPanelOpen = false;
    renderNkCollectionPanel();
  }
});

/* Rentowność: ranking marży na sztukę, niezależny od okresu/wolumenu
   sprzedaży (w przeciwieństwie do pozostałych widoków) — tylko produkty
   faktycznie dostępne na stanie, bo dla wyprzedanych marża/szt. nie ma
   praktycznego znaczenia. */
function computeMarginRows(){
  return products
    .filter(p => p.stan > 0 && p.cena > 0)
    .map(p => ({
      p,
      units: 0,
      stan: p.stan,
      value: 0,
      margin: p.narzut,
      marginPct: p.narzut / p.cena * 100,
      cena: p.cena,
      cenaZakupu: p.cenaZakupu,
      returns: p.s30>0 ? (p.ret30/p.s30*100) : (p.ret30>0? 999 : 0),
      capital: p.cena * p.stan,
      potential: p.narzut * p.stan,
      retUnits: p.ret30,
    }));
}

function computeRows(){
  const def = VIEW_DEFS[currentView];

  let rows;
  if(def.mode === 'margin'){
    rows = computeMarginRows();
  } else {
    rows = products.map(p=>{
      const units = unitsFor(p, def.period);
      return {
        p, units,
        stan: p.stan,
        value: units * p.cena,
        margin: units * p.narzut,
        returns: p.s30>0 ? (p.ret30/p.s30*100) : (p.ret30>0? 999 : 0),
        capital: p.cena * p.stan,
        potential: p.narzut * p.stan,
        retUnits: p.ret30,
        flags: (p.trendNew?1:0) + (p.trendHighReturns?1:0),
      };
    });

    if(def.mode==='noSale'){
      rows = rows.filter(r=> r.p.stan>0 && r.p.s30===0);
    } else if(def.mode==='lowSale'){
      rows = rows.filter(r=> r.p.s30>0 && r.p.s30<10 && r.p.stan>0);
    } else if(def.mode==='highRet'){
      rows = rows.filter(r=> r.p.s30>3 && (r.p.ret30/r.p.s30*100) > 30);
    } else if(def.mode==='trend'){
      rows = rows.filter(r=> r.p.trendDirection === def.trendDirection);
    }
  }

  if(currentSearch) rows = rows.filter(r => matchesProductQuery(currentSearch, r.p.id, r.p.name));
  // Kolekcja NK i SALE działają NIEZALEŻNIE od trybu widoku (best7/30, margin,
  // trend...) — dodatkowe warunki, więc np. "SALE + kolekcja 18.08" filtruje
  // po obu naraz, na dowolnym widoku.
  if(selectedNkCollections.size > 0) rows = rows.filter(r => (r.p.nkDates || []).some(d => selectedNkCollections.has(d)));
  if(saleOnly) rows = rows.filter(r => r.p.isSale);

  rows.sort((a,b)=>{
    const dir = sortState.dir==='asc'?1:-1;
    return (a[sortState.key]-b[sortState.key])*dir;
  });

  return rows;
}

export function setSort(key){
  if(sortState.key===key){ sortState.dir = sortState.dir==='asc'?'desc':'asc'; }
  else { sortState = {key, dir:'desc'}; }
  renderTable();
}

function returnBadgeClass(pct){
  if(pct===0) return 'ret-ok';
  if(pct<40) return 'ret-mid';
  return 'ret-bad';
}

function sortLabel(k){
  return {
    units:'sztuki', stan:'stan magazynowy', value:'wartość sprzedaży', margin:'marża',
    marginPct:'marża %', cena:'cena sprzedaży', cenaZakupu:'cena zakupu',
    returns:'% zwrotów', capital:'zablokowany kapitał', potential:'potencjalny zysk', retUnits:'zwroty (szt.)',
    flags:'flagi',
  }[k];
}

function renderTableHead(){
  const def = VIEW_DEFS[currentView];
  const row = document.getElementById('tableHeadRow');
  row.innerHTML = `<th class="rank sticky-col"></th><th class="identity-col sticky-col">Produkt</th>` + def.columns.map(c=>{
    const cls = c.mobile ? '' : ' mobile-hide';
    return `<th data-key="${c.key}" class="${cls}" onclick="setSort('${c.key}')">${COLUMN_DEFS[c.key].label} <span class="arrow"></span></th>`;
  }).join('');
}

function cellHtml(key, row){
  const p = row.p;
  switch(key){
    case 'units': return String(row.units);
    case 'stan': return String(p.stan);
    case 'value': return fmtPLN(row.value);
    case 'margin': return fmtPLN(row.margin);
    case 'marginPct': return row.marginPct.toFixed(1) + '%';
    case 'cena': return fmtPLN(row.cena);
    case 'cenaZakupu': return fmtPLN(row.cenaZakupu);
    case 'capital': return fmtPLN(row.capital);
    case 'potential': return fmtPLN(row.potential);
    case 'retUnits': return String(row.retUnits);
    case 'flags': {
      const badges = [];
      if(p.trendNew) badges.push('<span class="flag-badge flag-new">nowość</span>');
      if(p.trendHighReturns) badges.push('<span class="flag-badge flag-warn">zwroty</span>');
      return badges.length ? badges.join(' ') : '—';
    }
    case 'returns': {
      const retClass = returnBadgeClass(row.returns);
      const retCapped = Math.min(row.returns,100);
      const retLabel = p.s30>0 ? retCapped.toFixed(0)+'%' : (p.ret30>0 ? '⚠️' : '—');
      return `<span class="ret-badge ${retClass}">${retLabel}</span>`;
    }
  }
}

// Strony po TABLE_PAGE_SIZE zamiast dawnego sztywnego "top 50" — kolejne
// porcje dokładają się same przy zjechaniu w dół (setupSalesLoadMoreObserver),
// tym samym wzorcem co components/reorder/reorder.js.
const TABLE_PAGE_SIZE = 50;
let computedRows = [];
let salesRenderedCount = 0;
let salesLoadMoreObserver = null;

function rowHtml(r, i, def){
  const p = r.p;
  const thumb = imgUrl(p.img) || PLACEHOLDER;
  const bars = [p.s7,p.s14,p.s21,p.s28];
  const maxBar = Math.max(...bars,1);
  const swatch = bars.map(v=>`<i style="height:${Math.max(3,(v/maxBar*16))}px"></i>`).join('');
  const cells = def.columns.map(c=>`<td class="num${c.mobile?'':' mobile-hide'}">${cellHtml(c.key, r)}</td>`).join('');
  const extended = def.mode==='best' || def.mode==='margin' || def.mode==='trend';
  return `<tr onclick="openModal(${p.id}, ${extended})">
      <td class="rank sticky-col">${i+1}</td>
      <td class="identity-col sticky-col">
        <div class="prod-cell">
          <img class="prod-thumb" src="${thumb}" referrerpolicy="no-referrer" onerror="this.src='${PLACEHOLDER}'">
          <div>
            <div class="prod-name">${p.name}</div>
            <div class="prod-id">ID ${p.id}${p.kod? ' · '+p.kod:''}</div>
            <div class="swatch">${swatch}</div>
          </div>
        </div>
      </td>
      ${cells}
    </tr>`;
}

export function renderTable(){
  computedRows = computeRows();
  salesRenderedCount = 0;

  document.querySelectorAll('#tableHeadRow th[data-key]').forEach(th=>{
    th.classList.toggle('sorted', th.dataset.key===sortState.key);
    th.querySelector('.arrow').textContent = th.dataset.key===sortState.key ? (sortState.dir==='asc'?'▲':'▼') : '';
  });

  document.getElementById('tableBody').innerHTML = '';
  appendNextSalesPage();
}

function appendNextSalesPage(){
  if(salesRenderedCount >= computedRows.length) return;
  const def = VIEW_DEFS[currentView];
  const tbody = document.getElementById('tableBody');
  const chunk = computedRows.slice(salesRenderedCount, salesRenderedCount + TABLE_PAGE_SIZE);
  const startIndex = salesRenderedCount;
  tbody.insertAdjacentHTML('beforeend', chunk.map((r, i) => rowHtml(r, startIndex + i, def)).join(''));
  salesRenderedCount += chunk.length;

  const pageInfo = salesRenderedCount < computedRows.length ? ` (pokazano ${salesRenderedCount})` : '';
  const countLabel = def.mode==='best' || def.mode==='margin' ? `Top ${computedRows.length} produktów` : `${computedRows.length} produktów spełnia kryteria`;
  document.getElementById('tableInfo').textContent =
    countLabel + pageInfo + ' · sortowanie: ' + sortLabel(sortState.key) + (sortState.dir==='asc' ? ' rosnąco' : ' malejąco');
}

/* Sentinel pod tabelą (index.html) — patrz components/reorder/reorder.js dla
   tego samego wzorca. Ustawiany raz, sentinel jest statyczny w DOM. */
function setupSalesLoadMoreObserver(){
  if(salesLoadMoreObserver) return;
  const sentinel = document.getElementById('salesLoadMoreSentinel');
  if(!sentinel) return;
  salesLoadMoreObserver = new IntersectionObserver(entries => {
    if(entries[0].isIntersecting) appendNextSalesPage();
  }, { rootMargin: '400px' });
  salesLoadMoreObserver.observe(sentinel);
}

document.addEventListener('ferro:data-loaded', ()=>{
  if(document.getElementById('screen-table').classList.contains('active')){
    renderTable();
  }
});
