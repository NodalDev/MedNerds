import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { hashPassword, randomSecret } from '../netlify/lib/preview-access/passwords.ts';
import { matchingCredentials, MAX_CREDENTIALS, parseRegistry, validId } from '../netlify/lib/preview-access/config.ts';

/** Read secrets without echoing input, accepting them as arguments or writing files. */
function hiddenInput(prompt) {
  return new Promise((resolve, reject) => {
    process.stdout.write(prompt);
    let input = '';
    const raw = process.stdin.isRaw;
    const finish = (error) => {
      process.stdin.off('data', read);
      process.stdin.setRawMode(raw);
      process.stdin.pause();
      process.stdout.write('\n');
      error ? reject(error) : resolve(input);
    };
    const read = (chunk) => {
      for (const char of chunk) {
        if (char === '\u0003') return finish(new Error('Abgebrochen.'));
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u007f' || char === '\b') input = [...input].slice(0, -1).join('');
        else if (char >= ' ') input += char;
        if (input.length > 8192) return finish(new Error('Eingabe zu lang.'));
      }
    };
    process.stdin.setEncoding('utf8');
    process.stdin.setRawMode(true);
    process.stdin.on('data', read);
    process.stdin.resume();
  });
}

export async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Preview Access (nur im interaktiven lokalen Terminal):\n' +
      '  node --experimental-strip-types scripts/preview-access.mjs session-secret\n' +
      '  node --experimental-strip-types scripts/preview-access.mjs generate --id reviewer-01\n' +
      '  node --experimental-strip-types scripts/preview-access.mjs hash --id reviewer-01\n' +
      'Für bestehende Konfiguration wird vor Änderungen nach dem bisherigen JSON gefragt (leere Eingabe: neuer Zugang).\n' +
      'Bestehende ID: Passwort ersetzen und Revision automatisch erhöhen. Keine Passwörter als Argumente übergeben.');
    return;
  }
  if (process.env.CI || !process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Nur lokal im interaktiven Terminal ausführen; keine Ausgabe von Secrets in CI oder Pipes.');
  if (args.length === 1 && args[0] === 'session-secret') {
    console.log('Nur als MEDNERDS_ACCESS_SESSION_SECRET sicher in Netlify hinterlegen, nicht im Repository speichern:\n' + randomSecret());
    return;
  }
  const [command, option, id] = args;
  if (args.length !== 3 || !['generate', 'hash'].includes(command) || option !== '--id' || !validId(id)) throw new Error('Ungültiger Aufruf. Hilfe: --help');
  const raw = await hiddenInput('Bisheriges MEDNERDS_ACCESS_CREDENTIALS-JSON einfügen (leer für Erstkonfiguration): ');
  const registry = raw ? parseRegistry(raw) : { version: 1, credentials: [] };
  const existing = registry.credentials.find(entry => entry.id === id);
  if (!existing && registry.credentials.length >= MAX_CREDENTIALS) throw new Error(`Maximal ${MAX_CREDENTIALS} Zugänge.`);
  const password = command === 'generate' ? randomSecret() : await hiddenInput('Zugangspasswort (mindestens 16 UTF-8-Bytes, Eingabe bleibt unsichtbar): ');
  if (command === 'hash' && password !== await hiddenInput('Zugangspasswort wiederholen: ')) throw new Error('Eingaben stimmen nicht überein.');
  const matches = await matchingCredentials(password, registry);
  if (matches.length) throw new Error('Dieses Passwort wird bereits verwendet. Bitte einen anderen Code wählen.');
  const entry = { id, enabled: existing?.enabled ?? true, passwordHash: await hashPassword(password), revision: (existing?.revision ?? 0) + 1 };
  registry.credentials = [...registry.credentials.filter(item => item.id !== id), entry];
  parseRegistry(JSON.stringify(registry));
  if (command === 'generate') console.log('\nNeues Zugangspasswort – ausschliesslich zur sicheren Weitergabe an die betreffende Person:\n' + password);
  console.log('\nAls MEDNERDS_ACCESS_CREDENTIALS in Netlify hinterlegen (kein Klartextpasswort enthalten):\n' + JSON.stringify(registry));
  console.log('Es wurden keine Dateien oder Netlify-Einstellungen geändert. Änderungen werden erst nach Redeploy wirksam.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
