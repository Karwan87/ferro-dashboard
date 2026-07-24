import { navigateTo } from '../../core/router.js';
import {
  getSupplierStockValueRanking, getSupplierSalesRanking, getSupplierReturnsRanking,
  getSupplierMarginRanking, getSupplierDemandRanking,
} from '../../core/suppliersData.js';
import { fmtPLN, imgUrl, PLACEHOLDER } from '../../core/format.js';

const szt = v => v.toLocaleString('pl-PL') + ' szt.';

const REPORTS = {
  stockValue: {
    label: 'Wartość zamrożonego kapitału',
    metricLabel: 'Wartość zapasów (zakup)',
    fmtValue: fmtPLN,
    fmtDetail: fmtPLN,
  },
  sales30: {
    label: 'Sprzedaż 30 dni',
    metricLabel: 'Sprzedaż 30 dni',
    fmtValue: szt,
    fmtDetail: szt,
  },
  returns: {
    label: 'Wskaźnik zwrotów',
    metricLabel: '% zwrotów (30 dni, ważone sprzedażą)',
    fmtValue: v => v.toFixed(1) + '%',
    fmtDetail: v => v == null ? '—' : v.toFixed(1) + '%',
    note: 'Liczone jako: suma zwrotów z ostatnich 30 dni ÷ suma sprzedaży z ostatnich 30 dni (dla dostawcy — ważone sprzedażą, więc 1 sprzedana i 1 zwrócona sztuka u małego dostawcy nie wygrywa z dostawcą sprzedającym tysiące sztuk; dla pojedynczego produktu — po prostu jego własne zwroty ÷ jego własna sprzedaż). Sprzedaż i zwroty to dwa NIEZALEŻNE okna czasowe — zwrot policzony w tym oknie może dotyczyć sprzedaży sprzed więcej niż 30 dni. Dlatego wynik może przekroczyć 100%, gdy w danym okresie wróciło więcej sztuk, niż sprzedano nowych — to prawidłowy, niezaokrąglony sygnał, nie błąd.',
    extraColumns: [
      { label: 'Sprzedaż (30 dni)', get: r => r.sprzedaz, fmt: szt },
      { label: 'Zwroty (30 dni)', get: r => r.zwroty, fmt: szt },
    ],
    extraDetailColumns: [
      { label: 'Sprzedaż (30 dni)', get: row => row.s30, fmt: szt },
      { label: 'Zwroty (30 dni)', get: row => row.ret30, fmt: szt },
    ],
  },
  margin: {
    label: 'Marża',
    metricLabel: 'Średnia marża / szt.',
    fmtValue: fmtPLN,
    fmtDetail: fmtPLN,
  },
  demand: {
    label: 'Popyt na braki',
    metricLabel: 'Liczba zgłoszeń',
    fmtValue: v => v.toLocaleString('pl-PL'),
    fmtDetail: v => v.toLocaleString('pl-PL') + ' zgłoszeń',
  },
};

let currentReportKey = null;
let currentRanking = [];
let currentDemandDays = 30;

export function openSuppliersHub(){
  navigateTo('screen-suppliers-category', 'Dostawcy');
}

export async function openSuppliersRanking(key){
  currentReportKey = key;
  const def = REPORTS[key];
  navigateTo('screen-suppliers-ranking', 'Dostawcy · ' + def.label);
  document.getElementById('suppliersRankingNote').textContent = def.note || '';
  document.getElementById('suppliersRankingHead').innerHTML = buildRankingHead(def);
  document.getElementById('suppliersRankingInfo').textContent = 'Ładowanie…';
  document.getElementById('suppliersRankingBody').innerHTML =
    `<tr><td colspan="${rankingColspan(def)}" class="empty-state">Ładowanie…</td></tr>`;

  const getRanking = {
    stockValue: getSupplierStockValueRanking,
    sales30: getSupplierSalesRanking,
    returns: getSupplierReturnsRanking,
    margin: getSupplierMarginRanking,
  }[key];

  try{
    const ranking = getRanking();
    currentRanking = ranking;
    renderRankingTable(def, ranking);
  } catch(err){
    document.getElementById('suppliersRankingInfo').textContent = 'Błąd pobierania danych';
    document.getElementById('suppliersRankingBody').innerHTML =
      `<tr><td colspan="${rankingColspan(def)}" class="empty-state">Nie udało się pobrać danych (${err.message}).</td></tr>`;
  }
}

function rankingColspan(def){
  return 4 + (def.extraColumns?.length || 0);
}

function buildRankingHead(def){
  const extra = (def.extraColumns || []).map(c => `<th>${c.label}</th>`).join('');
  return `<th class="rank sticky-col"></th><th class="identity-col sticky-col">Dostawca</th><th>Liczba SKU</th>${extra}<th>${def.metricLabel}</th>`;
}

function renderRankingTable(def, ranking){
  const info = document.getElementById('suppliersRankingInfo');
  const tbody = document.getElementById('suppliersRankingBody');
  if(ranking.length === 0){
    info.textContent = 'Brak danych.';
    tbody.innerHTML = `<tr><td colspan="${rankingColspan(def)}" class="empty-state">Brak danych.</td></tr>`;
    return;
  }
  info.textContent = `${ranking.length} dostawców`;
  tbody.innerHTML = ranking.map((r, i) => {
    const extra = (def.extraColumns || []).map(c => `<td class="num">${c.fmt(c.get(r))}</td>`).join('');
    return `<tr onclick="openSupplierDetail(${i})">
      <td class="rank sticky-col">${i + 1}</td>
      <td class="identity-col sticky-col">${r.dostawca}</td>
      <td class="num">${r.skuCount}</td>
      ${extra}
      <td class="num">${def.fmtValue(r.value)}</td>
    </tr>`;
  }).join('');
}

export function openSupplierDetail(index){
  const def = REPORTS[currentReportKey];
  const r = currentRanking[index];
  navigateTo('screen-suppliers-detail', `Dostawcy · ${def.label} · ${r.dostawca}`);
  document.getElementById('suppliersDetailNote').textContent = def.note || '';
  document.getElementById('suppliersDetailHead').innerHTML = buildDetailHead(def);
  document.getElementById('suppliersDetailInfo').textContent = `${r.detailRows.length} produktów`;
  document.getElementById('suppliersDetailBody').innerHTML = r.detailRows.map((row, i) => {
    const extra = (def.extraDetailColumns || []).map(c => `<td class="num">${c.fmt(c.get(row))}</td>`).join('');
    return `<tr onclick="openModal(${row.id}, true)">
      <td class="rank sticky-col">${i + 1}</td>
      <td class="identity-col sticky-col">
        <div class="prod-cell">
          <img class="prod-thumb" src="${imgUrl(row.img) || PLACEHOLDER}" referrerpolicy="no-referrer" onerror="this.src='${PLACEHOLDER}'">
          <div>
            <div class="prod-name">${row.name}</div>
            <div class="prod-id">ID ${row.id}</div>
          </div>
        </div>
      </td>
      ${extra}
      <td class="num">${def.fmtDetail(row.metricValue)}</td>
    </tr>`;
  }).join('');
}

function buildDetailHead(def){
  const extra = (def.extraDetailColumns || []).map(c => `<th>${c.label}</th>`).join('');
  return `<th class="rank sticky-col"></th><th class="identity-col sticky-col">Produkt</th>${extra}<th>${def.metricLabel}</th>`;
}

/* --- Popyt na braki: osobny przepływ, bo ma własny wybór okresu --- */
const DEMAND_PERIODS = { d7: 7, d14: 14, d30: 30 };

export function openSuppliersDemandHub(){
  navigateTo('screen-suppliers-demand', 'Dostawcy · Popyt na braki');
  applySuppliersDemandPeriod('d30');
}

export function applySuppliersDemandPeriod(key){
  currentDemandDays = DEMAND_PERIODS[key];
  document.querySelectorAll('#suppliersDemandFilters .pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.key === key);
  });
  renderDemandRanking();
}

async function renderDemandRanking(){
  const info = document.getElementById('suppliersDemandInfo');
  const tbody = document.getElementById('suppliersDemandBody');
  info.textContent = 'Ładowanie…';
  tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Ładowanie…</td></tr>`;

  try{
    const ranking = await getSupplierDemandRanking(currentDemandDays);
    currentReportKey = 'demand';
    currentRanking = ranking;

    if(ranking.length === 0){
      info.textContent = 'Brak zgłoszeń w tym okresie.';
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Brak zgłoszeń.</td></tr>`;
      return;
    }

    info.textContent = `${ranking.length} dostawców`;
    tbody.innerHTML = ranking.map((r, i) => `
      <tr onclick="openSupplierDetail(${i})">
        <td class="rank sticky-col">${i + 1}</td>
        <td class="identity-col sticky-col">${r.dostawca}</td>
        <td class="num">${r.skuCount}</td>
        <td class="num">${r.value.toLocaleString('pl-PL')}</td>
        <td class="num">${r.outOfStock}</td>
      </tr>
    `).join('');
  } catch(err){
    info.textContent = 'Błąd pobierania danych';
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Nie udało się pobrać danych (${err.message}).</td></tr>`;
  }
}
