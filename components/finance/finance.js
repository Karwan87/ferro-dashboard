import { navigateTo } from '../../core/router.js';
import { getFinanceSummary } from '../../core/financeData.js';
import { fmtPLN } from '../../core/format.js';

function startOfDay(d){
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/* Tydzień kalendarzowy dla Finansów biegnie piątek->czwartek (ustalenie
   biznesowe, inne niż standardowy tydzień pon-nd). offsetWeeks=0 -> tydzień
   zawierający dzisiaj, -1 -> poprzedni taki cykl. */
function fridayThursdayWeek(offsetWeeks){
  const today = startOfDay(new Date());
  const daysSinceFriday = (today.getDay() - 5 + 7) % 7;
  const currentFriday = new Date(today);
  currentFriday.setDate(today.getDate() - daysSinceFriday);
  const friday = new Date(currentFriday);
  friday.setDate(currentFriday.getDate() + offsetWeeks * 7);
  const thursday = new Date(friday);
  thursday.setDate(friday.getDate() + 6);
  return { start: friday, end: thursday };
}

const PRESETS = {
  yesterday: () => {
    const d = startOfDay(new Date());
    d.setDate(d.getDate() - 1);
    return { start: d, end: d, label: 'Poprzedni dzień' };
  },
  currentWeek: () => ({ ...fridayThursdayWeek(0), label: 'Bieżący tydzień (pt-czw)' }),
  lastWeek: () => ({ ...fridayThursdayWeek(-1), label: 'Ostatni tydzień (pt-czw)' }),
  currentMonth: () => {
    const now = new Date();
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: startOfDay(now), label: 'Bieżący miesiąc' };
  },
  lastMonth: () => {
    const now = new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      end: new Date(now.getFullYear(), now.getMonth(), 0),
      label: 'Ostatni miesiąc',
    };
  },
  currentYear: () => {
    const now = new Date();
    return { start: new Date(now.getFullYear(), 0, 1), end: startOfDay(now), label: 'Bieżący rok' };
  },
};

let currentRange = null;

export function openFinanceHub(){
  navigateTo('screen-finance-category', 'Finanse');
}

export function openFinanceSales(){
  navigateTo('screen-finance-dashboard', 'Finanse · Wartości sprzedaży');
  applyFinancePreset('currentMonth');
}

export function applyFinancePreset(key){
  currentRange = PRESETS[key]();
  highlightActive(key);
  render();
}

export function applyFinanceCustomRange(){
  const fromEl = document.getElementById('financeDateFrom');
  const toEl = document.getElementById('financeDateTo');
  if(!fromEl.value || !toEl.value) return;

  const start = startOfDay(new Date(fromEl.value));
  const end = startOfDay(new Date(toEl.value));
  currentRange = { start, end, label: `Zakres: ${fromEl.value} – ${toEl.value}` };
  highlightActive('custom');
  render();
}

function highlightActive(key){
  document.querySelectorAll('#financeFilters .pill').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.key === key);
  });
}

async function render(){
  document.getElementById('financeRangeLabel').textContent = currentRange.label;
  document.getElementById('financeError').textContent = '';
  ['financeGross', 'financeProfit', 'financeMargin', 'financeShipping'].forEach(id=>{
    document.getElementById(id).textContent = '…';
  });

  try{
    const stats = await getFinanceSummary(currentRange.start, currentRange.end);
    document.getElementById('financeGross').textContent = fmtPLN(stats.grossSales);
    document.getElementById('financeProfit').textContent = fmtPLN(stats.netProfit);
    document.getElementById('financeMargin').textContent = fmtPLN(stats.margin);
    document.getElementById('financeShipping').textContent = fmtPLN(stats.shippingRevenue);
  } catch(err){
    ['financeGross', 'financeProfit', 'financeMargin', 'financeShipping'].forEach(id=>{
      document.getElementById(id).textContent = '—';
    });
    document.getElementById('financeError').textContent =
      `Nie udało się pobrać danych (${err.message}). Sprawdź, czy arkusz Ordery jest udostępniony kontu serwisowemu.`;
  }
}
