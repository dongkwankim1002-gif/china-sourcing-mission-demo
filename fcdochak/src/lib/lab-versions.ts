/**
 * 버전 비교실에 띄울 판. LAB_VERSIONS(JSON 배열)로 바꿀 수 있다 — 새 판(v3…)은 가지 fcdochak-v3 에
 * 공개용 Vercel 프로젝트(docs/DEPLOY.md 「버전 비교실」)에 가지 주소를 붙이고 여기에 한 줄.
 * url 이 비어 있으면 비교실과 같은 주소(운영).
 */
/** https 주소, 또는 로컬 시험용 localhost */
const ORIGIN_RE = /^(https:\/\/[a-z0-9.-]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/i;

export interface LabVersion {
  key: string;
  name: string;
  url: string;
  note: string;
  /** 이 판이 사는 구역(같은 주소 안의 다른 판일 때) — 예: '/onestop' */
  start?: string;
  planned?: boolean;
}

const DEFAULT: LabVersion[] = [
  { key: 'main', name: '운영', url: '', note: '지금 공개된 FC도착 · Supabase 운영 DB' },
  { key: 'v2', name: 'v2', url: 'https://fcdochak-v2-live.vercel.app', note: '확정·책임 플랫폼 전환판 · 임시 DB(예시 자료)' },
  { key: 'onestop', name: '원스톱', url: 'https://fcdochak-v2-live.vercel.app', start: '/onestop', note: '원스톱 대행형 구역(v2 안) · 임시 DB(예시 자료)' },
];

export function labVersions(): LabVersion[] {
  try {
    const raw = process.env.LAB_VERSIONS;
    if (!raw) return DEFAULT;
    const list = JSON.parse(raw) as LabVersion[];
    return list.filter((v) => v && typeof v.key === 'string' && typeof v.name === 'string' && (v.start === undefined || /^\/[a-z0-9-]+$/.test(v.start)) && (v.url === '' || ORIGIN_RE.test(v.url)));
  } catch {
    return DEFAULT;
  }
}
