/* Proste, trwałe (localStorage) wartości domyślne dla inputów — np. założenia
   symulacji finansowej czy domyślny budżet dnia promocyjnego. Nie ma tu
   żadnego backendu do zapisu preferencji, więc localStorage per przeglądarka
   to najszybsze i najprostsze rozwiązanie (świadomy kompromis: ustawienie
   zapisane na jednym komputerze nie przeniesie się na drugi). */
const PREFIX = 'ferro_pref_';

export function getNumPref(key, fallback){
  const raw = localStorage.getItem(PREFIX + key);
  if(raw === null || raw === '') return fallback;
  const num = Number(raw);
  return isNaN(num) ? fallback : num;
}

export function setNumPref(key, value){
  localStorage.setItem(PREFIX + key, String(value));
}

export function getStrPref(key, fallback){
  const raw = localStorage.getItem(PREFIX + key);
  return raw === null || raw === '' ? fallback : raw;
}

export function setStrPref(key, value){
  localStorage.setItem(PREFIX + key, value);
}
