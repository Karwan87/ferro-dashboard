import { products } from './data.js';
import { getAlertsSummary } from './alertsData.js';

// Cena sprzedaży i cena zakupu są w arkuszu obie netto — narzut/marżę
// liczymy więc wprost na wartościach netto, bez doliczania VAT.
function profitMetrics(p){
  const zysk = p.cena - p.cenaZakupu;
  return {
    narzutPct: p.cenaZakupu > 0 ? (zysk / p.cenaZakupu * 100) : null,
    marzaPct: p.cena > 0 ? (zysk / p.cena * 100) : null,
  };
}

/* Cała baza produktów (NIE tylko oznaczone w arkuszu Panel jako "Czy do
   domówienia? = TAK") — właściciel chce tu przeglądać i sortować cały
   katalog, nie tylko zgłoszone braki. `czyDoDomowienia`/`zamowiono` zostają
   w danych, więc filtry pill (Czeka na zamówienie / Już zamówione) nadal
   mają sens. Dokładamy priorytet: liczbę zgłoszeń z Alertów w wybranym
   oknie (domyślnie 7 dni), żeby odróżnić "brakuje, ale nikt nie pyta" od
   "brakuje i klienci czekają" — używane jako drugorzędne sortowanie w UI. */
export async function getReorderList(alertDays = 7){
  const { products: alertRows } = await getAlertsSummary(alertDays);
  const alertsByProductId = new Map();
  alertRows.forEach(r => {
    alertsByProductId.set(r.productId, (alertsByProductId.get(r.productId) || 0) + r.qty);
  });

  const rows = products
    .map(p => ({
      id: p.id,
      name: p.name,
      img: p.img,
      dostawca: p.dostawca,
      stan: p.stan,
      minStock: p.minStock,
      ilDoDomowienia: p.ilDoDomowienia,
      cenaZakupu: p.cenaZakupu,
      zamowiono: p.zamowiono,
      czyDoDomowienia: p.czyDoDomowienia,
      alerty: alertsByProductId.get(p.id) || 0,
      ...profitMetrics(p),
      zwrotyPct: p.s30 > 0 ? Math.min(p.ret30 / p.s30 * 100, 100) : null,
    }))
    // Domyślne sortowanie: ilość do domówienia, malejąco.
    .sort((a, b) => b.ilDoDomowienia - a.ilDoDomowienia);

  const totals = {
    count: rows.length,
    doDomowienia: rows.filter(r => r.czyDoDomowienia).length,
    czekaNaZamowienie: rows.filter(r => r.czyDoDomowienia && !r.zamowiono).length,
    juzZamowione: rows.filter(r => r.czyDoDomowienia && r.zamowiono).length,
  };

  return { rows, totals };
}
