#!/usr/bin/env node
/**
 * Retain every immutable file from the current Next.js build without deleting
 * files from older builds. The destination is a persistent Docker volume.
 *
 * A destination file is installed by writing a complete temporary file and
 * hard-linking it into place. That makes the visible file appear atomically
 * and, unlike rename(), never replaces a file that another process created.
 */
import { constants, promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

export class StaticAssetCollisionError extends Error {
  constructor(conflicts) {
    super(
      `Refusing to replace ${conflicts.length} retained Next.js static asset(s):\n` +
        conflicts.map(({ relativePath }) => ` - ${relativePath}`).join('\n'),
    );
    this.name = 'StaticAssetCollisionError';
    this.conflicts = conflicts;
  }
}

function isMissing(error) {
  return error?.code === 'ENOENT';
}

/**
 * Check every existing path component. This rejects a symlink both at the
 * source root and in a destination path before mkdir/copy can follow it.
 */
async function assertNoSymlinkComponents(inputPath) {
  const absolutePath = path.resolve(inputPath);
  const parsed = path.parse(absolutePath);
  let current = parsed.root;
  const components = absolutePath.slice(parsed.root.length).split(path.sep).filter(Boolean);

  for (const component of components) {
    current = path.join(current, component);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`Symlink is not allowed in static asset path: ${current}`);
      }
    } catch (error) {
      if (isMissing(error)) break;
      throw error;
    }
  }
}

async function ensureSafeDirectory(directory) {
  await assertNoSymlinkComponents(directory);
  try {
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlink directory is not allowed: ${directory}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`Expected a directory, found another file: ${directory}`);
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
    await fs.mkdir(directory, { recursive: true });
    await assertNoSymlinkComponents(directory);
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Unsafe directory created at: ${directory}`);
    }
  }
}

async function collectFiles(sourceRoot, currentDirectory, files = []) {
  const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const fullPath = path.join(currentDirectory, entry.name);
    const stat = await fs.lstat(fullPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlink is not allowed in source static assets: ${fullPath}`);
    }
    if (stat.isDirectory()) {
      await collectFiles(sourceRoot, fullPath, files);
      continue;
    }
    if (!stat.isFile()) {
      throw new Error(`Unsupported source static asset type: ${fullPath}`);
    }
    const relativePath = path.relative(sourceRoot, fullPath);
    if (!relativePath || path.isAbsolute(relativePath) || relativePath.split(path.sep).includes('..')) {
      throw new Error(`Unsafe relative static asset path: ${relativePath}`);
    }
    files.push({ fullPath, relativePath, mode: stat.mode & 0o777 });
  }
  return files;
}

async function hashFile(filePath) {
  // Open with O_NOFOLLOW so a file changed to a symlink cannot be read through
  // the symlink. Next static files are small enough that this also keeps the
  // implementation dependency-free and easy to reason about.
  const handle = await fs.open(filePath, constants.O_RDONLY | NOFOLLOW);
  try {
    const contents = await handle.readFile();
    return crypto.createHash('sha256').update(contents).digest('hex');
  } finally {
    await handle.close();
  }
}

async function copyFileAtomically(sourcePath, destinationPath, mode) {
  const parent = path.dirname(destinationPath);
  await ensureSafeDirectory(parent);
  const temporaryPath = path.join(
    parent,
    `.${path.basename(destinationPath)}.tmp-${process.pid}-${crypto.randomUUID()}`,
  );

  const sourceHandle = await fs.open(sourcePath, constants.O_RDONLY | NOFOLLOW);
  let temporaryCreated = false;
  try {
    const contents = await sourceHandle.readFile();
    const temporaryHandle = await fs.open(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW,
      mode || 0o644,
    );
    temporaryCreated = true;
    try {
      await temporaryHandle.writeFile(contents);
      await temporaryHandle.sync();
      await temporaryHandle.chmod(mode || 0o644);
    } finally {
      await temporaryHandle.close();
    }

    // link()+unlink() exposes a fully written file atomically and never
    // overwrites a destination created by a concurrent invocation.
    await fs.link(temporaryPath, destinationPath);
  } finally {
    await sourceHandle.close();
    if (temporaryCreated) {
      await fs.rm(temporaryPath, { force: true });
    }
  }
}

async function inspectDestination(destinationPath) {
  try {
    const stat = await fs.lstat(destinationPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlink destination is not allowed: ${destinationPath}`);
    }
    if (!stat.isFile()) {
      throw new Error(`Expected retained asset to be a file: ${destinationPath}`);
    }
    return stat;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/**
 * Copy source static assets into a persistent destination.
 *
 * Existing equal files are skipped. Existing different files are never
 * overwritten; all such collisions are reported and cause a non-zero exit so
 * the caller does not start a server with an ambiguous asset set.
 */
export async function retainStaticAssets({ source, destination, logger = console }) {
  if (!source || !destination) {
    throw new TypeError('Both source and destination are required');
  }

  const sourceRoot = path.resolve(source);
  const destinationRoot = path.resolve(destination);
  await assertNoSymlinkComponents(sourceRoot);
  await assertNoSymlinkComponents(destinationRoot);

  const sourceStat = await fs.lstat(sourceRoot);
  if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
    throw new Error(`Source must be a real directory: ${sourceRoot}`);
  }
  await ensureSafeDirectory(destinationRoot);

  const files = await collectFiles(sourceRoot, sourceRoot);
  const result = { copied: 0, skipped: 0, collisions: [] };

  for (const file of files) {
    const destinationPath = path.resolve(destinationRoot, file.relativePath);
    const relativeDestination = path.relative(destinationRoot, destinationPath);
    if (
      !relativeDestination ||
      path.isAbsolute(relativeDestination) ||
      relativeDestination.split(path.sep).includes('..')
    ) {
      throw new Error(`Unsafe destination static asset path: ${file.relativePath}`);
    }

    const parent = path.dirname(destinationPath);
    await ensureSafeDirectory(parent);
    const existing = await inspectDestination(destinationPath);
    if (existing) {
      const [sourceHash, destinationHash] = await Promise.all([
        hashFile(file.fullPath),
        hashFile(destinationPath),
      ]);
      if (sourceHash === destinationHash) {
        result.skipped += 1;
        continue;
      }

      const collision = { relativePath: file.relativePath, destinationPath };
      result.collisions.push(collision);
      logger.warn?.(
        `Retained Next.js asset collision; preserving the old file: ${file.relativePath}`,
      );
      continue;
    }

    try {
      await copyFileAtomically(file.fullPath, destinationPath, file.mode);
      result.copied += 1;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      // A concurrent invocation won the link race. Compare content and apply
      // the same safe collision policy rather than replacing its file.
      const existingAfterRace = await inspectDestination(destinationPath);
      if (!existingAfterRace) throw error;
      const [sourceHash, destinationHash] = await Promise.all([
        hashFile(file.fullPath),
        hashFile(destinationPath),
      ]);
      if (sourceHash === destinationHash) {
        result.skipped += 1;
      } else {
        const collision = { relativePath: file.relativePath, destinationPath };
        result.collisions.push(collision);
        logger.warn?.(
          `Retained Next.js asset collision; preserving the old file: ${file.relativePath}`,
        );
      }
    }
  }

  if (result.collisions.length > 0) {
    throw new StaticAssetCollisionError(result.collisions);
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const valueFor = (flag) => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  const source = valueFor('--source');
  const destination = valueFor('--destination');
  if (!source || !destination) {
    console.error('Usage: retain-next-static.mjs --source DIR --destination DIR');
    process.exitCode = 2;
    return;
  }

  const result = await retainStaticAssets({ source, destination });
  console.log(
    `Retained Next.js static assets: copied=${result.copied}, skipped=${result.skipped}, destination=${path.resolve(destination)}`,
  );
}

const thisFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedFile && path.resolve(thisFile) === invokedFile) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
