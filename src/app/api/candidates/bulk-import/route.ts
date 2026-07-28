/**
 * NEW FILE — /api/candidates/bulk-import
 * Does not modify any existing API route.
 *
 * Accepts a multipart/form-data POST with:
 *   - files: one .zip, OR multiple .pdf/.doc/.docx files
 *   - jobRequisitionId (optional)
 *   - createdBy (uploader id/email)
 *
 * Streams newline-delimited JSON ("NDJSON") progress events back to the
 * client so the import page can render a real-time progress bar without
 * needing websockets. Each line is one JSON object; the frontend reads
 * the response body as a stream and JSON.parses each line as it arrives.
 *
 * Event shapes:
 *   { type: "start", total: number }
 *   { type: "progress", processed: number, total: number, fileName: string, result: ImportedCandidateResult }
 *   { type: "done", summary: {...} }
 */

import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import { processSingleResume, type ImportedCandidateResult } from '@/services/bulkImportService';

export const runtime = 'nodejs';

const SUPPORTED_RESUME_EXTENSIONS = ['.pdf', '.doc', '.docx'];

function isSupportedResumeFile(fileName: string): boolean {
    const lower = fileName.toLowerCase();
    return SUPPORTED_RESUME_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/** Expands the uploaded files into a flat list of { fileName, buffer } resume entries. */
async function collectResumeFiles(
    formFiles: File[]
): Promise<{ fileName: string; buffer: Buffer }[]> {
    const collected: { fileName: string; buffer: Buffer }[] = [];

    for (const file of formFiles) {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (file.name.toLowerCase().endsWith('.zip')) {
            const zip = await JSZip.loadAsync(buffer);
            const entries = Object.values(zip.files).filter(
                entry => !entry.dir && isSupportedResumeFile(entry.name)
            );
            for (const entry of entries) {
                const entryBuffer = await entry.async('nodebuffer');
                // Use just the base name, ignoring any folder structure inside the zip
                const baseName = entry.name.split('/').pop() || entry.name;
                collected.push({ fileName: baseName, buffer: entryBuffer });
            }
        } else if (isSupportedResumeFile(file.name)) {
            collected.push({ fileName: file.name, buffer });
        }
        // Unsupported top-level file types are silently skipped here; the
        // frontend already restricts what can be selected/dropped.
    }

    return collected;
}

export async function POST(req: NextRequest) {
    const formData = await req.formData();
    const jobRequisitionId = (formData.get('jobRequisitionId') as string) || undefined;
    const createdBy = (formData.get('createdBy') as string) || 'bulk-import';

    const formFiles = formData.getAll('files').filter((f): f is File => f instanceof File);

    const resumeFiles = await collectResumeFiles(formFiles);
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            const send = (obj: unknown) => {
                controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
            };

            send({ type: 'start', total: resumeFiles.length });

            const results: ImportedCandidateResult[] = [];

            for (let i = 0; i < resumeFiles.length; i++) {
                const { fileName, buffer } = resumeFiles[i];
                let result: ImportedCandidateResult;

                try {
                    result = await processSingleResume(buffer, fileName, {
                        jobRequisitionId,
                        createdBy,
                    });
                } catch (err) {
                    // A single bad resume never stops the batch.
                    result = {
                        fileName,
                        status: 'failed',
                        reason: err instanceof Error ? err.message : 'Unreadable file',
                        history: [],
                    };
                }

                results.push(result);
                send({
                    type: 'progress',
                    processed: i + 1,
                    total: resumeFiles.length,
                    fileName,
                    result,
                });
            }

            const accepted = results.filter(r => r.status === 'accepted');
            const rejected = results.filter(r => r.status === 'rejected');
            const pending = results.filter(r => r.status === 'pending');
            const failed = results.filter(r => r.status === 'failed');
            const scored = results.filter(r => typeof r.atsScore === 'number');
const averageAts = scored.length
    ? Math.round(scored.reduce((sum, r) => sum + (r.atsScore || 0), 0) / scored.length)
    : 0;

send({
    type: 'done',
    summary: {
        total: resumeFiles.length,
        accepted: accepted.length,
        rejected: rejected.length,
        pendingReview: pending.length,
        failed: failed.length,
        averageAts,
        readyForScreening: accepted.length,
    },
    results,
});

            controller.close();
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        },
    });
}