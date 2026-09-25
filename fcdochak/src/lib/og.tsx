import 'server-only';
import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BRAND } from './brand';

export const OG_SIZE = { width: 1200, height: 630 };

const SEG = ['#e3f2ff', '#cbdef4', '#b3cae4', '#9bb6d5', '#84a3c6', '#6e90b7', '#577da8', '#416b99', '#2a598a'];

let fonts: Promise<{ bold: Buffer; regular: Buffer }> | null = null;
function loadFonts() {
  fonts ??= Promise.all([
    readFile(join(process.cwd(), 'src/assets/og/Pretendard-Bold.subset.woff')),
    readFile(join(process.cwd(), 'src/assets/og/Pretendard-Regular.subset.woff')),
  ]).then(([bold, regular]) => ({ bold, regular }));
  return fonts;
}

/** 공유 카드 — 남색 바탕, 노랑 숫자, 9구간 띠. 구간 시세·업체 페이지가 같이 쓴다. */
export async function ogCard(o: { eyebrow: string; title: string; value?: string; sub?: string; shares?: number[] }) {
  const f = await loadFonts();
  const total = (o.shares ?? []).reduce((a, b) => a + b, 0) || 1;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0e2340', color: '#eef3fa', padding: 64, fontFamily: 'Pretendard' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', background: '#f7c600', color: '#0e2340', fontSize: 30, fontWeight: 700, padding: '6px 14px', borderRadius: 6 }}>{BRAND.markText}</div>
          <div style={{ display: 'flex', fontSize: 34, fontWeight: 700 }}>{BRAND.name}</div>
          <div style={{ display: 'flex', marginLeft: 'auto', fontSize: 24, color: '#a9b7ca' }}>{o.eyebrow}</div>
        </div>
        <div style={{ display: 'flex', marginTop: 64, fontSize: 64, fontWeight: 700, lineHeight: 1.1 }}>{o.title}</div>
        {o.value ? <div style={{ display: 'flex', marginTop: 24, fontSize: 96, fontWeight: 700, color: '#f7c600' }}>{o.value}</div> : null}
        {o.sub ? <div style={{ display: 'flex', marginTop: 8, fontSize: 28, color: '#a9b7ca' }}>{o.sub}</div> : null}
        <div style={{ display: 'flex', marginTop: 'auto', gap: 4, height: 28 }}>
          {(o.shares?.length ? o.shares : [1, 1, 1, 1, 1, 1, 1, 1, 1]).map((s, i) => (
            <div key={i} style={{ display: 'flex', width: `${(s / total) * 100}%`, background: SEG[i], borderRadius: 3 }} />
          ))}
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: 'Pretendard', data: f.bold, weight: 700, style: 'normal' },
        { name: 'Pretendard', data: f.regular, weight: 400, style: 'normal' },
      ],
    },
  );
}
