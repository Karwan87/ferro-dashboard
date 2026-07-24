import { loadData } from './data.js';
import { WORKER_BASE } from './config.js';

/* Bramka hasła — weryfikacja hasła i wydanie tokenu sesji dzieje się
   po stronie Cloudflare Workera, nie w tym kodzie klienckim (który
   trafia do publicznego repo). Frontend tylko przechowuje token. */

export async function checkPassword(){
  const input = document.getElementById('pwInput').value;
  const errBox = document.getElementById('pwError');
  try{
    const res = await fetch(`${WORKER_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: input }),
    });
    if(!res.ok) throw new Error('bad credentials');
    const { token, exp } = await res.json();
    sessionStorage.setItem('ferro_token', token);
    sessionStorage.setItem('ferro_token_exp', String(exp));
    unlockApp();
  } catch(e){
    errBox.textContent = 'Błędne hasło, spróbuj ponownie.';
    document.getElementById('pwInput').value = '';
  }
}

export function unlockApp(){
  document.getElementById('loginGate').classList.add('hidden');
  document.getElementById('app-root').classList.add('unlocked');
  loadData();
}

function hasValidToken(){
  const token = sessionStorage.getItem('ferro_token');
  const exp = Number(sessionStorage.getItem('ferro_token_exp'));
  return !!token && exp > Date.now();
}

export function initAuth(){
  document.getElementById('pwInput').addEventListener('keydown', e=>{ if(e.key==='Enter') checkPassword(); });
  if(hasValidToken()){
    unlockApp();
  }
}

export function logout(){
  sessionStorage.removeItem('ferro_token');
  sessionStorage.removeItem('ferro_token_exp');
  document.getElementById('app-root').classList.remove('unlocked');
  document.getElementById('pwInput').value = '';
  document.getElementById('pwError').textContent = '';
  document.getElementById('loginGate').classList.remove('hidden');
  document.getElementById('pwInput').focus();
}
