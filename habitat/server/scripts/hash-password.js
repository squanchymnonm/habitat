// Lee la contraseña por stdin (sin eco) y emite la línea HABITAT_PASSWORD_HASH=...
import { hashPassword } from '../password.js';
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
// Sin eco: ocultamos lo tipeado sobreescribiendo la salida del prompt.
rl._writeToOutput = (s) => { if (s.includes('\n')) rl.output.write('\n'); };
process.stdout.write('Contraseña: ');
rl.question('', (pw) => {
  rl.close();
  if (!pw) { console.error('contraseña vacía'); process.exit(1); }
  process.stdout.write(`\nHABITAT_PASSWORD_HASH=${hashPassword(pw)}\n`);
});
