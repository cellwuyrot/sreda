import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const MAX_SIZE = 500 * 1024 * 1024; // 500 MB
const ALLOWED_EXT = ['exe', 'apk', 'dmg', 'deb', 'appimage', 'pkg', 'msi'];

// POST /api/about-apps-upload — upload installer file (admin only)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });

  if (file.size > MAX_SIZE)
    return NextResponse.json({ error: 'File too large (max 500 MB)' }, { status: 413 });

  const originalName = file.name.toLowerCase();
  const ext = originalName.split('.').pop() ?? '';
  if (!ALLOWED_EXT.includes(ext))
    return NextResponse.json(
      { error: `Unsupported format. Allowed: ${ALLOWED_EXT.join(', ')}` },
      { status: 415 },
    );

  const uuid = randomUUID();
  const filename = `${uuid}.${ext}`;
  const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'apps');
  await mkdir(uploadsDir, { recursive: true });

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(uploadsDir, filename), buffer);

  return NextResponse.json({
    url: `/uploads/apps/${filename}`,
    fileName: file.name,
    fileSize: file.size,
  });
}

// DELETE /api/about-apps-upload — remove installer file from disk (admin only)
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await req.json()) as { fileUrl?: string };
  if (!body.fileUrl)
    return NextResponse.json({ error: 'fileUrl required' }, { status: 400 });

  // Safety: only delete files from /uploads/apps/
  const urlPath = body.fileUrl.startsWith('/') ? body.fileUrl : `/${body.fileUrl}`;
  if (!urlPath.startsWith('/uploads/apps/')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const filePath = path.join(process.cwd(), 'public', urlPath);
  try {
    if (existsSync(filePath)) await unlink(filePath);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Could not delete file' }, { status: 500 });
  }
}
