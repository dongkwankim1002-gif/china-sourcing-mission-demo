import type { Metadata } from 'next';
import { labVersions } from '@/lib/lab-versions';
import { LabClient } from '@/components/lab/lab-client';

export const metadata: Metadata = {
  title: '버전 비교실',
  description: '운영·v2·v3… 여러 판을 한 화면에 나란히 띄워 비교하고 평가를 남깁니다.',
  robots: { index: false, follow: false },
};

export default function LabPage() {
  return <LabClient versions={labVersions()} />;
}
