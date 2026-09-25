import { PublicFooter } from '@/components/public/footer';
import { PublicHeader } from '@/components/public/header';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PublicHeader />
      <main id="main">{children}</main>
      <PublicFooter />
    </>
  );
}
