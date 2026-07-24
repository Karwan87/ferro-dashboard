import { navigateTo } from '../../core/router.js';
import { getLiveStockSummary, getProductMetaMap, getStockForDate, getStockSeries } from '../../core/stockData.js';
import { fmtPLN, imgUrl, PLACEHOLDER } from '../../core/format.js';

const CHART_PERIODS = { d7: 7, d14: 14, d30: 30, d60: 60, d90: 90 };
const COLOR_BUY = '#8B2942';   // --berry
const COLOR_SELL = '#C9A227';  // --gold
const COLOR_QTY = '#B5482F';   // --rust (paleta zwalidowana z berry+gold jako trójka — sage nie przechodził progu chroma)
const GRID_COLOR = '#E4DCC9';  // spójne z .cf-total-row / innymi hairline na jasnych kartach

let currentChartPeriod = 'd30';
let lastSeries = [];

function isoDate(d){ return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function fmtDatePlShort(iso){ const [, m, d] = iso.split('-'); return `${d}.${m}`; }
function fmtDatePlFull(iso){ const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; }

export function openStockHub(){
  navigateTo('screen-stock-dashboard', 'Stany magazynowe');
  // Codzienny snapshot zapisuje "dziś" tuż po północy, więc do końca dnia
  // "dziś" jest już prawidłową, dostępną datą — nie trzeba ograniczać do
  // wczoraj. Gdyby ktoś otworzył panel w wąskim oknie przed samym
  // snapshotem (00:00-01:10 czasu warszawskiego), getStockForDate i tak
  // spadnie na najbliższą wcześniejszą dostępną datę z adnotacją.
  document.getElementById('stockDateInput').max = isoDate(new Date());
  renderLiveStats();
  applyStockChartPeriod('d30');
}

async function renderLiveStats(){
  ['stockLiveQty', 'stockLiveBuy', 'stockLiveSell'].forEach(id => { document.getElementById(id).textContent = '…'; });
  document.getElementById('stockLiveError').textContent = '';
  try{
    const s = await getLiveStockSummary();
    document.getElementById('stockLiveQty').textContent = s.ilosc.toLocaleString('pl-PL');
    document.getElementById('stockLiveBuy').textContent = fmtPLN(s.wartoscZakup);
    document.getElementById('stockLiveSell').textContent = fmtPLN(s.wartoscSprzedaz);
  } catch(err){
    ['stockLiveQty', 'stockLiveBuy', 'stockLiveSell'].forEach(id => { document.getElementById(id).textContent = '—'; });
    document.getElementById('stockLiveError').textContent =
      `Nie udało się pobrać danych (${err.message}). Sprawdź, czy zakładka "DB" jest nadal udostępniona kontu serwisowemu.`;
  }
}

export function toggleStockDateResults(){
  const wrap = document.getElementById('stockDateResultsWrap');
  const btn = document.getElementById('stockDateToggle');
  const willShow = wrap.hidden;
  wrap.hidden = !willShow;
  btn.textContent = willShow ? 'Schowaj tabelę' : 'Pokaż tabelę';
}

export async function showStockForDate(){
  const input = document.getElementById('stockDateInput');
  const info = document.getElementById('stockDateInfo');
  const tbody = document.getElementById('stockDateTableBody');
  if(!input.value) return;

  document.getElementById('stockDateResultsWrap').hidden = false;
  document.getElementById('stockDateToggle').hidden = false;
  document.getElementById('stockDateToggle').textContent = 'Schowaj tabelę';
  ['stockDateQty', 'stockDateBuy', 'stockDateSell'].forEach(id => { document.getElementById(id).textContent = '…'; });
  info.textContent = 'Ładowanie…';
  tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Ładowanie…</td></tr>`;

  try{
    const [result, metaMap] = await Promise.all([getStockForDate(input.value), getProductMetaMap()]);
    if(!result){
      ['stockDateQty', 'stockDateBuy', 'stockDateSell'].forEach(id => { document.getElementById(id).textContent = '—'; });
      info.textContent = 'Brak danych archiwalnych — historia stanów magazynowych jeszcze się nie zebrała.';
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Brak danych.</td></tr>`;
      return;
    }

    const rows = result.rows.filter(r => r.id).sort((a, b) => b.ilosc - a.ilosc);

    const totalQty = rows.reduce((sum, r) => sum + r.ilosc, 0);
    const totalBuy = rows.reduce((sum, r) => sum + r.wartoscZakup, 0);
    const hasSell = rows.some(r => r.wartoscSprzedaz != null);
    const totalSell = hasSell ? rows.reduce((sum, r) => sum + (r.wartoscSprzedaz || 0), 0) : null;
    document.getElementById('stockDateQty').textContent = totalQty.toLocaleString('pl-PL');
    document.getElementById('stockDateBuy').textContent = fmtPLN(totalBuy);
    document.getElementById('stockDateSell').textContent = totalSell == null ? '—' : fmtPLN(totalSell);

    info.textContent = result.exact
      ? `${rows.length} produktów · stan na ${fmtDatePlFull(result.date)}`
      : `Brak danych dokładnie na ${fmtDatePlFull(result.requestedDate)} — pokazuję najbliższą wcześniejszą dostępną datę: ${fmtDatePlFull(result.date)} (${rows.length} produktów)`;

    if(rows.length === 0){
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Brak produktów w tym wpisie.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map((r, i) => {
      const meta = metaMap.get(r.id);
      const thumb = meta ? (imgUrl(meta.img) || PLACEHOLDER) : PLACEHOLDER;
      const name = meta ? meta.name : ('Produkt #' + r.id);
      const rowAttrs = meta
        ? `onclick="openModal(${r.id}, true)"`
        : '';
      return `<tr ${rowAttrs}>
        <td class="rank sticky-col">${i + 1}</td>
        <td class="identity-col sticky-col">
          <div class="prod-cell">
            <img class="prod-thumb" src="${thumb}" referrerpolicy="no-referrer" onerror="this.src='${PLACEHOLDER}'">
            <div>
              <div class="prod-name">${name}</div>
              <div class="prod-id">ID ${r.id}</div>
            </div>
          </div>
        </td>
        <td class="num">${r.ilosc.toLocaleString('pl-PL')}</td>
        <td class="num">${fmtPLN(r.wartoscZakup)}</td>
        <td class="num">${r.wartoscSprzedaz == null ? '—' : fmtPLN(r.wartoscSprzedaz)}</td>
      </tr>`;
    }).join('');
  } catch(err){
    info.textContent = `Błąd pobierania danych (${err.message}).`;
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Błąd.</td></tr>`;
  }
}

export function applyStockChartPeriod(key){
  currentChartPeriod = key;
  document.querySelectorAll('#stockChartFilters .pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.key === key);
  });
  renderCharts(CHART_PERIODS[key]);
}

export function toggleStockChartTable(){
  const wrap = document.getElementById('stockChartTableWrap');
  const btn = document.getElementById('stockChartTableToggle');
  const willShow = wrap.hidden;
  wrap.hidden = !willShow;
  btn.textContent = willShow ? 'Ukryj dane w tabeli' : 'Pokaż dane w tabeli';
  if(willShow) renderChartTable(lastSeries);
}

async function renderCharts(days){
  const chartEl = document.getElementById('stockCombinedChart');
  chartEl.innerHTML = '<p class="chart-loading">Ładowanie…</p>';
  document.getElementById('stockChartError').textContent = '';

  try{
    const series = await getStockSeries(days);
    lastSeries = series;

    if(series.length === 0){
      chartEl.innerHTML = '<p class="empty-state">Brak danych historycznych w tym okresie.</p>';
      if(!document.getElementById('stockChartTableWrap').hidden) renderChartTable(series);
      return;
    }

    const dates = series.map(s => s.date);
    renderLineChart(chartEl, {
      dates,
      series: [
        { label: 'Wartość — po cenie zakupu', color: COLOR_BUY, values: series.map(s => s.wartoscZakup), axis: 'left', unitSuffix: 'zł' },
        { label: 'Wartość — po cenie sprzedaży netto', color: COLOR_SELL, values: series.map(s => s.wartoscSprzedaz), axis: 'left', unitSuffix: 'zł' },
        { label: 'Suma sztuk', color: COLOR_QTY, values: series.map(s => s.ilosc), axis: 'right', unitSuffix: 'szt.' },
      ],
    });

    if(!document.getElementById('stockChartTableWrap').hidden) renderChartTable(series);
  } catch(err){
    chartEl.innerHTML = '';
    document.getElementById('stockChartError').textContent = `Nie udało się pobrać danych (${err.message}).`;
  }
}

function renderChartTable(series){
  const tbody = document.getElementById('stockChartTableBody');
  if(series.length === 0){
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Brak danych.</td></tr>`;
    return;
  }
  tbody.innerHTML = series.map(s => `
    <tr>
      <td>${fmtDatePlFull(s.date)}</td>
      <td class="num">${s.ilosc.toLocaleString('pl-PL')}</td>
      <td class="num">${fmtPLN(s.wartoscZakup)}</td>
      <td class="num">${s.wartoscSprzedaz == null ? '—' : fmtPLN(s.wartoscSprzedaz)}</td>
    </tr>
  `).join('');
}

/* ---------- mały, samodzielny wykres liniowy (SVG) ----------
   Dwie serie "wartość" (lewa oś, zł) + jedna seria "ilość" (prawa oś,
   szt.) na jednym wykresie — na wyraźne życzenie, mimo że druga oś jest
   ryzykowna (dwie niezależne skale mogą sugerować związek, którego nie
   ma). Ograniczamy ryzyko: siatka rysowana tylko dla lewej osi, prawa ma
   wyłącznie opisane tick-i, a tożsamość serii niesie legenda + tooltip
   (nigdy sam kolor linii). */
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

function compactNum(n){
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if(abs >= 1e6) return sign + (abs / 1e6).toLocaleString('pl-PL', { maximumFractionDigits: 1 }) + 'M';
  if(abs >= 1e3) return sign + (abs / 1e3).toLocaleString('pl-PL', { maximumFractionDigits: 1 }) + 'K';
  return sign + Math.round(abs).toLocaleString('pl-PL');
}

const VB_W = 720, VB_H = 220;
const M_LEFT = 46, M_RIGHT = 58, M_TOP = 14, M_BOTTOM = 26;
const PLOT_W = VB_W - M_LEFT - M_RIGHT;
const PLOT_H = VB_H - M_TOP - M_BOTTOM;
const GRID_TICKS = 4;

function renderLineChart(container, { dates, series }){
  const leftSeries = series.filter(s => s.axis !== 'right');
  const rightSeries = series.filter(s => s.axis === 'right');

  const maxOf = list => {
    const vals = list.flatMap(s => s.values.filter(v => v != null));
    return vals.length ? niceMax(Math.max(...vals, 0)) : 1;
  };
  const maxLeft = maxOf(leftSeries);
  const maxRight = rightSeries.length ? maxOf(rightSeries) : 1;

  const xAt = i => M_LEFT + (dates.length <= 1 ? PLOT_W / 2 : (i / (dates.length - 1)) * PLOT_W);
  const yFrac = frac => M_TOP + PLOT_H - frac * PLOT_H;
  const yAtLeft = v => yFrac(maxLeft === 0 ? 0 : v / maxLeft);
  const yAtRight = v => yFrac(maxRight === 0 ? 0 : v / maxRight);
  const yAtFor = s => (s.axis === 'right' ? yAtRight : yAtLeft);

  let gridMarkup = '';
  for(let t = 0; t <= GRID_TICKS; t++){
    const frac = t / GRID_TICKS;
    const y = yFrac(frac);
    gridMarkup += `<line x1="${M_LEFT}" y1="${y}" x2="${VB_W - M_RIGHT}" y2="${y}" stroke="${GRID_COLOR}" stroke-width="1"/>`;
    gridMarkup += `<text x="${M_LEFT - 8}" y="${y + 4}" text-anchor="end" class="chart-axis-label">${compactNum(maxLeft * frac)}</text>`;
    if(rightSeries.length){
      gridMarkup += `<text x="${VB_W - M_RIGHT + 8}" y="${y + 4}" text-anchor="start" class="chart-axis-label">${compactNum(maxRight * frac)}</text>`;
    }
  }

  const xIdxs = dates.length <= 2 ? dates.map((_, i) => i) : [0, Math.floor((dates.length - 1) / 2), dates.length - 1];
  let xLabelMarkup = '';
  xIdxs.forEach(i => {
    xLabelMarkup += `<text x="${xAt(i)}" y="${VB_H - 6}" text-anchor="middle" class="chart-axis-label">${fmtDatePlShort(dates[i])}</text>`;
  });

  let seriesMarkup = '';
  series.forEach(s => {
    const yAt = yAtFor(s);
    let segments = [];
    let current = [];
    dates.forEach((d, i) => {
      const v = s.values[i];
      if(v == null){
        if(current.length) segments.push(current);
        current = [];
        return;
      }
      current.push(`${xAt(i)},${yAt(v)}`);
    });
    if(current.length) segments.push(current);
    segments.forEach(seg => {
      seriesMarkup += `<polyline points="${seg.join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    });
    dates.forEach((d, i) => {
      const v = s.values[i];
      if(v == null) return;
      seriesMarkup += `<circle cx="${xAt(i)}" cy="${yAt(v)}" r="4" fill="${s.color}" class="chart-marker"/>`;
    });
    for(let i = dates.length - 1; i >= 0; i--){
      const v = s.values[i];
      if(v == null) continue;
      const label = compactNum(v) + (s.unitSuffix ? ' ' + s.unitSuffix : '');
      seriesMarkup += `<text x="${Math.min(xAt(i) + 8, VB_W - M_RIGHT + 2)}" y="${yAt(v) + 4}" class="chart-end-label">${label}</text>`;
      break;
    }
  });

  const legendMarkup = `<div class="chart-legend">${series.map(s => `<span class="legend-item"><span class="legend-swatch" style="background:${s.color}"></span>${s.label}</span>`).join('')}</div>`;

  container.innerHTML = `
    ${legendMarkup}
    <div class="chart-svg-wrap">
      <svg viewBox="0 0 ${VB_W} ${VB_H}" class="stock-chart-svg" preserveAspectRatio="xMidYMid meet">
        ${gridMarkup}
        ${seriesMarkup}
        ${xLabelMarkup}
        <rect class="chart-hover-capture" x="${M_LEFT}" y="0" width="${PLOT_W}" height="${VB_H}" fill="transparent"/>
        <line class="chart-crosshair" x1="0" y1="${M_TOP}" x2="0" y2="${M_TOP + PLOT_H}" opacity="0"/>
      </svg>
      <div class="chart-tooltip" hidden></div>
    </div>`;

  attachChartHover(container, dates, series, xAt);
}

function attachChartHover(container, dates, series, xAt){
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
    let idx = dates.length <= 1 ? 0 : Math.round(((localX - M_LEFT) / PLOT_W) * (dates.length - 1));
    idx = Math.max(0, Math.min(dates.length - 1, idx));

    const xPix = xAt(idx);
    crosshair.setAttribute('x1', xPix);
    crosshair.setAttribute('x2', xPix);
    crosshair.setAttribute('opacity', '1');

    tooltip.innerHTML = '';
    const dateEl = document.createElement('div');
    dateEl.className = 'tooltip-date';
    dateEl.textContent = fmtDatePlFull(dates[idx]);
    tooltip.appendChild(dateEl);
    series.forEach(s => {
      const v = s.values[idx];
      const row = document.createElement('div');
      row.className = 'tooltip-row';
      const key = document.createElement('span');
      key.className = 'tooltip-key';
      key.style.background = s.color;
      const label = document.createElement('span');
      label.className = 'tooltip-label';
      label.textContent = s.label;
      const val = document.createElement('strong');
      val.className = 'tooltip-val';
      val.textContent = v == null ? '—' : `${v.toLocaleString('pl-PL', { maximumFractionDigits: 2 })} ${s.unitSuffix}`;
      row.append(key, label, val);
      tooltip.appendChild(row);
    });
    tooltip.hidden = false;

    const pixelX = (xPix / VB_W) * svgRect.width + (svgRect.left - wrapRect.left);
    const tooltipWidth = tooltip.offsetWidth || 150;
    tooltip.style.left = Math.max(4, Math.min(wrapRect.width - tooltipWidth - 4, pixelX + 10)) + 'px';
    tooltip.style.top = '6px';
  }

  capture.addEventListener('mousemove', e => update(e.clientX));
  capture.addEventListener('mouseleave', () => {
    crosshair.setAttribute('opacity', '0');
    tooltip.hidden = true;
  });
}
