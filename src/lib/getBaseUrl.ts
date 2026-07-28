// lib/getBaseUrl.ts
export function getBaseUrl(): string {
    // 1. Explicit override — use this if you want links to always point to a
    //    fixed custom domain regardless of which deployment served the request.
    if (process.env.NEXT_PUBLIC_APP_URL) {
      return process.env.NEXT_PUBLIC_APP_URL;
    }
  
    // 2. Client-side (browser): window.location.origin always reflects the
    //    actual domain currently serving the page — correct for prod, preview,
    //    and local dev with zero extra config.
    if (typeof window !== 'undefined') {
      return window.location.origin;
    }
  
    // 3. Server-side on Vercel: VERCEL_URL is auto-injected for every
    //    deployment (production AND preview) with that deployment's real URL.
    if (process.env.VERCEL_URL) {
      return `https://${process.env.VERCEL_URL}`;
    }
  
    // 4. Local server-side fallback (e.g. `next dev`, API routes run outside
    //    the browser, no Vercel env present).
    return 'http://localhost:3000';
  }