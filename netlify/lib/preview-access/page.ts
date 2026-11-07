export const LOGIN_PATH = '/_preview-access/login';
export const LOGOUT_PATH = '/_preview-access/logout';
export const LOGO_PATHS = ['/preview-access/logo-light.svg', '/preview-access/logo-dark.svg'];

const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const loginScript = `
const form=document.querySelector('form');
const password=document.querySelector('#password');
const toggle=document.querySelector('#show-password');
toggle.hidden=false;
toggle.addEventListener('click',()=>{
  const show=password.type==='password'; password.type=show?'text':'password';
  toggle.setAttribute('aria-pressed',String(show)); toggle.textContent=show?'Verbergen':'Anzeigen';
});
form.addEventListener('submit',async(event)=>{
  event.preventDefault();
  const button=document.querySelector('[type=submit]');
  if(button.disabled)return;
  const error=document.querySelector('#error');
  button.disabled=true; form.setAttribute('aria-busy','true'); error.textContent='';
  password.removeAttribute('aria-invalid');
  try {
    const response=await fetch(form.action,{method:'POST',body:new URLSearchParams(new FormData(form)),
      credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store',headers:{Accept:'application/json'}});
    password.value='';
    if(response.ok){
      if(location.pathname.startsWith('/_preview-access/'))location.replace(form.elements.namedItem('returnTo').value);
      else location.reload();
      return;
    }
    error.textContent=response.status===429?'Zu viele Versuche. Bitte warte kurz und versuche es erneut.':
      response.status===401?'Dieses Zugangspasswort ist nicht gültig.':
      'Der Zugang ist momentan nicht verfügbar. Bitte versuche es später erneut.';
    password.setAttribute('aria-invalid','true'); password.focus();
  } catch { error.textContent='Die Verbindung ist fehlgeschlagen. Bitte versuche es erneut.'; }
  finally {button.disabled=false;form.removeAttribute('aria-busy');}
});`;

/** Standalone page: no Starlight bundle, tracking, fonts, or protected CSS dependencies. */
export function accessPage(nonce: string, options: { returnTo?: string; error?: string; logout?: boolean } = {}): string {
  const { logout = false, error = '', returnTo = '/' } = options;
  return `<!doctype html><html lang="de-CH"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${logout ? 'Vorschauzugang beenden' : 'Willkommen bei MedNerds'}</title>
<style nonce="${nonce}">
/* Values from src/styles/mednerds-colors.css; isolated from the protected site CSS. */
:root{color-scheme:light dark;--bg:oklch(.965 .003 286.81);--surface:white;--text:oklch(.232 .012 277.99);--muted:oklch(.414 .021 270.89);--accent:oklch(.493 .14 254.69);--line:oklch(.845 .012 269.58)}
@media(prefers-color-scheme:dark){:root{--bg:oklch(.177 .009 264.32);--surface:oklch(.232 .012 277.99);--text:oklch(.965 .003 286.81);--muted:oklch(.767 .018 271.21);--accent:oklch(.752 .117 262.4);--line:oklch(.414 .021 270.89)}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:1rem/1.6 system-ui,sans-serif;min-height:100svh;display:grid;place-items:center;padding:clamp(1rem,4vw,3rem)}
main{width:100%;max-width:34rem;background:var(--surface);padding:clamp(1.25rem,5vw,2.5rem);border:1px solid var(--line);border-radius:1rem;overflow-wrap:anywhere}
img{width:min(100%,15rem);height:auto;display:block;margin-bottom:2rem}h1{font-size:clamp(1.55rem,5vw,2rem);line-height:1.25;letter-spacing:-.025em;margin:0 0 1rem}h2{font-size:1rem;margin:1.5rem 0 .35rem}p{margin:.4rem 0 1rem}form{margin-top:1.5rem}label{display:block;font-weight:600;margin-bottom:.5rem}
.field{display:flex;flex-wrap:wrap;gap:.5rem}input{min-width:0;flex:1 1 12rem;width:100%;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:.5rem;padding:.8rem;font:inherit}button{font:inherit;cursor:pointer;min-height:2.75rem;padding:.65rem 1rem;border-radius:.5rem;border:1px solid var(--line);background:var(--surface);color:var(--text)}
button[type=submit]{display:block;width:100%;margin-top:.75rem;background:var(--accent);color:var(--surface);border-color:var(--accent);font-weight:650}button:disabled{opacity:.65;cursor:wait}input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.hint{color:var(--muted);font-size:.875rem;margin:1rem 0 0}#error{min-height:1.6em;margin:.6rem 0 0;font-weight:600}a{color:var(--accent)}[hidden]{display:none}
</style></head><body><main>
<picture><source media="(prefers-color-scheme:dark)" srcset="${LOGO_PATHS[1]}"><img src="${LOGO_PATHS[0]}" width="661" height="144" alt="MedNerds"></picture>
${logout ? `<h1>Vorschauzugang beenden</h1><p>Hier meldest du dich vom geschützten Vorschauzugang ab. Dein MedNerds-Benutzerkonto bleibt davon unabhängig.</p>
<form action="${LOGOUT_PATH}" method="post"><button type="submit">Vorschauzugang abmelden</button></form><p><a href="/">Zur Website</a></p>` : `
<h1>Willkommen bei MedNerds</h1><p>MedNerds ist eine unabhängige medizinische Wissensplattform mit strukturierten Fachartikeln, wissenschaftlichen Quellen und interaktiven Lerninhalten.</p>
<h2>Warum ist der Zugang geschützt?</h2><p>MedNerds befindet sich derzeit in der Entwicklungs- und Prüfphase. Der Zugang ist deshalb vorübergehend auf ausgewählte Personen beschränkt.</p>
<form action="${LOGIN_PATH}" method="post"><input type="hidden" name="returnTo" value="${escape(returnTo)}">
<label for="password">Zugangspasswort</label><div class="field"><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256" aria-describedby="error hint" ${error ? 'aria-invalid="true"' : ''}>
<button id="show-password" type="button" aria-controls="password" aria-pressed="false" hidden>Anzeigen</button></div>
<p id="error" role="alert" aria-live="polite">${escape(error)}</p><button type="submit">MedNerds öffnen</button>
<p class="hint" id="hint">Keine Registrierung erforderlich. Der Vorschauzugang gilt für 24 Stunden.</p></form>
<script nonce="${nonce}">${loginScript}</script>`}
</main></body></html>`;
}
