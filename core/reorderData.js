import { products } from './data.js';
import { getAlertsSummary } from './alertsData.js';

/* Lista "do zamówienia" = to, co ktoś już oznaczył w arkuszu Panel jako
   "Czy do domówienia? = TAK" — nie liczymy tego sami z Aktualny stan/Min
   stock, bo decyzja "trzeba zamówić" bywa ręczna (np. produkt wycofywany
   nie powinien się tu pojawić mimo niskiego stanu). Dokładamy tylko
   priorytet: liczbę zgłoszeń z Alertów w wybranym oknie, żeby odróżnić
   "brakuje, ale nikt nie pyta" od "brakuje i klienci czekają". */
export async function getReorderList(alertDays = 30){
  const { products: alertRows } = await getAlertsSummary(alertDays);
  const alertsByProductId = new Map();
  alertRows.forEach(r => {
    alertsByProductId.set(r.productId, (alertsByProductId.get(r.productId) || 0) + r.qty);
  });

  const rows = products
    .filter(p => p.czyDoDomowienia)
    .map(p => ({
      id: p.id,
      name: p.name,
      img: p.img,
      dostawca: p.dostawca,
      stan: p.stan,
      minStock: p.minStock,
      ilDoDomowienia: p.ilDoDomowienia,
      wartoscBraku: p.wartoscBraku,
      wartoscDomowienia: p.wartoscDomowienia,
      zamowiono: p.zamowiono,
      alerty: alertsByProductId.get(p.id) || 0,
    }))
    // Priorytet: najpierw liczba zgłoszeń (popyt, którego nie możemy obsłużyć),
    // potem wartość braku jako tie-breaker.
    .sort((a, b) => (b.alerty - a.alerty) || (b.wartoscBraku - a.wartoscBraku));

  const totals = {
    count: rows.length,
    wartoscBraku: rows.reduce((sum, r) => sum + r.wartoscBraku, 0),
    wartoscDomowienia: rows.reduce((sum, r) => sum + r.wartoscDomowienia, 0),
    czekaNaZamowienie: rows.filter(r => !r.zamowiono).length,
    juzZamowione: rows.filter(r => r.zamowiono).length,
  };

  return { rows, totals };
}
