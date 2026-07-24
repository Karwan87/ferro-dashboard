import { navigateTo } from '../../core/router.js';
import { products } from '../../core/data.js';
import { fmtPLN, imgUrl, PLACEHOLDER } from '../../core/format.js';

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

export function openCategory(){
  navigateTo('screen-category', 'Dane sprzedażowe');
}

export function openView(key){
  currentView = key;
  const def = VIEW_DEFS[key];
  if(def.mode==='highRet') sortState = {key:'retUnits', dir:'desc'};
  else if(def.mode==='noSale') sortState = {key:'capital', dir:'desc'};
  else if(def.mode==='lowSale') sortState = {key:'units', dir:'asc'};
  else if(def.mode==='margin') sortState = {key:'margin', dir:'desc'};
  else if(def.mode==='trend') sortState = {key:'units', dir:'desc'};
  else sortState = {key:'units', dir:'desc'};
  navigateTo('screen-table', def.title);
  renderTableHead();
  renderTable();
}

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

  rows.sort((a,b)=>{
    const dir = sortState.dir==='asc'?1:-1;
    return (a[sortState.key]-b[sortState.key])*dir;
  });

  return rows.slice(0,50);
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

export function renderTable(){
  const def = VIEW_DEFS[currentView];
  const rows = computeRows();
  document.getElementById('tableInfo').textContent =
    (def.mode==='best' || def.mode==='margin' ? `Top ${rows.length} produktów` : `${rows.length} produktów spełnia kryteria`) +
    ' · sortowanie: ' + sortLabel(sortState.key) + (sortState.dir==='asc' ? ' rosnąco' : ' malejąco');

  document.querySelectorAll('thead th[data-key]').forEach(th=>{
    th.classList.toggle('sorted', th.dataset.key===sortState.key);
    th.querySelector('.arrow').textContent = th.dataset.key===sortState.key ? (sortState.dir==='asc'?'▲':'▼') : '';
  });

  const extended = def.mode==='best' || def.mode==='margin' || def.mode==='trend';
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = rows.map((r,i)=>{
    const p = r.p;
    const thumb = imgUrl(p.img) || PLACEHOLDER;
    const bars = [p.s7,p.s14,p.s21,p.s28];
    const maxBar = Math.max(...bars,1);
    const swatch = bars.map(v=>`<i style="height:${Math.max(3,(v/maxBar*16))}px"></i>`).join('');
    const cells = def.columns.map(c=>`<td class="num${c.mobile?'':' mobile-hide'}">${cellHtml(c.key, r)}</td>`).join('');
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
  }).join('');
}

document.addEventListener('ferro:data-loaded', ()=>{
  if(document.getElementById('screen-table').classList.contains('active')){
    renderTable();
  }
});
