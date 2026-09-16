import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';

export const metadata: Metadata = {
  title: 'MML Server Dashboard',
  description: 'Micro Maintenance server monitoring dashboard.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
