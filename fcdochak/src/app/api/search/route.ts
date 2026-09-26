import { NextResponse, type NextRequest } from 'next/server';
import { asUser } from '@/lib/db';
import { readSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/** 명령 팔레트 검색 — 요청·선적 번호, 업체, SKU. 보이는 것은 RLS 가 정한다. */
export async function GET(req: NextRequest) {
  const s = await readSession();
  if (!s) return NextResponse.json({ hits: [] }, { status: 401 });
  const area = req.nextUrl.searchParams.get('area') ?? 'app';
  const raw = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 60);
  if (!raw) return NextResponse.json({ hits: [] });
  const like = `%${raw.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
  const base = area === 'partner' ? '/partner' : area === 'admin' ? '/admin' : '/app';
  const hits = await asUser({ id: s.userId }, async (q) => {
    const out: { kind: string; id: string; title: string; sub: string; href: string }[] = [];
    const reqs = await q.query<{ id: string; req_no: string; title: string }>(
      `select id, req_no, title from fcd.quote_requests where req_no ilike $1 or title ilike $1 order by created_at desc limit 6`,
      [like],
    );
    for (const r of reqs)
      out.push({ kind: 'request', id: r.id, title: r.req_no, sub: r.title, href: area === 'partner' ? `/partner/inbox/${r.id}` : area === 'admin' ? `/admin/data?q=${r.req_no}` : `/app/requests/${r.id}` });
    const ships = await q.query<{ id: string; shipment_no: string; stage: number }>(
      `select id, shipment_no, stage from fcd.shipments where shipment_no ilike $1 order by created_at desc limit 6`,
      [like],
    );
    for (const x of ships)
      out.push({ kind: 'shipment', id: x.id, title: x.shipment_no, sub: `${x.stage}단계`, href: area === 'admin' ? `/admin/data?q=${x.shipment_no}` : `${base}/shipments/${x.id}` });
    const orgs = await q.query<{ id: string; name: string; slug: string; kind: string }>(
      `select id, name, slug, kind from fcd.orgs where kind = 'partner' and (name ilike $1 or name_zh ilike $1) order by name limit 5`,
      [like],
    );
    for (const o of orgs) out.push({ kind: 'partner', id: o.id, title: o.name, sub: '업체 공개 페이지', href: area === 'admin' ? `/admin/data?org=${o.id}` : `/p/${o.slug}` });
    if (area === 'app') {
      const skus = await q.query<{ id: string; name: string; units: number }>(
        `select id, name, units from fcd.skus where name ilike $1 and not archived order by created_at desc limit 5`,
        [like],
      );
      for (const k of skus) out.push({ kind: 'sku', id: k.id, title: k.name, sub: `${k.units.toLocaleString('ko-KR')}개 기준`, href: `/app/skus?focus=${k.id}` });
    }
    return out;
  });
  return NextResponse.json({ hits }, { headers: { 'Cache-Control': 'private, no-store' } });
}
