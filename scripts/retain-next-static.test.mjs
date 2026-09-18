import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  StaticAssetCollisionError,
  retainStaticAssets,
} from './retain-next-static.mjs';

const temporaryDirectories = [];

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'trioz-static-retention-'));
  temporaryDirectories.push(root);
  const source = path.join(root, 'source');
  const destination = path.join(root, 'retained');
  await mkdir(source, { recursive: true });
  await mkdir(destination, { recursive: true });
  return { root, source, destination };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('retain-next-static', () => {
  it('copies atomically and keeps resources from an older build', async () => {
    const { source, destination } = await fixture();
    await mkdir(path.join(source, 'build-new'), { recursive: true });
    await mkdir(path.join(destination, 'build-old'), { recursive: true });
    await writeFile(path.join(source, 'build-new', 'chunk.js'), 'new chunk');
    await writeFile(path.join(destination, 'build-old', 'chunk.js'), 'old chunk');

    const result = await retainStaticAssets({ source, destination, logger: { warn() {} } });

    assert.deepEqual(result, { copied: 1, skipped: 0, collisions: [] });
    assert.equal(await readFile(path.join(destination, 'build-new', 'chunk.js'), 'utf8'), 'new chunk');
    assert.equal(await readFile(path.join(destination, 'build-old', 'chunk.js'), 'utf8'), 'old chunk');
    const temporaryFiles = (await readdir(path.join(destination, 'build-new'))).filter((name) => name.includes('.tmp-'));
    assert.deepEqual(temporaryFiles, []);
  });

  it('is idempotent and skips equal content on the second run', async () => {
    const { source, destination } = await fixture();
    await mkdir(path.join(source, 'build'), { recursive: true });
    await writeFile(path.join(source, 'build', 'runtime.js'), 'same content');

    const first = await retainStaticAssets({ source, destination, logger: { warn() {} } });
    const second = await retainStaticAssets({ source, destination, logger: { warn() {} } });

    assert.deepEqual(first, { copied: 1, skipped: 0, collisions: [] });
    assert.deepEqual(second, { copied: 0, skipped: 1, collisions: [] });
  });

  it('preserves an old file and fails safely on a same-path collision', async () => {
    const { source, destination } = await fixture();
    await mkdir(path.join(source, 'build'), { recursive: true });
    await mkdir(path.join(destination, 'build'), { recursive: true });
    await writeFile(path.join(source, 'build', 'manifest.js'), 'new manifest');
    await writeFile(path.join(destination, 'build', 'manifest.js'), 'old manifest');

    const warnings = [];
    await assert.rejects(
      retainStaticAssets({ source, destination, logger: { warn(message) { warnings.push(message); } } }),
      (error) => error instanceof StaticAssetCollisionError,
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /manifest\.js/);
    assert.equal(await readFile(path.join(destination, 'build', 'manifest.js'), 'utf8'), 'old manifest');
  });

  it('rejects source symlinks instead of traversing outside the source tree', async () => {
    const { root, source, destination } = await fixture();
    const outside = path.join(root, 'outside');
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, 'secret.js'), 'must not copy');
    await symlink(outside, path.join(source, 'escape'));

    await assert.rejects(
      retainStaticAssets({ source, destination, logger: { warn() {} } }),
      /Symlink is not allowed in source static assets/,
    );
    await assert.rejects(readFile(path.join(destination, 'escape', 'secret.js')));
  });

  it('rejects a symlink destination rather than writing through it', async () => {
    const { root, source, destination } = await fixture();
    const outside = path.join(root, 'outside');
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(source, 'asset.js'), 'asset');
    await symlink(outside, path.join(destination, 'asset.js'));

    await assert.rejects(
      retainStaticAssets({ source, destination, logger: { warn() {} } }),
      /Symlink destination is not allowed/,
    );
    await assert.rejects(readFile(path.join(outside, 'asset.js')));
  });
});
