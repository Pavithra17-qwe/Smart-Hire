'use client';

import { Badge } from '@/components/ui/badge';
import { normalizeStatus } from '@/lib/normalizeStatus';
import { cn } from '@/lib/utils';

interface FinalStatusBadgeProps {
  status?: string;
}

export const FinalStatusBadge: React.FC<FinalStatusBadgeProps> = ({ status }) => {
  const { name, color } = normalizeStatus(status);
  
  return (
    <Badge className={cn('capitalize', color)}>
      {name}
    </Badge>
  );
};
