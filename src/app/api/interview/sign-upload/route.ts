import { NextRequest, NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key:    process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

function toSlug(str: string, maxLen = 60): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9@._-]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, maxLen);
}

export async function POST(req: NextRequest) {
  try {
    const { token, candidateId, candidateName, candidateEmail } = await req.json();

    const timestamp = Math.round(Date.now() / 1000);
    const folder    = `smarthire/interviews/${toSlug(`${candidateName}_${candidateEmail ?? ''}`)}`;
    const public_id = 'full_interview';

    const signature = cloudinary.utils.api_sign_request(
      {
        timestamp,
        folder,
        public_id,
        overwrite: false,
        tags: `interview,candidate_${candidateId},token_${token}`,
      },
      process.env.CLOUDINARY_API_SECRET!
    );

    return NextResponse.json({
      signature,
      timestamp,
      folder,
      public_id,
      api_key:    process.env.CLOUDINARY_API_KEY!,
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
    });

  } catch (err: any) {
    console.error('[sign-upload] Failed:', err);
    return NextResponse.json({ error: 'Failed', detail: err.message }, { status: 500 });
  }
}