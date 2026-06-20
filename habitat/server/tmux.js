import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const defaultExec = async (file, args) => (await run(file, args)).stdout;

export async function capturePane(name, lines, exec = defaultExec) {
  try {
    const out = await exec('tmux', ['capture-pane', '-p', '-t', name]);
    const arr = String(out).replace(/\n+$/, '').split('\n');
    return arr.slice(-lines).join('\n');
  } catch {
    return '';
  }
}

export async function listSessions(exec = defaultExec) {
  try {
    const out = await exec('tmux', ['ls', '-F', '#{session_name}']);
    return String(out).split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
