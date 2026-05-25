// app/api/interview/transcribe/route.ts
import { NextRequest, NextResponse } from 'next/server';

const GROQ_WHISPER_LIMIT_BYTES = 24 * 1024 * 1024; // 24MB safe limit

export async function POST(req: NextRequest) {
  try {
    const { videoUrls } = await req.json() as { videoUrls: string[] };

    if (!Array.isArray(videoUrls) || videoUrls.length === 0) {
      return NextResponse.json({ transcripts: [] });
    }

    const transcripts: string[] = [];

    for (let i = 0; i < videoUrls.length; i++) {
      const url = videoUrls[i];
      if (!url) { transcripts.push(''); continue; }

      try {
        console.log(`[Transcribe] Processing video ${i + 1}:`, url);

        // ── Try Cloudinary audio-only transformation first ─────────────────
        // Extract audio as mp3 — much smaller than full video webm
        // Cloudinary URL format: /upload/... → /upload/f_mp3,q_auto/...
        let fetchUrl = url;
        if (url.includes('cloudinary.com')) {
          fetchUrl = url
            .replace('/upload/', '/upload/f_mp3,q_auto:eco/')
            .replace(/\.(webm|mp4|mov)$/i, '.mp3');
          console.log(`[Transcribe] Using audio-only URL: ${fetchUrl}`);
        }

        // Fetch with timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25000);

        let videoRes = await fetch(fetchUrl, { signal: controller.signal });
        clearTimeout(timeout);

        // If audio extraction URL failed, fall back to original
        if (!videoRes.ok && fetchUrl !== url) {
          console.warn(`[Transcribe] Audio URL failed (${videoRes.status}), trying original`);
          const controller2 = new AbortController();
          const timeout2 = setTimeout(() => controller2.abort(), 25000);
          videoRes = await fetch(url, { signal: controller2.signal });
          clearTimeout(timeout2);
        }

        if (!videoRes.ok) {
          console.warn(`[Transcribe] Could not fetch video ${i + 1}: ${videoRes.status}`);
          transcripts.push('');
          continue;
        }

        // ── Check file size before sending to Groq ─────────────────────────
        const contentLength = videoRes.headers.get('content-length');
        const fileSize = contentLength ? parseInt(contentLength) : 0;
        console.log(`[Transcribe] Video ${i + 1} size: ${Math.round(fileSize / 1024)}KB`);

        if (fileSize > GROQ_WHISPER_LIMIT_BYTES) {
          console.warn(`[Transcribe] Video ${i + 1} too large (${Math.round(fileSize / 1024 / 1024)}MB), skipping`);
          transcripts.push('');
          continue;
        }

        const videoBuffer = Buffer.from(await videoRes.arrayBuffer());

        // Determine media type
        const isMP3 = fetchUrl.endsWith('.mp3');
        const mediaType = isMP3 ? 'audio/mpeg' : 'audio/webm';
        const fileName  = isMP3 ? `answer_${i + 1}.mp3` : `answer_${i + 1}.webm`;

        // ── Send to Groq Whisper ───────────────────────────────────────────
        const formData = new FormData();
        formData.append('file', new Blob([videoBuffer], { type: mediaType }), fileName);
        formData.append('model', 'whisper-large-v3');
        formData.append('response_format', 'text');
        formData.append('language', 'en');
        formData.append('temperature', '0');

        console.log(`[Transcribe] Sending to Groq Whisper: ${fileName} (${Math.round(videoBuffer.length / 1024)}KB)`);

        const groqController = new AbortController();
        const groqTimeout = setTimeout(() => groqController.abort(), 40000);

        const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
          body: formData,
          signal: groqController.signal,
        });
        clearTimeout(groqTimeout);

        if (!groqRes.ok) {
          const errText = await groqRes.text();
          console.warn(`[Transcribe] Groq Whisper error for video ${i + 1} (${groqRes.status}):`, errText.substring(0, 300));
          transcripts.push('');
          continue;
        }

        const text = (await groqRes.text()).trim();
        console.log(`[Transcribe] ✓ Q${i + 1} transcript (${text.length} chars):`, text.substring(0, 150));
        transcripts.push(text);

      } catch (err: any) {
        if (err.name === 'AbortError') {
          console.warn(`[Transcribe] Timeout for video ${i + 1}`);
        } else {
          console.warn(`[Transcribe] Error for video ${i + 1}:`, err.message);
        }
        transcripts.push('');
      }
    }

    console.log('[Transcribe] Done. Results:', transcripts.map((t, i) =>
      `Q${i + 1}: ${t ? `${t.length} chars` : 'EMPTY'}`
    ));

    return NextResponse.json({ transcripts });

  } catch (err: any) {
    console.error('[Transcribe] Fatal error:', err.message);
    return NextResponse.json({ transcripts: [] });
  }
}