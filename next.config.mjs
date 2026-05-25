/** @type {import('next').NextConfig} */
const nextConfig = {
  // ...your existing config...
  serverExternalPackages: ['pdf-parse'],  // ← change pdfjs-dist to pdf-parse
};

export default nextConfig;