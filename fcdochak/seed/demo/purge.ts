/**
 * 데모 걷어내기 SQL 만들기 — 만들기만 한다. 실행은 사람이 한다(docs/DEMO.md).
 *
 * 순서: ① 데모 조직에 속하지 않은 데모 계정(운영 조직의 데모 운영자 등) 프로필을 지우고
 *       ② is_demo 조직을 지운다 — 그 아래 자료는 FK ON DELETE CASCADE 로 함께 사라진다.
 *       ③ Supabase 라면 auth.users 의 데모 계정도 지운다.
 * 파일 안에 지우기 전·뒤 건수 확인 쿼리를 함께 둔다.
 */
import type { Queryable } from '@/lib/db/driver';
import { demoCounts } from '@/lib/server/demo-status';
import { DEMO_ACCOUNTS } from './index';

export interface PurgePlan {
  generatedAt: string;
  demoOrgs: number;
  /** 데모 조직 밖에 사는 데모 계정 id */
  strayProfileIds: string[];
  /** 데모 계정 전체 id(auth.users 정리용) */
  demoUserIds: string[];
  counts: { table: string; demo: number; real: number }[];
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const list = (ids: string[]) => {
  for (const id of ids) if (!uuid.test(id)) throw new Error(`uuid 가 아닙니다: ${id}`);
  return ids.map((id) => `'${id}'`).join(', ');
};

export function buildPurgeSql(p: PurgePlan): string {
  const total = p.counts.reduce((t, c) => t + c.demo, 0);
  const lines = [
    '-- FC도착 데모 걷어내기 — 생성 파일(npm run demo:purge). 이 파일은 자동으로 실행되지 않습니다.',
    `-- 만든 때: ${p.generatedAt}`,
    `-- 지울 데모 조직: ${p.demoOrgs}곳 · 표별 예시 건수 합계 ${total}건`,
    ...p.counts.map((c) => `--   ${c.table.padEnd(24)} 예시 ${String(c.demo).padStart(6)} · 실제 ${String(c.real).padStart(6)} (실제는 건드리지 않음)`),
    '--',
    '-- 먼저: 배포 환경변수 DEMO_MODE=off 로 숨긴 뒤 며칠 두고 보고, 백업(Supabase → Database → Backups)을 확인하세요.',
    '-- 실행: Supabase SQL 편집기에 붙여 넣고 한 번에 실행. 한 트랜잭션이라 중간에 실패하면 아무것도 지워지지 않습니다.',
    '',
    'begin;',
    '',
    '-- 지우기 전 건수',
    `select count(*) as demo_orgs from fcd.orgs where is_demo;`,
    '',
  ];
  if (p.strayProfileIds.length) {
    lines.push('-- ① 데모 조직 밖(운영 조직 등)에 속한 데모 계정', `delete from fcd.profiles where id in (${list(p.strayProfileIds)});`, '');
  }
  lines.push('-- ② 데모 조직 — 그 아래 요금표·요청·응찰·예약·선적·청구·평가·알림은 CASCADE 로 함께 사라집니다', 'delete from fcd.orgs where is_demo;', '');
  if (p.demoUserIds.length) {
    lines.push(
      '-- ③ Supabase Auth 의 데모 계정(auth 스키마가 없는 로컬 DB 에서는 건너뜀)',
      'do $$',
      'begin',
      "  if to_regclass('auth.users') is not null then",
      `    delete from auth.users where id in (${list(p.demoUserIds)});`,
      '  end if;',
      'end $$;',
      '',
    );
  }
  lines.push(
    '-- 지운 뒤 확인 — 모두 0 이어야 합니다',
    'select',
    '  (select count(*) from fcd.orgs where is_demo) as demo_orgs,',
    `  (select count(*) from fcd.profiles where id in (${p.demoUserIds.length ? list(p.demoUserIds) : 'null'})) as demo_profiles;`,
    '',
    'commit;',
    '',
    '-- 끝나면 Supabase Storage 의 fcd-docs 버킷에서 데모 조직 폴더(조직 id)도 비우세요(파일은 SQL 로 지우지 않습니다).',
    '',
  );
  return lines.join('\n');
}


/** 지울 대상을 DB 에서 읽어 계획을 만든다(읽기만) */
export async function planPurge(q: Queryable, now = new Date()): Promise<PurgePlan> {
  const counts = await demoCounts(q);
  const emails = Object.values(DEMO_ACCOUNTS).map((a) => a.email);
  const users = await q.query<{ id: string; stray: boolean }>(
    `select p.id, not coalesce(o.is_demo, false) stray from fcd.profiles p left join fcd.orgs o on o.id = p.home_org_id
      where o.is_demo or lower(p.email) = any($1::text[]) order by p.id`,
    [`{${emails.join(',')}}`],
  );
  return {
    generatedAt: now.toISOString(),
    demoOrgs: counts.find((c) => c.table === 'orgs')!.demo,
    strayProfileIds: users.filter((u) => u.stray).map((u) => u.id),
    demoUserIds: users.map((u) => u.id),
    counts,
  };
}
