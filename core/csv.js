import { logout } from './auth.js';

/* Wszystkie żądania do danych (poza logowaniem) idą przez Cloudflare Worker
   i wymagają tokenu sesji wydanego przy logowaniu (patrz core/auth.js). */
export async function authedFetch(url){
  const token = sessionStorage.getItem('ferro_token');
  const res = await fetch(url, {cache:'no-store', headers: token ? {Authorization: `Bearer ${token}`} : {}});
  if(res.status === 401){
    logout();
    throw new Error('Sesja wygasła, zaloguj się ponownie');
  }
  if(!res.ok) throw new Error('HTTP '+res.status);
  return res.text();
}

/* Wspólny helper do pobierania i parsowania plików CSV (PapaParse) —
   używany przez core/data.js (produkty) i core/customersData.js (klienci). */
export async function fetchCsv(url, options = {}){
  const text = await authedFetch(url);
  const parsed = Papa.parse(text, {header:true, skipEmptyLines:true, ...options});
  return parsed.data;
}

/* Warianty arkuszy bez nagłówków nazwanych (kolumny adresowane literą,
   np. "kolumna C") — zwraca surowe wiersze jako tablice, z pominięciem
   pierwszego wiersza (nagłówek arkusza). */
export async function fetchCsvRaw(url){
  const text = await authedFetch(url);
  const parsed = Papa.parse(text, {header:false, skipEmptyLines:true});
  return parsed.data.slice(1);
}

/* Jak fetchCsvRaw, ale BEZ pomijania pierwszego wiersza — potrzebne tam, gdzie
   sam nagłówek niesie dane (np. arkusz marketingu: wiersz 1 = nazwy miesięcy,
   trzeba go odczytać programowo, a nie tylko jako etykiety kolumn). */
export async function fetchCsvRawAll(url){
  const text = await authedFetch(url);
  const parsed = Papa.parse(text, {header:false, skipEmptyLines:true});
  return parsed.data;
}

/* A=0, B=1, C=2 ... zamienia literę kolumny arkusza na indeks tablicy wiersza. */
export function col(letter){
  return letter.toUpperCase().charCodeAt(0) - 65;
}
