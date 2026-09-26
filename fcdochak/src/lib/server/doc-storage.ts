import 'server-only';
/**
 * 서류 파일 저장 — 기존 서류함과 같은 방식(Supabase Storage 비공개 버킷 fcd-docs, 서버 열쇠로만 올리고 60초 서명 주소로 내려준다).
 * 저장소가 연결되지 않은 로컬·미리보기에서는 파일 본문 없이 기록만 남는다(storagePath = null).
 * 서비스 열쇠는 환경변수에서만 읽고 로그에 남기지 않는다.
 */
import { randomBytes } from 'node:crypto';
import { env } from '../env';

export const DOC_MAX_BYTES = 15 * 1024 * 1024;
const BUCKET = 'fcd-docs';

export const storageReady = () => !!(env.supabaseUrl && env.supabaseServiceKey);

export function safeFileName(name: string): string {
  return name.replace(/[^\w.\-가-힣]/g, '_').slice(-80) || 'file';
}

/** 파일을 올린다. 저장소가 없으면 null(기록만) */
export async function putDoc(prefix: string, file: File): Promise<{ ok: true; storagePath: string | null } | { ok: false; status: number }> {
  if (!storageReady()) return { ok: true, storagePath: null };
  const storagePath = `${prefix}/${randomBytes(6).toString('hex')}-${safeFileName(file.name)}`;
  const r = await fetch(`${env.supabaseUrl}/storage/v1/object/${BUCKET}/${encodeURI(storagePath)}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.supabaseServiceKey}`, 'content-type': file.type || 'application/octet-stream', 'x-upsert': 'false' },
    body: Buffer.from(await file.arrayBuffer()),
  });
  return r.ok ? { ok: true, storagePath } : { ok: false, status: r.status };
}

/** 60초짜리 서명 주소 */
export async function signDoc(storagePath: string): Promise<string | null> {
  if (!storageReady()) return null;
  const r = await fetch(`${env.supabaseUrl}/storage/v1/object/sign/${BUCKET}/${encodeURI(storagePath)}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.supabaseServiceKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn: 60 }),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { signedURL: string };
  return `${env.supabaseUrl}/storage/v1${j.signedURL}`;
}
