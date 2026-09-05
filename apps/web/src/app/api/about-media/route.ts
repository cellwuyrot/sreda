/**
 * POST /api/about-media
 * Upload media files for the /about page (images, GIFs, videos).
 * Admin only. Files are saved to public/uploads/about/ and accessible without auth.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

const MAX_SIZE = 200 * 1024 * 1024; // 200 MB
const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mov'];
const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
};

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });

  // Validate size
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'File too large (max 200 MB)' }, { status: 413 });
  }

  // Validate extension
  const originalName = file.name.toLowerCase();
  const ext = originalName.split('.').pop() ?? '';
  if (!ALLOWED_EXT.includes(ext)) {
    return NextResponse.json(
      { error: `Unsupported format. Allowed: ${ALLOWED_EXT.join(', ')}` },
      { status: 415 },
    );
  }

  const uuid = randomUUID();
  const filename = `${uuid}.${ext}`;

  // Save to public/uploads/about/
  const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'about');
  await mkdir(uploadsDir, { recursive: true });
  const filePath = path.join(uploadsDir, filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

  const url = `/uploads/about/${filename}`;
  const mediaType = ['mp4', 'webm', 'mov'].includes(ext) ? 'video' : ext === 'gif' ? 'gif' : 'image';

  return NextResponse.json({
    url,
    filename,
    originalName: file.name,
    size: file.size,
    mime: MIME_MAP[ext] ?? 'application/octet-stream',
    mediaType,
  });
}
