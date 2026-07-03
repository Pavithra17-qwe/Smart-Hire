// app/interview/reschedule/[token]/page.tsx
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import RescheduleClient from './RescheduleClient';

interface PageProps {
  params: Promise<{ token: string }>;
}

// This is intentionally a thin wrapper: RescheduleClient calls
// /api/interview/reschedule/info itself on mount so all the eligibility
// logic lives in one place (the API route) instead of being duplicated
// between a server fetch here and the client's own re-check before submit.
export default async function ReschedulePage({ params }: PageProps) {
  const { token } = await params;
  return <RescheduleClient token={token} />;
}