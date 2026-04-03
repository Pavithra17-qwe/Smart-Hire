'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Loader2 } from 'lucide-react';

const roleAreaMap = {
  admin: 'admin',
  agency: 'agency',
  hr: 'hr',
  panel: 'panel',
};

export default function RootPage() {
  const { user, role, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (user && role) {
        const dashboardPath = `/${roleAreaMap[role]}/dashboard`;
        router.replace(dashboardPath);
      } else if (!user) {
        router.replace('/login');
      }
    }
  }, [user, role, loading, router]);

  return (
    <div className="h-screen w-full flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}
