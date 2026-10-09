// xdg-open dla runtime apki: przekazuje ścieżkę do apki (Opener.kt) przez abstrakcyjne gniazdo Unix,
// a apka otwiera plik w aplikacji z telefonu (ACTION_VIEW + wybór aplikacji). Apka wpuszcza tylko procesy z własnym UID.
// Użycie: xdg-open <plik|folder>
import { connect } from 'node:net';
import { resolve } from 'node:path';

const arg = process.argv[2];
if (!arg) { console.error('użycie: xdg-open <plik|folder>'); process.exit(2); }
const sock = connect({ path: '\0com.dsh.mobile.open' });
let reply = '';
sock.on('connect', () => sock.end(resolve(arg) + '\n'));
sock.on('data', (d) => { reply += d; });
sock.on('error', (e) => { console.error(`xdg-open: brak połączenia z apką DSH Mobile (${e.code})`); process.exit(1); });
sock.on('close', () => {
  reply = reply.trim();
  if (reply === 'ok') process.exit(0);
  console.error(`xdg-open: ${reply || 'brak odpowiedzi apki'}`); process.exit(1);
});
