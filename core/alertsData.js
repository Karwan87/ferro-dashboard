import { parseIntSafe, getCell, parseDate } from './format.js';
import { fetchCsv } from './csv.js';
import { DATA_BASE } from './config.js';

/* Arkusz "Alerts" ma zwykły nagłówek nazwany (w przeciwieństwie do Zwroty/Ordery),
   więc adresujemy kolumny po nazwie, tak jak w core/data.js. */
const CSV_ALERTS = DATA_BASE + 'alerty.csv';

/* Klucz grupowania "ten sam produkt" = ID + atrybut (np. rozmiar) — celowo BEZ
   nazwy, bo nazwa produktu może się zmienić w czasie i nie powinna wpływać
   na to, czy dwa wiersze dotyczą tego samego zgłoszenia. */
function groupKey(productId, attr){
  return productId + '::' + attr;
}

let rawPromise = null;
function loadRaw(){
  if(!rawPromise){
    rawPromise = fetchCsv(CSV_ALERTS).then(rows => rows
      .map(r => ({
        productId: parseIntSafe(getCell(r, 'Nr produktu')),
        name: getCell(r, 'Nazwa produktu') || '',
        attr: getCell(r, 'Atrybuty') || '',
        // Nagłówek w arkuszu ma spację przed "Ilość" (" Ilość zgłoszeń") —
        // Papa Parse bierze nazwę kolumny dosłownie, więc trzeba obu wariantów.
        qty: parseIntSafe(getCell(r, 'Ilość zgłoszeń', ' Ilość zgłoszeń')),
        date: parseDate(getCell(r, 'Data')),
      }))
      .filter(r => r.productId && r.date)
    );
  }
  return rawPromise;
}

/* Okna dni liczone od WCZORAJ wstecz (nie od dzisiaj) — dzisiejsze zgłoszenia
   są jeszcze niepełne (dashboard odświeża dane raz na godzinę), więc "ostatni
   dzień" i pochodne okna odnoszą się do ostatniego w pełni zamkniętego dnia. */
function windowBounds(days){
  const yesterday = new Date();
  yesterday.setHours(0, 0, 0, 0);
  yesterday.setDate(yesterday.getDate() - 1);

  const from = new Date(yesterday);
  from.setDate(from.getDate() - (days - 1));

  return { from, to: yesterday };
}

export async function getAlertsSummary(days){
  const rows = await loadRaw();
  const { from, to } = windowBounds(days);

  const filtered = rows.filter(r => r.date >= from && r.date <= to);

  let total = 0;
  const byProduct = {};
  filtered.forEach(r => {
    total += r.qty;
    const k = groupKey(r.productId, r.attr);
    if(!byProduct[k]) byProduct[k] = { productId: r.productId, name: r.name, attr: r.attr, qty: 0 };
    byProduct[k].qty += r.qty;
    byProduct[k].name = r.name || byProduct[k].name;
  });

  const products = Object.values(byProduct).sort((a, b) => b.qty - a.qty);
  return { total, products };
}

/* Surowe (nieagregowane) zgłoszenia dla JEDNEGO produktu w tym samym oknie
   co getAlertsSummary — do pokazania "który wariant, z którego dnia, ile
   sztuk", zamiast tylko sumy. */
export async function getAlertsForProduct(productId, days){
  const rows = await loadRaw();
  const { from, to } = windowBounds(days);
  return rows
    .filter(r => r.productId === productId && r.date >= from && r.date <= to)
    .sort((a, b) => b.date - a.date || a.attr.localeCompare(b.attr));
}
