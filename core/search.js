/* Dopasowanie wiersza produktu do wpisanej frazy — współdzielone przez każdą
   tabelę z listą produktów (sprzedaż, zwroty, alerty, do zamówienia, stany,
   dostawcy). Sama liczba (np. "331") = ŚCISŁE dopasowanie ID, nie "zawiera" —
   inaczej "1" łapałoby też 10, 100, 1024 itd., co przy obecnej 4-cyfrowej
   numeracji obok starszych 1-3-cyfrowych ID byłoby bezużyteczne. Cokolwiek
   innego niż sama liczba = dopasowanie fragmentu nazwy (bez rozróżniania
   wielkości liter), żeby dało się szukać np. "sukienka". */
export function matchesProductQuery(query, id, name){
  const q = (query || '').trim();
  if(!q) return true;
  if(/^\d+$/.test(q)) return id === parseInt(q, 10);
  return (name || '').toLowerCase().includes(q.toLowerCase());
}
