/** Offline only; no operator config, database, network, or approval capability.
 * node --import tsx scripts/moderation-input-images.ts /ABS/PRIVATE/review.json /ABS/PRIVATE/new-directory
 * Open each numbered image locally. manifest.json binds the complete byte extraction
 * to the original export; it is NOT evidence of viewing, decodability or policy approval.
 */
import { constants } from 'node:fs';
import { lstat, realpath, open, mkdir } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validImage } from '../src/server/input';
import { families } from '../src/lib/models';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Bound reading/decoding even for hand-edited or corrupt exports. Never truncate.
const maxExportBytes = 32 * 1024 * 1024;
class ExtractionError extends Error {}
function requireThat(ok: unknown, message: string): asserts ok {
  if (!ok) throw new ExtractionError(message);
}
function record(value: unknown): Record<string, unknown> {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), 'Invalid review structure.');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  requireThat(Object.keys(value).every(k => allowed.includes(k)), 'Unsupported review fields; no complete image export.');
}
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
// Same canonical input-snapshot digest protocol as moderation/service.ts. Kept
// local deliberately: importing the service would load its database dependencies.
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
}
function parseExport(text: string): unknown {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new ExtractionError('Malformed review JSON.'); }
  // JSON.parse otherwise silently discards duplicate members (including image
  // fields). Tokenize strings atomically, including escaped quotes and keys.
  const stack: (Set<string> | null)[] = [];
  for (const token of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]]/g)) {
    const s = token[0];
    if (s === '{') stack.push(new Set());
    else if (s === '[') stack.push(null);
    else if (s === '}' || s === ']') stack.pop();
    else if (/^\s*:/.test(text.slice(token.index! + s.length))) {
      const seen = stack.at(-1), key = JSON.parse(s) as string;
      requireThat(seen && !seen.has(key), 'Duplicate JSON fields; no complete image export.');
      seen.add(key);
    }
  }
  return value;
}
function prepare(value: unknown, exportSha256: string) {
  const r = record(value);
  keys(r, ['job_id', 'phase', 'version', 'policy_version', 'input_hash', 'output_hash', 'binding_hash',
    'snapshot', 'state', 'created_at', 'expires_at', 'decided_at', 'actor', 'reason']);
  requireThat(r.phase === 'input' && r.output_hash === null, 'Only input review exports are supported.');
  requireThat(typeof r.job_id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(r.job_id)
    && Number.isSafeInteger(r.version) && Number(r.version) > 0
    && typeof r.policy_version === 'string' && /^\d{4}-\d{2}-\d{2}\.\d+$/.test(r.policy_version)
    && typeof r.input_hash === 'string' && /^[0-9a-f]{64}$/.test(r.input_hash)
    && typeof r.binding_hash === 'string' && /^[0-9a-f]{64}$/.test(r.binding_hash), 'Invalid review identity.');
  requireThat(['pending', 'approved', 'rejected', 'expired'].includes(String(r.state)), 'Invalid review state.');
  for (const k of ['created_at', 'expires_at', 'decided_at', 'actor', 'reason']) {
    requireThat(r[k] === undefined || r[k] === null || typeof r[k] === 'string', 'Invalid review metadata.');
  }
  const snapshot = record(r.snapshot);
  keys(snapshot, ['jobId', 'binding', 'payload', 'policyVersion']);
  requireThat(snapshot.jobId === r.job_id && snapshot.binding === r.binding_hash
    && snapshot.policyVersion === r.policy_version, 'Review identity does not match its snapshot.');
  const payload = record(snapshot.payload);
  const family = families.find(f => f.t2v === payload.model || f.i2v === payload.model);
  requireThat(family, 'Unsupported payload model; no complete image export.');
  const imageMode = payload.model === family.i2v;
  const extra = family.slug === 'seedance' ? ['ratio', 'resolution', 'generate_audio', 'output_format']
    : family.slug === 'kling' ? ['sound', ...(imageMode ? [] : ['aspect_ratio'])] : ['resolution', 'aspect_ratio'];
  keys(payload, ['model', 'prompt', 'duration', 'image_urls', ...extra]);
  requireThat(typeof payload.prompt === 'string' && payload.prompt.length > 0 && payload.prompt.length <= family.maxPrompt
    && (family.slug === 'minimax' ? typeof payload.duration === 'string' && /^(6|10)$/.test(payload.duration)
      : typeof payload.duration === 'number' && (family.durations as readonly number[]).includes(payload.duration)),
  'Unsupported payload values; no complete image export.');
  // All other supported fields are scalar; nested images can never be ignored.
  for (const k of extra) {
    requireThat(typeof payload[k] === (k === 'sound' || k === 'generate_audio' ? 'boolean' : 'string'),
      'Unsupported payload values; no complete image export.');
  }
  const images = Object.hasOwn(payload, 'image_urls') ? payload.image_urls : [];
  requireThat(Array.isArray(images) && (imageMode ? images.length > 0 : images.length === 0),
    'Missing or inconsistent image list; no complete image export.');
  const decoded = Array.from(images, (data: unknown, index: number) => {
    requireThat(typeof data === 'string', 'Unsupported image entry; no complete image export.');
    requireThat(!/^(?:https?:)?\/\//i.test(data), 'Remote images are unsupported; no URLs fetched and no complete image export.');
    requireThat(data.length <= 4_300_000 && validImage(data), 'Unsupported or malformed image; only uploaded PNG/JPEG data is supported.');
    const encoded = data.slice(data.indexOf(',') + 1);
    const bytes = Buffer.from(encoded, 'base64');
    requireThat(bytes.toString('base64') === encoded, 'Noncanonical image encoding; no complete image export.');
    const png = data.startsWith('data:image/png;');
    return { bytes, item: { index, source: `snapshot.payload.image_urls[${index}]`,
      file: `image-${String(index + 1).padStart(4, '0')}.${png ? 'png' : 'jpg'}`,
      mime: png ? 'image/png' : 'image/jpeg', bytes: bytes.length, sha256: sha256(bytes) } };
  });
  requireThat(sha256(canonical(snapshot)) === r.input_hash, 'Review snapshot hash mismatch.');
  return { decoded, manifest: {
    format: 'kakareel-input-images-v1', complete: true, imageCount: decoded.length,
    exportSha256, review: { jobId: r.job_id, phase: 'input', version: r.version,
      policyVersion: r.policy_version, inputHash: r.input_hash, bindingHash: r.binding_hash },
    scope: 'Complete byte extraction only. Open every image; an unreadable image is not reviewed. Inspect prompt and settings in the private original export. This manifest is not approval or proof of viewing, authenticity, freshness or policy compliance.',
    images: decoded.map(x => x.item),
  } };
}

async function privateLocation(path: string) {
  requireThat(isAbsolute(path) && !path.includes('\0') && !path.includes('\\')
    && !path.split('/').some(p => p === '.' || p === '..') && !path.endsWith('/'), 'Absolute private path without traversal required.');
  const parent = dirname(path), actualParent = await realpath(parent);
  // Refuse symlink aliases in parents too; use the canonical absolute path.
  requireThat(actualParent === parent, 'Use a canonical private parent path without symlinks.');
  const actual = join(actualParent, path.split('/').at(-1)!);
  const rel = relative(await realpath(repo), actual);
  requireThat(rel === '..' || rel.startsWith('../'), 'Evidence must be outside the checkout.');
  const st = await lstat(actualParent);
  requireThat(st.isDirectory() && st.uid === process.getuid?.() && (st.mode & 0o777) === 0o700,
    'Private parent must be operator-owned and mode 0700.');
  return actual;
}
async function readExport(path: string) {
  const actual = await privateLocation(path);
  // O_NOFOLLOW + descriptor checks prevent swapping a symlink into the final
  // component. O_NONBLOCK prevents a malicious FIFO from hanging the operator.
  const f = await open(actual, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const st = await f.stat();
    requireThat(st.isFile() && st.uid === process.getuid?.() && (st.mode & 0o777) === 0o600 && st.nlink === 1,
      'Review must be an operator-owned regular file, mode 0600, without links.');
    requireThat(st.size > 0 && st.size <= maxExportBytes, 'Review exceeds the supported export size or is empty.');
    // Read at most limit+1, including if a file grows after stat.
    const bytes = Buffer.alloc(st.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await f.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await f.stat();
    requireThat(length === st.size && after.size === st.size && after.mtimeMs === st.mtimeMs && after.ctimeMs === st.ctimeMs,
      'Review changed while being read.');
    return bytes.subarray(0, length);
  } finally { await f.close(); }
}
async function writePrivate(path: string, data: string | Buffer) {
  const f = await open(path, 'wx', 0o600);
  try { await f.chmod(0o600); await f.writeFile(data); } finally { await f.close(); }
}
export async function extractInputImages(reviewPath: string, destination: string) {
  const bytes = await readExport(reviewPath);
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new ExtractionError('Review is not valid UTF-8.'); }
  const { decoded, manifest } = prepare(parseExport(text), sha256(bytes));
  const output = await privateLocation(destination);
  // mkdir is exclusive (no recursive reuse). No caller-controlled image names.
  await mkdir(output, { mode: 0o700 });
  const st = await lstat(output);
  requireThat(st.isDirectory() && !st.isSymbolicLink() && st.uid === process.getuid?.() && (st.mode & 0o777) === 0o700,
    'New evidence directory must be operator-owned and mode 0700.');
  for (const image of decoded) await writePrivate(join(output, image.item.file), image.bytes);
  // Completion marker LAST. On IO failure, the private directory may contain
  // partial files; never call it complete without successful manifest creation.
  await writePrivate(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    requireThat(args.length === 2, 'Usage: node --import tsx scripts/moderation-input-images.ts /ABS/PRIVATE/review.json /ABS/PRIVATE/new-directory');
    const result = await extractInputImages(args[0], args[1]);
    console.log(`Extracted ${result.imageCount} image(s) in source order; private manifest.json written. Human review of every image, prompt and settings is still required.`);
  } catch (error) {
    // Never echo paths, JSON parse excerpts, prompt, base64, URL or native errors.
    console.error(error instanceof ExtractionError ? error.message : 'Private image extraction failed. Check ownership, permissions and canonical paths; destination must not exist.');
    console.error('No complete export confirmed. Any partial destination must not be used for approval; retry with a fresh private directory.');
    process.exitCode = 1;
  }
}
