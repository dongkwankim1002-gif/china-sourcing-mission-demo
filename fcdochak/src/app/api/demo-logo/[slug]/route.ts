/**
 * 데모 업체가 「올린 로고」 자리 — 생성한 글자 마크 SVG. 실존 로고를 흉내 내지 않는다.
 * 데모를 걷어내면 이 경로를 가리키는 조직도 사라진다.
 */
import { asPublic } from '@/lib/db';

const COLORS = [
  ['#0e2340', '#f7c600'],
  ['#0e7c71', '#ffffff'],
  ['#214375', '#ffe066'],
  ['#5a3d8a', '#ffffff'],
  ['#7a4a12', '#fff1d9'],
];

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export async function GET(_: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const org = await asPublic((q) =>
    q.query<{ name: string; is_demo: boolean }>(`select name, is_demo from fcd.orgs where slug = $1`, [slug]),
  );
  if (!org[0]?.is_demo) return new Response('없음', { status: 404 });
  const name = org[0].name;
  const [bg, fg] = COLORS[hash(slug) % COLORS.length];
  const chars = [...name].slice(0, 2).join('');
  const shape = hash(name) % 3;
  const deco =
    shape === 0
      ? `<rect x="10" y="74" width="76" height="6" fill="${fg}" opacity=".9"/>`
      : shape === 1
        ? `<circle cx="78" cy="20" r="7" fill="${fg}"/>`
        : `<path d="M10 80 L48 66 L86 80" stroke="${fg}" stroke-width="5" fill="none"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="${esc(name)}"><rect width="96" height="96" rx="10" fill="${bg}"/>${deco}<text x="48" y="58" text-anchor="middle" font-family="Pretendard, sans-serif" font-weight="800" font-size="30" fill="${fg}">${esc(chars)}</text></svg>`;
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } });
}
