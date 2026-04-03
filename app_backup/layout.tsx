import '../src/styles/globals.css';
import { AuthProvider } from "@/hooks/useAuth";
import { Toaster } from "@/components/ui/toaster";

export const metadata = {
  title: 'SmartHire - Simplified Job Requisitions',
  description: 'A streamlined platform for managing job requisitions and candidate interviews, connecting admins, agencies, and interview panelists.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
            {children}
            <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}
