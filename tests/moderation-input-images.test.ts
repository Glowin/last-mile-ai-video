import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, chmod, writeFile, readFile, rm, stat, readdir, symlink, link, mkdir, realpath, truncate } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { extractInputImages } from '../scripts/moderation-input-images';
import { providerPayload, type GenerationInput } from '../src/server/input';
import { families } from '../src/lib/models';
// Import only for protocol compatibility assertions; never call database().
import { digest } from '../src/server/moderation/service';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGPQ6AkgCTGMahjVMHw1AAASYgQQuCbgMwAAAABJRU5ErkJggg==';
// Real 1x1 JPEG; the helper's signature check intentionally matches input.ts,
// not a full media decoder or a content/semantic safety assertion.
const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdAAr/2Q==';
const prompt = 'SYNTHETIC_PRIVATE_PROMPT';
const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
function payload(family: GenerationInput['family'] = 'seedance', mode: GenerationInput['mode'] = 'image') {
  const f = families.find(f => f.slug === family)!;
  return providerPayload({ requestId: '00000000-0000-4000-8000-000000000001', family, mode,
    prompt, duration: f.defaultDuration, resolution: family === 'minimax' ? '2K' : family === 'kling' ? '4K' : '720p',
    ratio: mode === 'image' ? 'adaptive' : '16:9', audio: false, ...(mode === 'image' ? { image: png } : {}) });
}
function review(p = payload()) {
  const job_id = '00000000-0000-4000-8000-000000000001', binding_hash = 'a'.repeat(64), policy_version = '2026-10-25.1';
  const snapshot = { jobId: job_id, binding: binding_hash, payload: p, policyVersion: policy_version };
  return { job_id, phase: 'input', version: 1, policy_version, input_hash: digest(snapshot), output_hash: null,
    binding_hash, snapshot, state: 'pending', created_at: '2026-10-25T00:00:00Z', expires_at: '2026-10-26T00:00:00Z',
    decided_at: null, actor: null, reason: null };
}
async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'kakareel-input-images-test-'));
  await chmod(dir, 0o700);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = join(dir, 'review.json'), output = join(dir, 'images');
  async function save(value: unknown = review()) {
    await writeFile(source, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  }
  await save();
  return { dir, source, output, save };
}
async function absent(path: string) { await assert.rejects(stat(path), { code: 'ENOENT' }); }

test('every supported family/mode extracts exact bytes or explicitly counts zero; digest matches service', async t => {
  const f = await fixture(t);
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No network allowed'); });
  for (const family of families) for (const mode of ['text', 'image'] as const) {
    const r = review(payload(family.slug, mode)); await f.save(r);
    const out = join(f.dir, `${family.slug}-${mode}`);
    const m = await extractInputImages(f.source, out);
    assert.equal(m.complete, true); assert.equal(m.imageCount, mode === 'text' ? 0 : 1);
    assert.equal(m.review.inputHash, digest(r.snapshot));
    assert.equal(m.exportSha256, sha(await readFile(f.source)));
    assert.equal((await stat(out)).mode & 0o777, 0o700);
    assert.equal((await stat(out)).uid, process.getuid?.());
    assert.deepEqual(JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8')), m);
    for (const name of await readdir(out)) assert.equal((await stat(join(out, name))).mode & 0o777, 0o600);
    if (mode === 'image') assert.deepEqual(await readFile(join(out, m.images[0].file)), Buffer.from(png.split(',')[1], 'base64'));
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('array order, duplicates and complete count are preserved with fixed safe filenames', async t => {
  const f = await fixture(t), p = payload(); p.image_urls = [jpeg, png, png];
  await f.save(review(p)); const m = await extractInputImages(f.source, f.output);
  assert.equal(m.imageCount, 3); assert.equal(m.images.length, 3);
  assert.deepEqual(m.images.map(x => x.file), ['image-0001.jpg', 'image-0002.png', 'image-0003.png']);
  for (const [i, data] of [jpeg, png, png].entries()) {
    const bytes = Buffer.from(data.split(',')[1], 'base64'), item = m.images[i];
    assert.equal(item.index, i); assert.equal(item.source, `snapshot.payload.image_urls[${i}]`);
    assert.equal(item.sha256, sha(bytes)); assert.equal(item.bytes, bytes.length);
    assert.deepEqual(await readFile(join(f.output, item.file)), bytes);
  }
  const text = await readFile(join(f.output, 'manifest.json'), 'utf8');
  for (const privateText of [prompt, png, jpeg, 'base64', 'https://']) assert.ok(!text.includes(privateText));
  assert.match(m.scope, /not approval/);
});

test('unknown image fields at every level and nested content cannot disappear silently', async t => {
  const f = await fixture(t);
  for (const target of ['review', 'snapshot', 'payload', 'scalar']) {
    const r = review();
    if (target === 'review') Object.assign(r, { image: png });
    if (target === 'snapshot') Object.assign(r.snapshot, { images: [png] });
    if (target === 'payload') Object.assign(r.snapshot.payload, { reference_image: png });
    if (target === 'scalar') r.snapshot.payload.resolution = { image: png };
    r.input_hash = digest(r.snapshot); await f.save(r);
    await assert.rejects(extractInputImages(f.source, f.output), /Unsupported/); await absent(f.output);
  }
});

test('remote, unsupported, malformed or oversized images reject the whole batch before writing', async t => {
  const f = await fixture(t);
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No network allowed'); });
  const oversized = Buffer.alloc(3 * 1024 * 1024 + 1); Buffer.from(png.split(',')[1], 'base64').copy(oversized);
  for (const bad of [null, {}, { url: png }, ['nested'], 'https://example.invalid/private.png', '//example.invalid/a',
    'file:///private/secret', 'data:image/gif;base64,R0lGODlh', 'data:image/svg+xml;base64,PHN2Zz4=',
    png.slice(0, -1), jpeg.replace(/Q==$/, 'R=='), png.replace('iVBOR', '!!!!!'), png.replace('image/png', 'image/jpeg'),
    'data:image/png;base64,' + oversized.toString('base64')]) {
    const p = payload(); p.image_urls = [png, bad]; await f.save(review(p));
    await assert.rejects(extractInputImages(f.source, f.output)); await absent(f.output);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('missing/non-array image lists and model mismatch cannot yield a false zero-image export', async t => {
  const f = await fixture(t);
  for (const images of [undefined, null, '', {}, [], png]) {
    const p = payload(); p.image_urls = images; await f.save(review(p));
    await assert.rejects(extractInputImages(f.source, f.output)); await absent(f.output);
  }
  const p = payload('seedance', 'text'); p.image_urls = [png]; await f.save(review(p));
  await assert.rejects(extractInputImages(f.source, f.output)); await absent(f.output);
});

test('malformed JSON, duplicate (also escaped) keys and invalid UTF-8 are refused', async t => {
  const f = await fixture(t);
  for (const raw of ['{', 'null', '[]', JSON.stringify(review()).replace('"image_urls":', '"image_urls":[],"image_urls":'),
    JSON.stringify(review()).replace('"image_urls":', '"image_urls":[],"image_\\u0075rls":')]) {
    await writeFile(f.source, raw);
    await assert.rejects(extractInputImages(f.source, f.output)); await absent(f.output);
  }
  await writeFile(f.source, Buffer.from([0xff, 0xfe]));
  await assert.rejects(extractInputImages(f.source, f.output), /UTF-8/); await absent(f.output);
});

test('wrong phase, altered identity, stale hashes and path injection metadata are rejected', async t => {
  const f = await fixture(t);
  for (const change of [{ phase: 'output' }, { output_hash: 'a'.repeat(64) }, { version: 0 }, { version: 1.5 },
    { job_id: '../../escape' }, { policy_version: '<img src=x>' }, { input_hash: '0'.repeat(64) }, { binding_hash: 'b'.repeat(64) }]) {
    await f.save({ ...review(), ...change });
    await assert.rejects(extractInputImages(f.source, f.output)); await absent(f.output);
  }
  const r = review(); r.snapshot.payload.prompt = 'changed'; await f.save(r);
  await assert.rejects(extractInputImages(f.source, f.output), /hash mismatch/); await absent(f.output);
});

test('unsafe source and parent permissions fail without creating artifacts', async t => {
  const f = await fixture(t);
  for (const mode of [0o644, 0o640, 0o666]) {
    await chmod(f.source, mode); await assert.rejects(extractInputImages(f.source, f.output), /0600/); await absent(f.output);
  }
  await chmod(f.source, 0o600);
  for (const mode of [0o755, 0o750, 0o770]) {
    await chmod(f.dir, mode); await assert.rejects(extractInputImages(f.source, f.output), /0700/); await absent(f.output);
  }
  await chmod(f.dir, 0o700);
  const unsafe = join(f.dir, 'unsafe'); await mkdir(unsafe, { mode: 0o755 }); await chmod(unsafe, 0o755);
  await assert.rejects(extractInputImages(f.source, join(unsafe, 'out')), /0700/); await absent(join(unsafe, 'out'));
});

test('file and directory symlinks, hardlinks and existing destinations are not followed or overwritten', async t => {
  const f = await fixture(t), alias = join(f.dir, 'alias.json');
  await symlink(f.source, alias); await assert.rejects(extractInputImages(alias, f.output)); await absent(f.output);
  await rm(alias); await link(f.source, alias);
  await assert.rejects(extractInputImages(f.source, f.output), /without links/); await absent(f.output); await rm(alias);
  const linkedParent = join(f.dir, 'linked-parent'); await symlink(f.dir, linkedParent);
  await assert.rejects(extractInputImages(join(linkedParent, 'review.json'), f.output), /symlink/);
  await assert.rejects(extractInputImages(f.source, join(linkedParent, 'new')), /symlink/); await absent(join(f.dir, 'new'));
  await symlink(f.dir, f.output); await assert.rejects(extractInputImages(f.source, f.output));
  await rm(f.output); await mkdir(f.output, { mode: 0o700 });
  const marker = join(f.output, 'image-0001.png'); await writeFile(marker, 'do not overwrite');
  await assert.rejects(extractInputImages(f.source, f.output)); assert.equal(await readFile(marker, 'utf8'), 'do not overwrite');
  await absent(join(f.output, 'manifest.json'));
  await assert.rejects(extractInputImages(f.source, f.source)); assert.equal(JSON.parse(await readFile(f.source, 'utf8')).phase, 'input');
});

test('owner checks cover both parent and file without changing real OS ownership', async t => {
  const f = await fixture(t), uid = process.getuid!();
  const owner = t.mock.method(process as typeof process & { getuid: () => number }, 'getuid', () => uid + 1);
  await assert.rejects(extractInputImages(f.source, f.output), /operator-owned.*0700/); await absent(f.output);
  let calls = 0;
  owner.mock.mockImplementation(() => ++calls === 1 ? uid : uid + 1);
  await assert.rejects(extractInputImages(f.source, f.output), /operator-owned regular file/); await absent(f.output);
});

test('restrictive umask causing an unusable output fails without a completion manifest', async t => {
  const f = await fixture(t), previous = process.umask(0o777);
  try { await assert.rejects(extractInputImages(f.source, f.output), /New evidence directory/); }
  finally { process.umask(previous); await chmod(f.output, 0o700); }
  assert.deepEqual(await readdir(f.output), []);
});

test('relative/traversal paths and checkout destinations fail before writing', async t => {
  const f = await fixture(t), repo = await realpath(new URL('..', import.meta.url));
  for (const out of ['relative', `${f.dir}/../escape`, `${f.dir}/./escape`, `${f.dir}/back\\slash`, `${f.dir}/nul\0path`, join(repo, 'no-review-images')]) {
    await assert.rejects(extractInputImages(f.source, out));
  }
  await absent(join(repo, 'no-review-images'));
  await assert.rejects(extractInputImages(`${f.dir}/../${f.dir.split('/').at(-1)}/review.json`, f.output));
  await assert.rejects(extractInputImages(join(repo, 'package.json'), f.output), /outside the checkout/);
  await absent(f.output);
});

test('directory input and oversized exports fail safely without reading unbounded content', async t => {
  const f = await fixture(t);
  await assert.rejects(extractInputImages(f.dir, f.output));
  await truncate(f.source, 32 * 1024 * 1024 + 1);
  await assert.rejects(extractInputImages(f.source, f.output), /export size/); await absent(f.output);
});

async function cli(...args: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/moderation-input-images.ts', ...args], {
      cwd: new URL('..', import.meta.url), env: { PATH: process.env.PATH, NODE_ENV: 'test' },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
  });
}
test('standalone CLI needs no config or database; success, refusal and usage never echo private content', async t => {
  const f = await fixture(t), before = await readFile(f.source);
  const ok = await cli(f.source, f.output); assert.equal(ok.code, 0, ok.stderr); assert.match(ok.stdout, /Extracted 1 image/);
  assert.deepEqual(await readFile(f.source), before);
  const retry = await cli(f.source, f.output); assert.equal(retry.code, 1); assert.match(retry.stderr, /No complete export confirmed/);
  const p = payload(); p.image_urls = [png, 'https://example.invalid/PRIVATE_URL']; await f.save(review(p));
  const bad = await cli(f.source, join(f.dir, 'bad')); assert.equal(bad.code, 1); assert.match(bad.stderr, /Remote images/);
  const usage = await cli(); assert.equal(usage.code, 1); assert.match(usage.stderr, /Usage:/);
  const invalidPath = await cli(`${f.dir}/PRIVATE_PATH`, join(f.dir, 'missing')); assert.equal(invalidPath.code, 1);
  const output = [ok, retry, bad, usage, invalidPath].map(r => r.stdout + r.stderr).join('\n');
  for (const secret of [prompt, png, 'PRIVATE_URL', 'PRIVATE_PATH', f.dir, 'base64']) assert.ok(!output.includes(secret));
  await absent(join(f.dir, 'bad'));
});
