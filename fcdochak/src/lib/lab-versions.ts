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
  planned?: boolean;
  /** 이 판의 첫 화면 경로(비교실이 「/」를 열 때 대신 연다) — 예: 원스톱 판은 v2 주소의 /onestop */
  home?: string;
}

const DEFAULT: LabVersion[] = [
  { key: 'main', name: '운영', url: '', note: '지금 공개된 FC도착 · Supabase 운영 DB' },
  { key: 'v2', name: 'v2', url: 'https://fcdochak-v2-live.vercel.app', note: '확정·책임 플랫폼 전환판 · 임시 DB(예시 자료)' },
  { key: 'onestop', name: '원스톱', url: 'https://fcdochak-v2-live.vercel.app', home: '/onestop', note: '원스톱 대행형 가설 판 · v2 안의 /onestop(docs/onestop-plan.md)' },
  { key: 'v3', name: 'v3', url: 'https://fcdochak-v3-live.vercel.app', note: '다음 판 자리', planned: true },
];

export function labVersions(): LabVersion[] {
  try {
    const raw = process.env.LAB_VERSIONS;
    if (!raw) return DEFAULT;
    const list = JSON.parse(raw) as LabVersion[];
    return list.filter((v) => v && typeof v.key === 'string' && typeof v.name === 'string' && (v.url === '' || ORIGIN_RE.test(v.url)));
  } catch {
    return DEFAULT;
  }
}
