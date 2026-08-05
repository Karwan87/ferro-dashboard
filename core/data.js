import { parseNum, parseIntSafe, getCell } from './format.js';
import { fetchCsv, fetchCsvRaw, col, authedFetch } from './csv.js';
import { DATA_BASE } from './config.js';

/* =========================================================
   ŹRÓDŁA DANYCH NA ŻYWO — pliki CSV aktualizowane co godzinę
   przez workflow GitHub Actions (.github/workflows/update-data.yml),
   serwowane przez Cloudflare Worker (core/config.js) z prywatnego repo.
   ========================================================= */
const CSV_SALES  = DATA_BASE + 'sprzedaz.csv';
const CSV_IMAGES = DATA_BASE + 'zdjecia.csv';
const CSV_ORDERS  = DATA_BASE + 'ordery.csv';
const CSV_RETURNS = DATA_BASE + 'zwroty.csv';
const CSV_DELIVERIES = DATA_BASE + 'dostawy.csv';
const LAST_UPDATED_URL = DATA_BASE + 'last_updated.txt';

/* "Sprzedane (cała historia)" NIE bierzemy już z arkusza "zdjęcia" (kolumna
   "Sprzedane") — to pole okazało się niezależnie utrzymywane i rozjeżdżało
   się z rzeczywistym rejestrem zamówień (potwierdzone na ID 5763: pole
   pokazywało 51 szt., realnie z Ordery/Zwroty wychodziło 79 sprzedanych /
   29 zwróconych). Liczymy więc wprost z tych samych arkuszy, z których
   korzysta moduł Zwroty — Ordery: A ID produktu, F ilość; Zwroty: E ID
   produktu, H ilość. */
const ORD_HIST = { productId: col('A'), qty: col('F') };
const RET_HIST = { productId: col('E'), qty: col('H') };

/* Arkusz "dostawy" (zakładka "Logi") to ogólny dziennik ruchów magazynowych,
   nie tylko dostaw — ma nazwane nagłówki (w przeciwieństwie do Ordery/Zwroty),
   więc czytamy go jak sprzedaz.csv/zdjecia.csv (getCell), i filtrujemy tylko
   wiersze z kolumny "Opis" == "Dostawa". Inne wartości w "Opis" (sprzedaż,
   korekty, przesunięcia wewnętrzne...) świadomie pomijamy. */
const DELIVERY_OPIS_VALUE = 'Dostawa';

export let products = [];

async function fetchLastUpdated(){
  try{
    return (await authedFetch(LAST_UPDATED_URL)).trim();
  } catch(e){
    return new Date().toLocaleString('pl-PL');
  }
}

/* Po udanym wczytaniu wysyła zdarzenie 'ferro:data-loaded' na document —
   komponenty same decydują, czy i jak się odświeżyć (brak zależności cyklicznej). */
export async function loadData(){
  const flag = document.getElementById('liveFlag');
  const flagText = document.getElementById('liveFlagText');
  const errorSlot = document.getElementById('errorSlot');
  flag.className = 'live-flag loading';
  flagText.textContent = 'Odświeżanie…';
  errorSlot.innerHTML = '';

  try{
    const [salesRows, imgRows, orderRows, returnRows, deliveryRows, lastUpdatedText] = await Promise.all([
      fetchCsv(CSV_SALES), fetchCsv(CSV_IMAGES), fetchCsvRaw(CSV_ORDERS), fetchCsvRaw(CSV_RETURNS), fetchCsv(CSV_DELIVERIES), fetchLastUpdated(),
    ]);

    const dbMap = {};
    imgRows.forEach(r=>{
      const id = parseIntSafe(getCell(r,'Id','ID','id'));
      if(!id) return;
      dbMap[id] = {
        img: getCell(r,'Zdjęcie','Zdjecie') || null,
        odslony: parseIntSafe(getCell(r,'Odsłony','Odslony')),
      };
    });

    const soldHistById = {};
    orderRows.forEach(row=>{
      const id = parseIntSafe(row[ORD_HIST.productId]);
      if(!id) return;
      soldHistById[id] = (soldHistById[id] || 0) + parseIntSafe(row[ORD_HIST.qty]);
    });
    const returnedHistById = {};
    returnRows.forEach(row=>{
      const id = parseIntSafe(row[RET_HIST.productId]);
      if(!id) return;
      returnedHistById[id] = (returnedHistById[id] || 0) + parseIntSafe(row[RET_HIST.qty]);
    });

    const deliveredHistById = {};
    deliveryRows.forEach(r=>{
      if(getCell(r,'Opis').trim() !== DELIVERY_OPIS_VALUE) return;
      const id = parseIntSafe(getCell(r,'Produkt'));
      if(!id) return;
      deliveredHistById[id] = (deliveredHistById[id] || 0) + parseIntSafe(getCell(r,'Ilość'));
    });

    products = salesRows
      .map(r=>{
        const id = parseIntSafe(getCell(r,'ID','Id'));
        if(!id) return null;
        return {
          id,
          kod: getCell(r,'Kod towaru') || null,
          name: getCell(r,'Nazwa produktu') || ('Produkt #'+id),
          cena: parseNum(getCell(r,'Cena sprzedaży netto')),
          cenaZakupu: parseNum(getCell(r,'Cena zakupu netto')),
          narzut: parseNum(getCell(r,'Narzut')),
          stan: parseIntSafe(getCell(r,'Aktualny stan')),
          s7: parseIntSafe(getCell(r,'SALE 1-7 days')),
          s14: parseIntSafe(getCell(r,'SALE 8-14 days')),
          s21: parseIntSafe(getCell(r,'SALE 15-21 days')),
          s28: parseIntSafe(getCell(r,'SALE 22-28 days')),
          s30: parseIntSafe(getCell(r,'Sprzedaż 30days')),
          ret30: parseIntSafe(getCell(r,'Returns 30days')),
          minStock: parseIntSafe(getCell(r,'Min stock')),
          czyDoDomowienia: /^tak$/i.test(getCell(r,'Czy do domówienia?').trim()),
          zamowiono: /^(tak|true)$/i.test(getCell(r,'Zamówiono?').trim()),
          wartoscDomowienia: parseNum(getCell(r,'Wartość Domówienia (netto)')),
          wartoscBraku: parseNum(getCell(r,'Wartość Braku (netto)')),
          ilDoDomowienia: parseIntSafe(getCell(r,'Il. do domówienia')),
          // "Trend sprzedaży": kombinacja ikon w JEDNEJ komórce, ustalona z
          // użytkownikiem — 🚨=0 na stanie (bez strzałki kierunku), ⚠️=>50%
          // zwrotów, ✨=nowość/inkubacja, ↗️/➡️/↘️=kierunek trendu sprzedaży
          // (rosnący/stagnacja/spadkowy). Produkty bez stanu nie mają strzałki.
          trendDirection: (() => {
            const raw = getCell(r,'Trend sprzedaży');
            if(raw.includes('↗️')) return 'up';
            if(raw.includes('↘️')) return 'down';
            if(raw.includes('➡️')) return 'flat';
            return null;
          })(),
          trendHighReturns: getCell(r,'Trend sprzedaży').includes('⚠️'),
          trendNew: getCell(r,'Trend sprzedaży').includes('✨'),
          dostawca: getCell(r,'Dostawca') || null,
          img: dbMap[id]?.img || null,
          odslony: dbMap[id]?.odslony || 0,
          sprzedaneHist: soldHistById[id] || 0,
          zwroconoHist: returnedHistById[id] || 0,
          dostarczonoHist: deliveredHistById[id] || 0,
        };
      })
      .filter(Boolean);

    flag.className = 'live-flag';
    flagText.textContent = 'Dane na żywo';
    document.getElementById('lastUpdated').textContent =
      'Dane aktualne na: ' + lastUpdatedText;

    document.dispatchEvent(new CustomEvent('ferro:data-loaded'));
  } catch(err){
    flag.className = 'live-flag err';
    flagText.textContent = 'Błąd pobierania';
    errorSlot.innerHTML = `<div class="error-box">
      Nie udało się pobrać danych z Google Sheets (${err.message}).
      Sprawdź, czy zakładki (Panel, Zdjęcia, Ordery, Zwroty, Logi) są nadal opublikowane (Plik → Udostępnij → Opublikuj w internecie) i czy łącza CSV się nie zmieniły.
      <br><button class="refresh-btn" onclick="loadData()">↻ Spróbuj ponownie</button>
    </div>`;
  }
}
