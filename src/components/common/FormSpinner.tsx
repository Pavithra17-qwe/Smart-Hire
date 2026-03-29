
import { Loader2 } from 'lucide-react';

export const FormSpinner = () => (
  <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-10">
    <Loader2 className="h-10 w-10 animate-spin text-primary" />
  </div>
);
