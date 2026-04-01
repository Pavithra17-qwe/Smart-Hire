import { sendInterviewEmail } from '@/ai/flows/send-interview-email-flow';

export async function POST(req: Request) {
  try {
    const data = await req.json();

    await sendInterviewEmail(data);

    return Response.json({ success: true });
  } catch (error: any) {
    console.error('Email API Error:', error);
    return Response.json({ success: false, error: error.message });
  }
}