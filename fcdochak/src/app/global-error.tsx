'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="ko">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 32, background: '#eef1f4', color: '#0e1b2c' }}>
        <h1 style={{ fontSize: 22 }}>서비스를 불러오지 못했습니다</h1>
        <p style={{ color: '#5b6878' }}>잠시 뒤 다시 시도해 주세요. 문제가 계속되면 hello@fcdochak.example 로 알려 주세요.</p>
        <button onClick={() => reset()} style={{ marginTop: 16, padding: '8px 16px', background: '#f7c600', border: 0, borderRadius: 6, fontWeight: 700 }}>
          다시 시도
        </button>
      </body>
    </html>
  );
}
