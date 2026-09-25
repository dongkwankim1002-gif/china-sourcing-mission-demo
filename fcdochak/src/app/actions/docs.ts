'use server';
/**
 * 서류 올리기 — 파일 본문은 Supabase Storage(비공개 버킷 fcd-docs)에, 기록은 fcd.documents 에.
 * Storage 가 연결되지 않은 로컬에서는 기록만 남긴다(본문 없음 표시).
 */
import { revalidatePath } from 'next/cache';
import { randomBytes } from 'node:crypto';
import { asUser } from '@/lib/db';
import { env } from '@/lib/env';
import { getViewer } from '@/lib/server/viewer';

const KINDS = ['commercial_invoice', 'packing_list', 'bl', 'co', 'import_declaration', 'photo', 'other'] as const;
const MAX = 15 * 1024 * 1024;

export async function uploadDocument(form: FormData): Promise<{ ok: boolean; error?: string }> {
  const v = await getViewer();
  if (!v) return { ok: false, error: '로그인이 풀렸습니다' };
  const shipmentId = String(form.get('shipmentId') ?? '');
  const kind = String(form.get('kind') ?? 'other') as (typeof KINDS)[number];
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: '파일을 고르세요' };
  if (file.size > MAX) return { ok: false, error: '15MB 보다 큰 파일은 올릴 수 없습니다' };
  if (!KINDS.includes(kind)) return { ok: false, error: '서류 종류를 고르세요' };
  const safe = file.name.replace(/[^\w.\-가-힣]/g, '_').slice(-80);
  let storagePath: string | null = null;
  if (env.supabaseUrl && env.supabaseServiceKey) {
    storagePath = `${shipmentId}/${randomBytes(6).toString('hex')}-${safe}`;
    const r = await fetch(`${env.supabaseUrl}/storage/v1/object/fcd-docs/${encodeURI(storagePath)}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.supabaseServiceKey}`, 'content-type': file.type || 'application/octet-stream', 'x-upsert': 'false' },
      body: Buffer.from(await file.arrayBuffer()),
    });
    if (!r.ok) return { ok: false, error: `파일 저장소에 올리지 못했습니다(${r.status})` };
  }
  try {
    await asUser(v, (q) =>
      q.query(`insert into fcd.documents (shipment_id, org_id, kind, file_name, storage_path, size_bytes, created_by) values ($1,$2,$3,$4,$5,$6,$7)`, [
        shipmentId,
        v.org.id,
        kind,
        safe,
        storagePath,
        file.size,
        v.id,
      ]),
    );
  } catch {
    return { ok: false, error: '이 선적에 서류를 올릴 권한이 없습니다' };
  }
  revalidatePath(`/app/shipments/${shipmentId}`);
  revalidatePath(`/partner/shipments/${shipmentId}`);
  return { ok: true };
}
