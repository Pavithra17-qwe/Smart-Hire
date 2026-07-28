import { sendInterviewEmail } from '@/ai/flows/send-interview-email-flow';

function isUnsafeProductionUrl(url: string): boolean {
  return (
    /localhost/i.test(url) ||
    /127\.0\.0\.1/.test(url) ||
    /cloudworkstations\.dev/i.test(url)
  );
}

export async function POST(req: Request) {
  try {
    const data = await req.json();

    // ── Diagnostics (task 13): log environment + generated link before sending ──
    const env = process.env.NODE_ENV;
    const linkToCheck: string =
      data?.interviewLink ||
      (typeof data?.schedulingNotes === 'string'
        ? data.schedulingNotes.match(/https?:\/\/[^\s]+/)?.[0]
        : undefined) ||
      '';

    console.log('[Email API] env:', env);
    console.log('[Email API] emailType:', data?.emailType);
    console.log('[Email API] candidateId:', data?.candidateId);
    console.log('[Email API] outgoing link:', linkToCheck || '(none found in payload)');

    // ── Guardrail (task 12): never let a dev/preview URL reach candidates in prod ──
    if (env === 'production' && linkToCheck && isUnsafeProductionUrl(linkToCheck)) {
      console.error('[Email API] BLOCKED unsafe URL in production email:', linkToCheck);
      return Response.json({
        success: false,
        error: `Refusing to send: interview link resolved to a non-production URL (${linkToCheck}). Check APP_URL/NEXT_PUBLIC_APP_URL in the caller that builds this link.`,
      });
    }

    await sendInterviewEmail(data);

    return Response.json({ success: true });
  } catch (error: any) {
    console.error('Email API Error:', error);
    return Response.json({ success: false, error: error.message });
  }
}