import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePorcelain, workingStatus, parseNameStatus, branchOverview, commits } from './git-read.js';

test('parsePorcelain separa staged/unstaged/untracked/conflicted', () => {
  // formato porcelain v1 -z: "XY path\0", rename agrega token de origen
  const z = 'M  a.js\0 M b.js\0MM c.js\0?? new.txt\0UU conf.js\0R  renamed.js\0old.js\0';
  const r = parsePorcelain(z);
  assert.deepEqual(r.staged.map((e) => e.rel).sort(), ['a.js', 'c.js', 'renamed.js'].sort());
  assert.deepEqual(r.unstaged.map((e) => e.rel).sort(), ['b.js', 'c.js'].sort());
  assert.deepEqual(r.untracked.map((e) => e.rel), ['new.txt']);
  assert.deepEqual(r.conflicted.map((e) => e.rel), ['conf.js']);
  const rn = r.staged.find((e) => e.rel === 'renamed.js');
  assert.equal(rn.old, 'old.js');
});

test('workingStatus llama a git status --porcelain=v1 -z', async () => {
  let got;
  const exec = async (file, args) => { got = [file, ...args]; return '?? x\0'; };
  const r = await workingStatus('/proj', exec);
  assert.deepEqual(got, ['git', '-C', '/proj', 'status', '--porcelain=v1', '-z']);
  assert.deepEqual(r.untracked.map((e) => e.rel), ['x']);
});

test('parseNameStatus parsea M/A/D y renames', () => {
  const out = 'M\tsrc/a.js\nA\tnew.js\nR100\told.js\tnew.js\n';
  const r = parseNameStatus(out);
  assert.deepEqual(r[0], { status: 'M', rel: 'src/a.js' });
  assert.deepEqual(r[1], { status: 'A', rel: 'new.js' });
  assert.deepEqual(r[2], { status: 'R', old: 'old.js', rel: 'new.js' });
});

test('branchOverview arma ahead/behind y files vs default (tres puntos)', async () => {
  const exec = async (file, args) => {
    const a = args.join(' ');
    if (a.includes('rev-parse --abbrev-ref HEAD')) return 'feature/x\n';
    if (a.includes('symbolic-ref')) return 'origin/main\n';
    if (a.includes('rev-list --left-right --count')) {
      assert.ok(a.includes('origin/main...HEAD'));
      return '2\t5\n'; // behind=2 ahead=5
    }
    if (a.includes('diff --name-status')) {
      assert.ok(a.includes('origin/main...HEAD'));
      return 'M\tsrc/a.js\n';
    }
    return '';
  };
  const r = await branchOverview('/proj', exec);
  assert.equal(r.branch, 'feature/x');
  assert.equal(r.default, 'origin/main');
  assert.equal(r.behind, 2);
  assert.equal(r.ahead, 5);
  assert.deepEqual(r.files, [{ status: 'M', rel: 'src/a.js' }]);
});

test('commits marca pushed según rev-list --not origin/<branch>', async () => {
  const exec = async (file, args) => {
    const a = args.join(' ');
    if (a.includes('rev-parse --abbrev-ref HEAD')) return 'feature/x\n';
    if (a.includes('symbolic-ref')) return 'origin/main\n';
    if (a.includes('log --format')) return 'sha2\x1fs2\x1fsubject 2\nsha1\x1fs1\x1fsubject 1\n';
    if (a.includes('rev-list') && a.includes('--not')) {
      assert.ok(a.includes('origin/main..HEAD'));
      assert.ok(a.includes('--not origin/feature/x'));
      return 'sha2\n'; // sha2 no está en origin/feature/x -> unpushed
    }
    if (a.includes('show --name-status')) {
      return args.includes('sha2') ? 'A\tnew.js\n' : 'M\told.js\n';
    }
    return '';
  };
  const r = await commits('/proj', exec);
  assert.equal(r.length, 2);
  assert.equal(r[0].sha, 'sha2');
  assert.equal(r[0].pushed, false);
  assert.deepEqual(r[0].files, [{ status: 'A', rel: 'new.js' }]);
  assert.equal(r[1].sha, 'sha1');
  assert.equal(r[1].pushed, true);
});

test('commits: sin origin/<branch> todo queda unpushed', async () => {
  const exec = async (file, args) => {
    const a = args.join(' ');
    if (a.includes('rev-parse --abbrev-ref HEAD')) return 'feature/x\n';
    if (a.includes('symbolic-ref')) return 'origin/main\n';
    if (a.includes('log --format')) return 'sha1\x1fs1\x1fsolo\n';
    if (a.includes('rev-list') && a.includes('--not')) throw new Error('unknown revision origin/feature/x');
    if (a.includes('show --name-status')) return 'M\ta.js\n';
    return '';
  };
  const r = await commits('/proj', exec);
  assert.equal(r[0].pushed, false);
});
