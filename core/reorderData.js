import { products } from './data.js';
import { getAlertsSummary } from './alertsData.js';
import { getProductCartStatus } from './reorderCart.js';

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
   katalog, nie tylko zgłoszone braki. `czyDoDomowienia` zostaje w danych,
   więc statystyka "oznaczonych do domówienia" nadal ma sens; "czeka na
   zamówienie" liczy się już wyłącznie z żywego statusu koszyka
   (core/reorderCart.js) — stara ręczna flaga arkusza "Zamówiono?" została
   wycofana jako zbędna (i tak nieaktualizowana automatycznie). Dokładamy
   priorytet: liczbę zgłoszeń z Alertów w wybranym oknie (domyślnie 7 dni),
   żeby odróżnić "brakuje, ale nikt nie pyta" od "brakuje i klienci czekają"
   — używane jako drugorzędne sortowanie w UI. */
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
      sales7d: p.s7,
      cenaZakupu: p.cenaZakupu,
      czyDoDomowienia: p.czyDoDomowienia,
      alerty: alertsByProductId.get(p.id) || 0,
      ...profitMetrics(p),
      zwrotyPct: p.s30 > 0 ? Math.min(p.ret30 / p.s30 * 100, 100) : null,
    }))
    // Domyślne sortowanie: sprzedaż z ostatnich 7 dni, malejąco.
    .sort((a, b) => b.sales7d - a.sales7d);

  const totals = {
    count: rows.length,
    doDomowienia: rows.filter(r => r.czyDoDomowienia).length,
    czekaNaZamowienie: rows.filter(r => r.czyDoDomowienia && getProductCartStatus(r.id) !== 'ordered').length,
  };

  return { rows, totals };
}
