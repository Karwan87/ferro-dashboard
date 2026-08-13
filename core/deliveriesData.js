import { getCell, parseIntSafe, parseDate } from './format.js';
import { fetchCsv } from './csv.js';
import { DATA_BASE } from './config.js';

/* Ten sam arkusz "Logi" (zakładka dostawy.csv) co core/data.js używa do
   sumy historycznej "Dostarczono" — ale TAM data dostawy jest odrzucana
   (liczy się tylko suma), a tutaj właśnie data jest najważniejsza: musimy
   wiedzieć, ile sztuk PRZYSZŁO PO konkretnej dacie zamówienia (core/reorderCart.js),
   żeby wykryć realizację zamówienia. Kolumna daty w arkuszu nazywa się
   dosłownie "Uwtorzone" (literówka w samym arkuszu, nie u nas — sprawdzone
   na żywym układzie kolumn). WCZEŚNIEJ było tu błędnie założone "Data", co
   znaczyło, że filtr po dacie nigdy niczego nie dopasowywał. */
const CSV_DELIVERIES = DATA_BASE + 'dostawy.csv';
const DELIVERY_OPIS_VALUE = 'Dostawa';

// Cache tylko na czas jednej sesji danych — zerowany przy każdym
// 'ferro:data-loaded' (logowanie / kliknięcie "Odśwież"), żeby dostawy nie
// zamrażały się na starym stanie do końca sesji w przeglądarce.
let cache = null;
function loadDeliveries(){
  if(!cache) cache = fetchCsv(CSV_DELIVERIES);
  return cache;
}
document.addEventListener('ferro:data-loaded', () => { cache = null; });

/* Suma dostarczonych sztuk danego produktu OD (włącznie) podanej daty. */
export async function getDeliveredQtySince(productId, sinceDate){
  const rows = await loadDeliveries();
  let total = 0;
  rows.forEach(r => {
    if(getCell(r, 'Opis').trim() !== DELIVERY_OPIS_VALUE) return;
    if(parseIntSafe(getCell(r, 'Produkt')) !== productId) return;
    const d = parseDate(getCell(r, 'Uwtorzone'));
    if(!d || d < sinceDate) return;
    total += parseIntSafe(getCell(r, 'Ilość'));
  });
  return total;
}
