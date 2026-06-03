'use client';
// app/interview/[token]/InterviewClient.tsx

import { useState, useRef, useEffect, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { useMediaPipeAnalysis } from '@/hooks/useMediaPipeAnalysis';
import { useSoloWindow } from '@/hooks/useSoloWindow';
import { extractFramesFromBlob } from '@/utils/extractVideoFrames';
let _sessionEnded = false;

// ─── TYPES ────────────────────────────────────────────────────────────────────
interface CandidateInfo {
  token: string;
  docId: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  jobRole: string;
  experience: string;
  location: string;
  interviewerName: string;
  stage: string;
  resumeText: string;
  jobDescription: string;
  linkSentAt: string | number;
  

  interviewMode?: 'ai' | 'manual';
  projectQuestions?: Array<{
    type: 'theory' | 'coding';
    text: string;
    languages?: string[];
    timerMinutes?: number;
  }>;
}

interface InterviewClientProps {
  candidate: CandidateInfo;
}

type Stage =
  | 'landing'
  | 'mic_camera'
  | 'interview'
  | 'submitting'
  | 'completed';

interface Question {
  id: number;
  text: string;
  recorded: boolean;
  blob: Blob | null;
  timerSeconds?: number;
  type?: 'theory' | 'coding';          // ← ADD
  languages?: string[]; 
}

// ─── COUNTDOWN HOOK ───────────────────────────────────────────────────────────
function use48HrCountdown(linkSentAt: string | number) {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    const sentMs =
      typeof linkSentAt === 'string'
        ? new Date(linkSentAt).getTime()
        : Number(linkSentAt);

    const expiryMs = sentMs + (48 * 60 * 60 * 1000);

    const update = () => {
      const remaining = Math.max(0, Math.floor((expiryMs - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0) setIsExpired(true);
    };

    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [linkSentAt]);

  const hours   = Math.floor(secondsLeft / 3600);
  const minutes = Math.floor((secondsLeft % 3600) / 60);
  const seconds = secondsLeft % 60;

  const sentDate = new Date(
    typeof linkSentAt === 'string' ? linkSentAt : Number(linkSentAt)
  );

  const sentLabel = sentDate.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  const pctElapsed = Math.min(1, 1 - (secondsLeft / (48 * 60 * 60)));

  return { hours, minutes, seconds, isExpired, sentLabel, pctElapsed, secondsLeft };
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function InterviewClient({ candidate }: InterviewClientProps) {
  useSoloWindow();

  // ── Core state ──────────────────────────────────────────────────────────────
  const [stage,             setStage]             = useState<Stage>('landing');
  const [nameInput,         setNameInput]         = useState('');
  const [nameError,         setNameError]         = useState('');
  const [sessionExpired,    setSessionExpired]    = useState(false);
  const [expiredReason,     setExpiredReason]     = useState('');
  const [questions,         setQuestions]         = useState<Question[]>([]);
  const [currentQIdx,       setCurrentQIdx]       = useState(0);
  const [isLoadingQ,        setIsLoadingQ]        = useState(false);
  const [isRecording,       setIsRecording]       = useState(false);
  const [recordingSeconds,  setRecordingSeconds]  = useState(0);
  const [isSubmitting,      setIsSubmitting]      = useState(false);
  const [submitStep,        setSubmitStep]        = useState('');
  const [finalScore,        setFinalScore]        = useState<number | null>(null);
  const [uploadedVideoUrls, setUploadedVideoUrls] = useState<string[]>([]);
  const [submittedAt,       setSubmittedAt]       = useState<string>('');
  const [codeAnswer,        setCodeAnswer]        = useState('');
  const [timings,           setTimings]           = useState<number[]>([]);
  const [questionRevealed,  setQuestionRevealed]  = useState(false);
  const [resendLoading,     setResendLoading]     = useState(false);
  const [resendDone,        setResendDone]        = useState(false);
  const [resendError,       setResendError]       = useState('');

  const NORMAL_Q_LIMIT = 90;
  const CODING_Q_LIMIT = 300;

  const isCodingQuestion = (text: string, qType?: string) =>
    qType === 'coding' || /\bwrite\b|\bimplement\b|\bpseudocode\b/i.test(text);

  const getTimeLimit = (qText: string, timerSeconds?: number) => {
    if (timerSeconds && timerSeconds > 0) return timerSeconds;
    return isCodingQuestion(qText) ? CODING_Q_LIMIT : NORMAL_Q_LIMIT;
  };

  const [timeLeft,    setTimeLeft]    = useState<number>(NORMAL_Q_LIMIT);
  const [timerActive, setTimerActive] = useState(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── FIX 1: Changed from string[] array to Record<number,string> object ──────
  // Array had sparse-index gaps causing undefined reads.
  // Record<number,string> gives explicit key access with no gaps.
  const speechTranscriptRef = useRef<Record<number, string>>({});

  const recognitionRef    = useRef<any>(null);
  const interimTranscriptRef = useRef<Record<number, string>>({});
  // FIX 1 continued: Two new refs to control auto-restart and track current Q
  const recActiveRef      = useRef<boolean>(false);  // stops the restart loop
  const recQIdxRef        = useRef<number>(0);       // always current question index

  const questionStartTimeRef = useRef<number>(Date.now());

  // ── 48-hr countdown ─────────────────────────────────────────────────────────
  const { hours, minutes, seconds, isExpired, sentLabel, pctElapsed, secondsLeft } =
    use48HrCountdown(candidate.linkSentAt);

  // ── Resend link ──────────────────────────────────────────────────────────────
  const handleResendLink = async () => {
    setResendLoading(true);
    setResendError('');
    try {
      const res = await fetch('/api/interview/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token:          candidate.token,
          candidateId:    candidate.candidateId,
          candidateEmail: candidate.candidateEmail,
          candidateName:  candidate.candidateName,
          jobRole:        candidate.jobRole,
        }),
      });
      if (!res.ok) throw new Error('Failed');
      setResendDone(true);
    } catch {
      setResendError('Could not send the link. Please contact HR directly.');
    } finally {
      setResendLoading(false);
    }
  };
  // ── End Session handler ──────────────────────────────────────────────────────
  const handleEndSession = async () => {
  if (sessionLockRef.current) return;
  sessionLockRef.current = true;
  _sessionEnded = true;

  if (countdownRef.current) clearInterval(countdownRef.current);
  if (recTimerRef.current) clearInterval(recTimerRef.current);

  try {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  } catch (_) {}

  stopAllMedia();
  stopSpeechRecognition();

  // ── Direct Firestore write ──────────────────────────────────────────
  try {
    const { db } = await import('@/lib/firebase');
    const { doc, updateDoc, collection, query, where, getDocs, Timestamp } = await import('firebase/firestore');

    console.log('[EndSession] Searching for token:', candidate.token);

    const q = query(
      collection(db, 'ai_interviews'),
      where('token', '==', candidate.token)
    );
    const snap = await getDocs(q);

    console.log('[EndSession] Docs found:', snap.size);

    if (!snap.empty) {
      const interviewDoc = snap.docs[0];
      const data = interviewDoc.data();
      console.log('[EndSession] Doc data:', data);
      const candidateId = data.candidateId;

      await updateDoc(interviewDoc.ref, {
        status:        'expired',
        expiredReason: 'candidate_ended',
        expiredAt:     Timestamp.now(),
      });
      console.log('[EndSession] ✅ ai_interviews updated');

      if (candidateId) {
        await updateDoc(doc(db, 'candidates', candidateId), {
          l1Status:          'Expired',
          l1AIStatus:        'expired',
          l1AIExpiredAt:     Timestamp.now(),
          l1AIExpiredReason: 'candidate_ended',
        });
        console.log('[EndSession] ✅ candidates updated:', candidateId);
      } else {
        console.error('[EndSession] ❌ No candidateId in doc!');
      }
    } else {
      console.error('[EndSession] ❌ No doc found for token:', candidate.token);
      // Token not found — try API as absolute fallback
      const payload = JSON.stringify({ token: candidate.token, reason: 'candidate_ended' });
      navigator.sendBeacon('/api/interview/expire', new Blob([payload], { type: 'application/json' }));
    }
  } catch (err) {
    console.error('[EndSession] ❌ Firestore write error:', err);
    // API fallback
    const payload = JSON.stringify({ token: candidate.token, reason: 'candidate_ended' });
    try { navigator.sendBeacon('/api/interview/expire', new Blob([payload], { type: 'application/json' })); } catch (_) {}
  }

  setExpiredReason('candidate_ended');
  setSessionExpired(true);
};
  // ── FIX 2: Complete rewrite of startSpeechRecognition ───────────────────────
  // OLD: Created one instance, no restart on stop/error → Q2-Q5 got nothing
  //      because webkitSpeechRecognition auto-stops after ~7s silence.
  // NEW: Auto-restart loop via onend + onerror. Uses recQIdxRef (not closure
  //      value of currentQIdx) so all speech goes to the correct question slot.
  const startSpeechRecognition = (qIdx: number) => {
    // Stop any existing session cleanly first
    recActiveRef.current = false;
    try { recognitionRef.current?.stop(); } catch (_) {}
    recognitionRef.current = null;

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      console.warn('[Speech] SpeechRecognition not supported');
      return;
    }

    // Ensure slot exists
    if (speechTranscriptRef.current[qIdx] === undefined) {
      speechTranscriptRef.current[qIdx] = '';
    }

    recQIdxRef.current   = qIdx;
    recActiveRef.current = true;

    const createAndStart = () => {
      if (!recActiveRef.current) return;

      const rec = new SR();
      rec.continuous      = true;
      rec.interimResults  = false;
      rec.lang            = 'en-US';
      rec.maxAlternatives = 1;

      rec.onresult = (e: any) => {
        const idx = recQIdxRef.current;
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const word = e.results[i][0].transcript;
          if (e.results[i].isFinal) {
            speechTranscriptRef.current[idx] =
              (speechTranscriptRef.current[idx] || '') + word + ' ';
            // Clear interim for this slot once we have a final result
            interimTranscriptRef.current[idx] = '';
          } else {
            // Keep latest interim — will be flushed on stop
            interimTranscriptRef.current[idx] = word;
          }
        }
      };

      rec.onerror = (e: any) => {
        console.warn('[Speech] Error:', e.error);
        // no-speech / network are transient — restart after short delay
        if (recActiveRef.current && (
          e.error === 'no-speech' ||
          e.error === 'network'   ||
          e.error === 'audio-capture'
        )) {
          setTimeout(createAndStart, 400);
        }
      };

      // onend fires when browser auto-stops (silence timeout, etc.)
      // Restart immediately so we never miss speech between natural pauses
      rec.onend = () => {
        if (recActiveRef.current) {
          setTimeout(createAndStart, 150);
        }
      };

      try {
        rec.start();
        recognitionRef.current = rec;
        console.log(`[Speech] Started for Q${qIdx + 1}`);
      } catch (err) {
        console.warn('[Speech] start() threw:', err);
        if (recActiveRef.current) setTimeout(createAndStart, 500);
      }
    };

    createAndStart();
  };

  // ── FIX 3: Complete rewrite of stopSpeechRecognition ────────────────────────
  // OLD: Immediately stopped recognition — last onresult hadn't fired yet,
  //      so the last sentence of every answer was lost.
  // NEW: Sets recActiveRef=false FIRST (stops restart loop), then stops.
  //      The 600ms delay in stopRecording (FIX 4) ensures the final
  //      onresult has already fired before this runs.
  const stopSpeechRecognition = () => {
    recActiveRef.current = false; // kill restart loop before calling stop()
      // Flush any pending interim transcript before stopping
  Object.entries(interimTranscriptRef.current).forEach(([k, v]) => {
    const idx = Number(k);
    if (v && v.trim()) {
      speechTranscriptRef.current[idx] =
        (speechTranscriptRef.current[idx] || '') + v.trim() + ' ';
    }
  });
  interimTranscriptRef.current = {};
    try { recognitionRef.current?.stop(); } catch (_) {}
    recognitionRef.current = null;
    console.log(
      '[Speech] Stopped. Transcripts:',
      Object.entries(speechTranscriptRef.current).map(
        ([k, v]) => `Q${Number(k) + 1}: "${String(v).substring(0, 60)}"`
      )
    );
  };

  const detectLanguage = (role: string): string => {
    if (/python|django|flask|ml|data|ai|automat|selenium|playwright/i.test(role)) return 'python';
    if (/java(?!script)|spring|android/i.test(role)) return 'java';
    if (/c#|\.net|dotnet|unity/i.test(role)) return 'csharp';
    if (/php|laravel/i.test(role)) return 'php';
    if (/ruby|rails/i.test(role)) return 'ruby';
    if (/go\b|golang/i.test(role)) return 'go';
    if (/sql|database|postgres|mysql/i.test(role)) return 'sql';
    return 'javascript';
  };
  const [codeLanguage, setCodeLanguage] = useState(() => detectLanguage(candidate.jobRole));

  const { startCapture, stopCapture } = useMediaPipeAnalysis();
  const mediaPipeResultRef  = useRef<any>(null);
  const mediaPipeStartedRef = useRef(false);

  const [micLevel,       setMicLevel]       = useState(0);
  const [micOk,          setMicOk]          = useState(false);
  const [cameraOk,       setCameraOk]       = useState(false);
  const [cameraWarning,  setCameraWarning]  = useState('');
  const [checkingCamera, setCheckingCamera] = useState(false);
  const [permError,      setPermError]      = useState('');
  const [interviewCameraError, setInterviewCameraError] = useState('');
  const [windowHiddenWarning,  setWindowHiddenWarning]  = useState(false);

  const videoRef          = useRef<HTMLVideoElement>(null);
  const canvasRef         = useRef<HTMLCanvasElement>(null);
  const streamRef         = useRef<MediaStream | null>(null);
  const recorderRef       = useRef<MediaRecorder | null>(null);
  const chunksRef         = useRef<Blob[]>([]);
  const sessionLockRef    = useRef(false);
  const micAnalyserRef    = useRef<AnalyserNode | null>(null);
  const micAnimFrameRef   = useRef<number | null>(null);
  const cameraIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recTimerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasInteractionRef = useRef(false);

  useEffect(() => {
    if (isExpired && (stage === 'landing' || stage === 'mic_camera')) {}
  }, [isExpired, stage]);

  useEffect(() => {
    if (stage === 'interview' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [stage]);

  useEffect(() => {
    if (stage !== 'interview') {
      mediaPipeStartedRef.current = false;
      return;
    }
    if (mediaPipeStartedRef.current) return;

    const tryStart = async () => {
      const video = videoRef.current;
      if (!video) return;
      if (!video.srcObject && streamRef.current) {
        video.srcObject = streamRef.current;
        try { await video.play(); } catch (_) {}
      }
      let attempts = 0;
      while ((video.readyState < 2 || video.videoWidth === 0) && attempts < 30) {
        await new Promise(r => setTimeout(r, 300));
        attempts++;
      }
      if (video.readyState >= 2 && video.videoWidth > 0) {
        mediaPipeStartedRef.current = true;
        startCapture(video);
      }
    };

    tryStart();
  }, [stage, startCapture]);

  useEffect(() => {
    setQuestionRevealed(false);
  }, [currentQIdx]);

  useEffect(() => {
    if (stage !== 'interview' || !hasInteractionRef.current) return;

    const expireSession = async (reason: string) => {
      if (sessionLockRef.current) return;
      sessionLockRef.current = true;
    
      // Stop recorder and get last blob
      let lastBlob: Blob | null = null;
      try {
        const recorder = recorderRef.current;
        if (recorder && recorder.state !== 'inactive') {
          lastBlob = await new Promise<Blob>((resolve) => {
            recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: 'video/webm' }));
            recorder.stop();
          });
        }
      } catch (_) {}
      streamRef.current?.getTracks().forEach(t => t.stop());
    
      // ── Write directly to Firestore ───────────────────────────────────
      try {
        const { db } = await import('@/lib/firebase');
        const { doc, updateDoc, collection, query, where, getDocs, Timestamp } = await import('firebase/firestore');
    
        const q = query(
          collection(db, 'ai_interviews'),
          where('token', '==', candidate.token)
        );
        const snap = await getDocs(q);
    
        if (!snap.empty) {
          const interviewDoc = snap.docs[0];
          const candidateId = interviewDoc.data().candidateId;
    
          await updateDoc(interviewDoc.ref, {
            status:        'expired',
            expiredReason: reason,
            expiredAt:     Timestamp.now(),
          });
    
          if (candidateId) {
            await updateDoc(doc(db, 'candidates', candidateId), {
              l1Status:          'Expired',
              l1AIStatus:        'expired',
              l1AIExpiredAt:     Timestamp.now(),
              l1AIExpiredReason: reason,
            });
          }
    
          console.log('[expireSession] ✅ Firestore updated:', reason);
        }
      } catch (err) {
        console.error('[expireSession] Direct write failed, trying API:', err);
        
        // Fallback to API
        const expirePayload = JSON.stringify({ token: candidate.token, reason });
        try {
          const blob = new Blob([expirePayload], { type: 'application/json' });
          navigator.sendBeacon('/api/interview/expire', blob);
        } catch (_) {}
        try {
          await fetch('/api/interview/expire', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: expirePayload,
            keepalive: true,
          });
        } catch (_) {}
      }
    
      setExpiredReason(reason);
      setSessionExpired(true);
    };
    const onHide = () => { if (document.hidden) expireSession('tab_switch'); };
    const blurTimerRef = { current: null as ReturnType<typeof setTimeout> | null };
    const onWindowBlur = () => {
      if (stage === 'interview' && !sessionLockRef.current) {
        setWindowHiddenWarning(true);
        blurTimerRef.current = setTimeout(() => { expireSession('app_switch'); }, 10000);
      }
    };
    const onWindowFocus = () => {
      if (blurTimerRef.current) { clearTimeout(blurTimerRef.current); blurTimerRef.current = null; }
      setWindowHiddenWarning(false);
    };
    
const onUnload = (e: BeforeUnloadEvent) => {
  if (sessionLockRef.current || _sessionEnded) return;
 
  const payload = JSON.stringify({ token: candidate.token, reason: 'closed' });
 
  // Method 1: sendBeacon (most reliable for page close)
  try {
    navigator.sendBeacon(
      '/api/interview/expire',
      new Blob([payload], { type: 'application/json' })
    );
  } catch (_) {}
 
  // Method 2: fetch with keepalive as backup
  try {
    fetch('/api/interview/expire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,  // ← this survives page unload
    });
  } catch (_) {}
};
 
    const blockContext = (e: MouseEvent) => { if (stage === 'interview') e.preventDefault(); };

    document.addEventListener('visibilitychange', onHide);
  const blurArmTimer = setTimeout(() => {
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('focus', onWindowFocus);
}, 2000);
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('contextmenu', blockContext);

    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('focus', onWindowFocus);
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('contextmenu', blockContext);
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    };
  }, [stage, candidate.token]);

  useEffect(() => { return () => { stopAllMedia(); }; }, []);

  const handleStartClick = async () => {
    if (isExpired) return;
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed.length < 2) { setNameError('Please enter your name to continue.'); return; }
    setNameError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' }, audio: true,
      });
      streamRef.current = stream;
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = stream; }, 100);
      setStage('mic_camera');
      startMicMonitor(stream);
      startCameraCheck();
    } catch (err: any) {
      setPermError(
        err.name === 'NotAllowedError'
          ? '❌ Camera and microphone access was denied. Please allow access in your browser settings.'
          : '❌ Could not access your camera or microphone. Please check your device.',
      );
    }
  };

  const startMicMonitor = (stream: MediaStream) => {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx      = new AudioContext();
    const source   = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    micAnalyserRef.current = analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg   = data.reduce((a, b) => a + b, 0) / data.length;
      const level = Math.min(100, Math.round(avg * 3));
      setMicLevel(level);
      if (level > 5) setMicOk(true);
      micAnimFrameRef.current = requestAnimationFrame(tick);
    };
    micAnimFrameRef.current = requestAnimationFrame(tick);
  };

  const stopMicMonitor = () => {
    if (micAnimFrameRef.current) cancelAnimationFrame(micAnimFrameRef.current);
  };

  const currentQIdxRef = useRef(currentQIdx);
  const questionsRef   = useRef(questions);
  useEffect(() => { currentQIdxRef.current = currentQIdx; }, [currentQIdx]);
  useEffect(() => { questionsRef.current   = questions;   }, [questions]);

  const stopCountdown = () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = null;
    setTimerActive(false);
  };

  const autoStopOnTimeout = async () => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    setTimerActive(false);
    const qIdx   = currentQIdxRef.current;
    const allQs  = questionsRef.current;
    const isLast = qIdx === allQs.length - 1;
    clearInterval(recTimerRef.current!);
    setIsRecording(false);
    const elapsed = Math.round((Date.now() - questionStartTimeRef.current) / 1000);
    setTimings(prev => [...prev, elapsed]);

    // FIX: wait 600ms before stopping speech so last onresult can fire
    await new Promise(r => setTimeout(r, 600));
    stopSpeechRecognition();

    const recorder = recorderRef.current;
    let blob: Blob;
    if (!recorder || recorder.state === 'inactive') {
      blob = new Blob(chunksRef.current, { type: 'video/webm' });
    } else {
      blob = await new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: 'video/webm' }));
        recorder.stop();
      });
    }
    setQuestions(prev => prev.map((q, i) => i === qIdx ? { ...q, recorded: true, blob } : q));
    if (!isLast) {
      setCurrentQIdx(qIdx + 1);
      setRecordingSeconds(0);
      setQuestionRevealed(false);
      chunksRef.current   = [];
      recorderRef.current = null;
    }
  };

  const startCountdown = (qText: string, timerSeconds?: number) => {
    const limit = getTimeLimit(qText, timerSeconds);
    setTimeLeft(limit);
    setTimerActive(true);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(countdownRef.current!); setTimerActive(false); autoStopOnTimeout(); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const faceDetectorRef          = useRef<any>(null);
  const faceDetectorSupportedRef = useRef<boolean | null>(null);

  const initFaceDetector = () => {
    if (faceDetectorSupportedRef.current !== null) return;
    if (typeof window !== 'undefined' && 'FaceDetector' in window) {
      try {
        faceDetectorRef.current = new (window as any).FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
        faceDetectorSupportedRef.current = true;
      } catch { faceDetectorSupportedRef.current = false; }
    } else { faceDetectorSupportedRef.current = false; }
  };

  const checkFaceByPixels = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): string => {
    const w = canvas.width, h = canvas.height;
    const imageData = ctx.getImageData(0, 0, w, h);
    const pixels    = imageData.data;
    let totalBrightness = 0, pixelCount = 0;
    const brightnessValues: number[] = [];
    const cx1 = Math.floor(w * 0.25), cx2 = Math.floor(w * 0.75);
    const cy1 = Math.floor(h * 0.15), cy2 = Math.floor(h * 0.85);
    let centreSkinPixels = 0, centrePixelCount = 0, edgeSkinPixels = 0, edgePixelCount = 0;
    for (let y = 0; y < h; y += 4) {
      for (let x = 0; x < w; x += 4) {
        const i          = (y * w + x) * 4;
        const r          = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        const brightness = (r + g + b) / 3;
        totalBrightness += brightness;
        brightnessValues.push(brightness);
        pixelCount++;
        const isSkin   = r > 70 && g > 45 && b > 20 && r > g && r > b && r - g > 12 && r - b > 15 && brightness > 50 && brightness < 230;
        const inCentre = x >= cx1 && x <= cx2 && y >= cy1 && y <= cy2;
        if (inCentre) { centrePixelCount++; if (isSkin) centreSkinPixels++; }
        else          { edgePixelCount++;   if (isSkin) edgeSkinPixels++;   }
      }
    }
    const avg        = totalBrightness / pixelCount;
    const variance   = brightnessValues.reduce((a, v) => a + Math.pow(v - avg, 2), 0) / pixelCount;
    const centreSkin = centrePixelCount > 0 ? centreSkinPixels / centrePixelCount : 0;
    const edgeSkin   = edgePixelCount   > 0 ? edgeSkinPixels   / edgePixelCount   : 0;
    if (avg < 25)       return 'Too dark — move to a brighter area or turn on a light';
    if (avg > 240)      return 'Too bright — avoid direct light behind or in front of you';
    if (variance < 100) return 'Camera appears blocked — adjust your position';
    if (centreSkin < 0.06 || (centreSkin - edgeSkin) < 0.03)
      return 'No face detected — please look directly at the camera';
    return '';
  };

  const checkCameraFrame = async (interviewMode = false) => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    if (!interviewMode) setCheckingCamera(false);
    let warning = '';
    initFaceDetector();
    if (faceDetectorSupportedRef.current && faceDetectorRef.current) {
      try {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixels    = imageData.data;
        let totalBrightness = 0, count = 0;
        for (let i = 0; i < pixels.length; i += 40) { totalBrightness += (pixels[i] + pixels[i+1] + pixels[i+2]) / 3; count++; }
        const avg = totalBrightness / count;
        if (avg < 25)       warning = 'Too dark — move to a brighter area or turn on a light';
        else if (avg > 240) warning = 'Too bright — avoid direct light behind or in front of you';
        else {
          const faces = await faceDetectorRef.current.detect(video);
          if (!faces || faces.length === 0) warning = 'No face detected — please look directly at the camera';
        }
      } catch { warning = checkFaceByPixels(canvas, ctx); }
    } else { warning = checkFaceByPixels(canvas, ctx); }
    if (interviewMode) setInterviewCameraError(warning);
    else { setCameraWarning(warning); setCameraOk(warning === ''); }
  };

  const startCameraCheck = (interviewMode = false) => {
    if (!interviewMode) setCheckingCamera(true);
    cameraIntervalRef.current = setInterval(() => checkCameraFrame(interviewMode), interviewMode ? 3000 : 1500);
  };

  const stopCameraCheck = () => { if (cameraIntervalRef.current) clearInterval(cameraIntervalRef.current); };

  const handleBeginInterview = async () => {
    if (!micOk || !cameraOk) return;
    setIsLoadingQ(true);
    stopMicMonitor();
    stopCameraCheck();
  
    await fetch('/api/interview/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: candidate.token }),
    });
  
    let qs: Question[];
  
    // ── MANUAL MODE: use project questions directly ──────────────────────────
    if (
      candidate.interviewMode === 'manual' &&
      candidate.projectQuestions &&
      candidate.projectQuestions.length > 0
    ) {
      qs = candidate.projectQuestions.map((q, i) => ({
        id: i,
        text: q.text,
        recorded: false,
        blob: null,
        timerSeconds: q.timerMinutes ? q.timerMinutes * 60 : undefined,
        type:      q.type,                    // ← ADD
        languages: q.languages,   
      }));
    } else {
      // ── AI MODE: fetch generated questions ─────────────────────────────────
      const res = await fetch('/api/interview/questions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobRole:        candidate.jobRole,
          experience:     candidate.experience,
          candidateName:  candidate.candidateName,
          resumeText:     candidate.resumeText,
          jobDescription: candidate.jobDescription,
        }),
      });
      const data = await res.json();
      qs = (data.questions as string[]).map((text, i) => ({
        id: i, text, recorded: false, blob: null,
      }));
    }
  
    // Pre-initialise all transcript slots
    const slots: Record<number, string> = {};
    qs.forEach((_, i) => { slots[i] = ''; });
    speechTranscriptRef.current = slots;
  
    setQuestions(qs);
    setCurrentQIdx(0);
    setIsLoadingQ(false);
    if (streamRef.current) startMicMonitor(streamRef.current);
    startCameraCheck(true);
    hasInteractionRef.current = true;
    setStage('interview');
  };

  const startRecording = () => {
    setQuestionRevealed(true);
    questionStartTimeRef.current = Date.now();
  
    // Single declaration — used for both language pre-select and countdown
    const currentQ = questionsRef.current[currentQIdxRef.current];
  
    // ── Pre-select language for coding questions ──────────────────────────────
    if (currentQ?.type === 'coding' && currentQ?.languages?.length) {
      const langMap: Record<string, string> = {
        'JavaScript': 'javascript', 'TypeScript': 'typescript',
        'Java': 'java', 'Python': 'python', 'C#': 'csharp',
      };
      const mapped = langMap[currentQ.languages[0]] || currentQ.languages[0].toLowerCase();
      setCodeLanguage(mapped);
    }
  
    if (!streamRef.current) return;
    if (videoRef.current && !videoRef.current.srcObject) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
    chunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : 'video/webm';
    const recorder = new MediaRecorder(streamRef.current, {
      mimeType,
      videoBitsPerSecond: 500_000,
      audioBitsPerSecond: 64_000,
    });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.start(500);
    recorderRef.current = recorder;
    setIsRecording(true);
    setRecordingSeconds(0);
    recTimerRef.current = setInterval(() => setRecordingSeconds(prev => prev + 1), 1000);
    startCountdown(currentQ?.text || '', currentQ?.timerSeconds);
    startSpeechRecognition(currentQIdxRef.current);
  };

  // ── FIX 4: stopRecording waits 600ms before stopping speech ─────────────────
  // OLD: stopSpeechRecognition() called immediately → last onresult hadn't
  //      fired yet → last sentence of every answer was cut off.
  // NEW: 600ms grace period so Speech API can flush its final result first.
  const stopRecording = (): Promise<Blob> => {
    const elapsed = Math.round((Date.now() - questionStartTimeRef.current) / 1000);
    setTimings(prev => [...prev, elapsed]);

    return new Promise((resolve) => {
      clearInterval(recTimerRef.current!);
      setIsRecording(false);
      stopCountdown();

      // Wait for Speech API to fire its final onresult before stopping it
      setTimeout(() => {
        stopSpeechRecognition();

        const recorder = recorderRef.current;
        if (!recorder || recorder.state === 'inactive') {
          resolve(new Blob(chunksRef.current, { type: 'video/webm' }));
          return;
        }
        recorder.requestData();
        setTimeout(() => {
          recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: 'video/webm' }));
          recorder.stop();
        }, 300);
      }, 600);
    });
  };

  const handleStopAndNext = async () => {
    const idx = currentQIdxRef.current; // capture BEFORE any state changes
    const blob = await stopRecording();  // this already waits 600ms + stops speech
    
    questionsRef.current = questionsRef.current.map((q, i) =>
      i === idx ? { ...q, recorded: true, blob } : q
    );
    setQuestions(questionsRef.current);
    
    // Only advance AFTER stopRecording fully resolves (speech already stopped inside it)
    if (idx < questionsRef.current.length - 1) {
      recQIdxRef.current = idx + 1; // update ref explicitly
      setCurrentQIdx(idx + 1);
    }
  };

  const handleStopLastAndShowSubmit = async () => {
    const blob = await stopRecording();
    const idx  = currentQIdxRef.current;
    setQuestions(prev => prev.map((q, i) => i === idx ? { ...q, recorded: true, blob } : q));
  };

  // ── FIX 5: handleSubmit uses correct transcript collection ───────────────────
  // OLD: questions.map((_, i) => speechTranscriptRef.current[i]?.trim() || '')
  //      Used state snapshot `questions` which might not match questionsRef.
  //      Also used optional-chain on array which silently returned undefined.
  // NEW: Uses questionsRef.current length + Record object access.
  const handleSubmit = async (currentQuestions: Question[]) => {
    let lastBlob: Blob | null = null;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      lastBlob = await stopRecording();
    }
    const allQs = questionsRef.current.map((q, i) => {
      if (i === currentQIdxRef.current && lastBlob && !q.recorded)
        return { ...q, recorded: true, blob: lastBlob };
      return q;
    });
    setQuestions(allQs);

    const mediaPipeResult = stopCapture();
    mediaPipeResultRef.current = mediaPipeResult ?? {
      eyeContactScore:   -1,
      bodyLanguageScore: -1,
      faceVisiblePct:    -1,
      suspicionFlags:    [],
      gazeBreakdown:     { center: 0, down: 0, side: 0, absent: 0 },
    };

    setIsSubmitting(true);
    sessionLockRef.current = true;
    stopAllMedia();
    setSubmitStep('Uploading your interview recording...');

    const validBlobs = allQs
      .map((q, i) => ({ blob: q.blob, i }))
      .filter(x => x.blob !== null)
      .sort((a, b) => a.i - b.i)
      .map(x => x.blob as Blob);

    const mergedBlob = new Blob(validBlobs, { type: 'video/webm' });

    setSubmitStep('Analyzing your video...');
    let videoFrames: string[] = [];
    try {
      videoFrames = await extractFramesFromBlob(mergedBlob, 8);
      console.log(`[Submit] Extracted ${videoFrames.length} frames`);
    } catch (err) {
      console.warn('[Submit] Frame extraction failed (non-fatal):', err);
    }

    setSubmitStep('Uploading your interview recording...');
    let singleVideoUrl = '';
    try {
      const formData = new FormData();
      formData.append('video',          mergedBlob, 'full-interview.webm');
      formData.append('token',          candidate.token);
      formData.append('candidateId',    candidate.candidateId);
      formData.append('questionIdx',    '0');
      formData.append('candidateName',  candidate.candidateName);
      formData.append('candidateEmail', candidate.candidateEmail);
      formData.append('questionText',   'Full Interview Recording');
      formData.append('isMerged',       'true');
      formData.append('transcripts',    JSON.stringify(speechTranscriptRef.current)); // ← ADDED
      console.log('[Submit] Transcripts being sent:', speechTranscriptRef.current);   // ← ADDED
      
        const res = await fetch('/api/interview/complete', { method: 'POST', body: formData });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          console.error('[Submit] complete API failed:', res.status, errBody);
          // Don't throw — continue to scoring even if upload fails
        } else {
          const data = await res.json();
          singleVideoUrl = data.videoUrl || '';
          console.log('[Submit] Upload succeeded:', singleVideoUrl);
        }
      } catch (err) {
        console.error('[Submit] complete API threw:', err);
        // Non-fatal — continue to scoring
      }

    const uploadedUrls = allQs.map(() => singleVideoUrl);
    setUploadedVideoUrls(uploadedUrls);

    // FIX 5: Collect transcripts from the Record object using questionsRef length
    const finalTranscripts = allQs.map((_, i) =>
      (speechTranscriptRef.current[i] || '').trim()
    );

    console.log('[Submit] Final transcripts:',
      finalTranscripts.map((t, i) => `Q${i + 1}: "${t.substring(0, 80)}"`)
    );

    setSubmitStep('AI is evaluating your interview...');
    try {
      const scoreRes = await fetch('/api/interview/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token:             candidate.token,
          candidateId:       candidate.candidateId,
          questions:         allQs.map(q => q.text),
          jobRole:           candidate.jobRole,
          videoUrls:         uploadedUrls,
          transcripts:       finalTranscripts,
          codeAnswer,
          codeLanguage,
          timings,
          videoFrames,
          eyeContactScore:   mediaPipeResultRef.current.eyeContactScore,
          bodyLanguageScore: mediaPipeResultRef.current.bodyLanguageScore,
          faceVisiblePct:    mediaPipeResultRef.current.faceVisiblePct,
          suspicionFlags:    mediaPipeResultRef.current.suspicionFlags ?? [],
          gazeBreakdown:     mediaPipeResultRef.current.gazeBreakdown ?? { center: 0, down: 0, side: 0, absent: 0 },
        }),
      });
      const scoreData = await scoreRes.json();
      setFinalScore(scoreData.score);
    } catch (err) {
      console.error('[submit] Score failed:', err);
    }

    setIsSubmitting(false);
    setStage('completed');
  };

  const stopAllMedia = () => {
    stopMicMonitor();
    stopCameraCheck();
    clearInterval(recTimerRef.current!);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const isLastQ = currentQIdx === questions.length - 1;

  // ── Session expired ──────────────────────────────────────────────────────────
// ── Session expired ──────────────────────────────────────────────────────────
if (sessionExpired) {
  const isEndedByCandidate = expiredReason === 'candidate_ended';
  const isTabSwitch = expiredReason === 'tab_switch';
  const isAppSwitch = expiredReason === 'app_switch';

  const config = isEndedByCandidate
    ? {
        icon: '🚪',
        title: 'Interview Session Ended',
        body: 'You ended this interview session early. This link can no longer be used.',
        sub: `Any answers you recorded have been saved. Please contact ${candidate.interviewerName} if you'd like to reschedule.`,
        accentColor: 'linear-gradient(90deg, #F59E0B, #EF4444)',
        iconBg: 'linear-gradient(135deg, #FEF3C7, #FEE2E2)',
        iconBorder: '#FCD34D',
      }
    : isTabSwitch || isAppSwitch
    ? {
        icon: '🔒',
        title: 'Session Terminated',
        body: isAppSwitch
          ? 'Your session ended because you switched to another application.'
          : 'Your session ended because you switched browser tabs.',
        sub: 'For security, this link can no longer be used. Please contact HR to reschedule.',
        accentColor: 'linear-gradient(90deg, #EF4444, #DC2626)',
        iconBg: 'linear-gradient(135deg, #FEE2E2, #FECACA)',
        iconBorder: '#FCA5A5',
      }
    : {
        icon: '⏰',
        title: 'Interview Link Expired',
        body: 'This interview link is no longer valid.',
        sub: 'Please contact HR to request a new link.',
        accentColor: 'linear-gradient(90deg, #EF4444, #F97316)',
        iconBg: 'linear-gradient(135deg, #FEE2E2, #FECACA)',
        iconBorder: '#FCA5A5',
      };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', padding: '2rem', textAlign: 'center' }}>
      <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: '24px', padding: '52px 56px', maxWidth: '500px', width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.07)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: config.accentColor, borderRadius: '24px 24px 0 0' }} />
        <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: config.iconBg, border: `3px solid ${config.iconBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '36px', margin: '0 auto 24px', boxShadow: '0 0 0 12px rgba(239,68,68,0.06)' }}>
          {config.icon}
        </div>
        <h1 style={{ fontSize: '24px', fontWeight: 800, color: '#0F172A', marginBottom: '12px', letterSpacing: '-0.02em' }}>
          {config.title}
        </h1>
        <p style={{ fontSize: '14px', color: '#64748B', lineHeight: 1.8, marginBottom: '12px' }}>
          {config.body}
        </p>
        <p style={{ fontSize: '13px', color: '#94A3B8', marginBottom: '32px', lineHeight: 1.7 }}>
          {config.sub}
        </p>
        <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '16px 20px', fontSize: '13px', color: '#64748B', lineHeight: 1.7 }}>
          <strong style={{ display: 'block', color: '#374151', marginBottom: '4px' }}>📋 Interview details</strong>
          Role: <strong style={{ color: '#0F172A' }}>{candidate.jobRole}</strong>
          {isEndedByCandidate && questions.length > 0 && (
            <><br />{questions.filter(q => q.recorded).length} of {questions.length} questions answered</>
          )}
        </div>
      </div>
    </div>
  );
}
  // ── Link expired ─────────────────────────────────────────────────────────────
  if (isExpired && stage !== 'interview' && stage !== 'completed') {
    return (
      <div style={S.root}>
        <style>{cssReset}</style>
        <header style={S.header}>
          <div style={S.logo}>
            <div style={S.logoMark}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect width="16" height="16" rx="4" fill="white" fillOpacity="0.2"/>
                <circle cx="8" cy="8" r="4" fill="white"/>
              </svg>
            </div>
            <span style={S.logoText}>SmartHire</span>
            <div style={S.logoDivider} />
            <span style={S.logoSub}>{candidate.jobRole}</span>
          </div>
        </header>
        <main style={{ ...S.main, justifyContent: 'center' }}>
          <div style={S.centeredWrapper}>
            <div style={{ ...S.pageCard, textAlign: 'center', padding: '56px 52px' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: 'linear-gradient(90deg, #EF4444, #F97316)', borderRadius: '24px 24px 0 0' }} />
              <div style={{ width: '88px', height: '88px', borderRadius: '50%', background: 'linear-gradient(135deg, #FEE2E2, #FECACA)', border: '3px solid #FCA5A5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '40px', margin: '0 auto 28px', boxShadow: '0 0 0 12px rgba(239,68,68,0.07)' }}>⏰</div>
              <h1 style={{ fontSize: '26px', fontWeight: 800, color: '#0F172A', marginBottom: '12px', letterSpacing: '-0.03em' }}>Interview Link Expired</h1>
              <p style={{ fontSize: '14px', color: '#64748B', lineHeight: 1.8, marginBottom: '8px', maxWidth: '420px', margin: '0 auto 8px' }}>
                This interview link was valid for <strong style={{ color: '#0F172A' }}>48 hours</strong> from when it was sent.
              </p>
              <p style={{ fontSize: '13px', color: '#94A3B8', marginBottom: '36px' }}>
                Link sent on <strong style={{ color: '#475569' }}>{sentLabel}</strong> — now expired.
              </p>
              <div style={{ width: '48px', height: '3px', background: 'linear-gradient(90deg, #EF4444, #F97316)', borderRadius: '999px', margin: '0 auto 36px' }} />
              {resendDone ? (
                <div style={{ background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: '14px', padding: '24px 28px', marginBottom: '12px' }}>
                  <div style={{ fontSize: '32px', marginBottom: '10px' }}>📧</div>
                  <p style={{ fontSize: '15px', fontWeight: 700, color: '#15803D', marginBottom: '6px' }}>New link sent!</p>
                  <p style={{ fontSize: '13px', color: '#16A34A', lineHeight: 1.7 }}>
                    A fresh interview link has been sent to<br /><strong>{candidate.candidateEmail}</strong>.<br />Please check your inbox (and spam folder).
                  </p>
                </div>
              ) : (
                <>
                  <p style={{ fontSize: '13px', color: '#64748B', marginBottom: '20px', lineHeight: 1.7 }}>
                    Need more time? Request a new link and we'll send it to<br />
                    <strong style={{ color: '#0F172A' }}>{candidate.candidateEmail}</strong>.
                  </p>
                  {resendError && (
                    <div style={{ background: '#FFF1F2', border: '1px solid #FECACA', borderRadius: '10px', padding: '10px 16px', fontSize: '13px', color: '#DC2626', marginBottom: '16px' }}>
                      {resendError}
                    </div>
                  )}
                  <button
                    style={{ ...S.btnPrimary, background: resendLoading ? '#94A3B8' : 'linear-gradient(135deg, #EF4444 0%, #F97316 100%)', boxShadow: resendLoading ? 'none' : '0 4px 16px rgba(239,68,68,0.35)', cursor: resendLoading ? 'not-allowed' : 'pointer', marginTop: 0 }}
                    onClick={handleResendLink}
                    disabled={resendLoading}
                  >
                    {resendLoading ? (
                      <><span style={{ width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid white', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite', marginRight: '10px' }} />Sending new link...</>
                    ) : <>📨 Resend Interview Link</>}
                  </button>
                  <p style={{ fontSize: '12px', color: '#94A3B8', marginTop: '16px' }}>
                    Or contact HR directly at <strong style={{ color: '#475569' }}>{candidate.interviewerName}</strong>
                  </p>
                </>
              )}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={S.root}>
      <style>{cssReset}</style>

      {isSubmitting && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(248,250,252,0.97)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: '24px', padding: '52px 56px', textAlign: 'center', maxWidth: '480px', width: '90%', boxShadow: '0 24px 80px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.05)' }}>
            <div style={{ width: '72px', height: '72px', borderRadius: '20px', background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', margin: '0 auto 24px', boxShadow: '0 8px 32px rgba(99,102,241,0.35)' }}>⚙️</div>
            <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#0F172A', marginBottom: '8px' }}>Submitting Your Interview</h2>
            <p style={{ fontSize: '14px', color: '#64748B', marginBottom: '32px', lineHeight: 1.6 }}>{submitStep}</p>
            <div style={{ width: '48px', height: '48px', border: '3px solid #E2E8F0', borderTop: '3px solid #6366F1', borderRadius: '50%', margin: '0 auto 24px', animation: 'spin 0.8s linear infinite' }} />
            <p style={{ fontSize: '12px', color: '#94A3B8', letterSpacing: '0.02em' }}>Please do not close this tab</p>
          </div>
        </div>
      )}

      <header style={S.header}>
        <div style={S.logo}>
          <div style={S.logoMark}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect width="16" height="16" rx="4" fill="white" fillOpacity="0.2"/>
              <circle cx="8" cy="8" r="4" fill="white"/>
            </svg>
          </div>
          <span style={S.logoText}>SmartHire</span>
          <div style={S.logoDivider} />
          <span style={S.logoSub}>{candidate.jobRole}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
  {stage === 'interview' && isRecording && (
    <div style={S.recBadge}><span style={S.recPulse} />REC {formatTime(recordingSeconds)}</div>
  )}
  {stage === 'interview' && (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#F0FDF4', border: '1px solid #86EFAC', color: '#15803D', fontSize: '12px', fontWeight: 600, padding: '5px 14px', borderRadius: '8px' }}>
      🛡 Secure Session
    </div>
  )}
  {stage === 'interview' && (
    <button
      onClick={handleEndSession}
      style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'white', border: '1px solid #FECACA', color: '#DC2626', fontSize: '12px', fontWeight: 700, padding: '5px 14px', borderRadius: '8px', cursor: 'pointer' }}
    >
      🗑 End Session
    </button>
  )}
  {stage === 'completed' && (
    <div style={{ ...S.stagePill, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#15803D' }}>
      <span style={{ color: '#22C55E', fontSize: '8px' }}>●</span>Submitted
    </div>
  )}
</div>
      </header>

      <main style={S.main}>

        {/* ── LANDING ── */}
        {stage === 'landing' && (
          <div style={S.centeredWrapper}>
            <div style={S.pageCard}>
              <div style={{ position: 'absolute', left: 0, top: '10%', bottom: '10%', width: '4px', background: 'linear-gradient(180deg, #6366F1, #8B5CF6)', borderRadius: '0 4px 4px 0' }} />
              <div style={{ marginBottom: '32px' }}>
                <div style={S.welcomeIcon}>👋</div>
                <h1 style={S.pageTitle}>Welcome to Your Interview</h1>
                <p style={S.pageSub}>
                  You've been shortlisted for{' '}
                  <span style={{ color: '#6366F1', fontWeight: 600 }}>{candidate.jobRole}</span>.
                  This AI-powered interview is recorded and evaluated securely.
                </p>
              </div>
              <div style={{ padding: '16px', background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: '12px', marginBottom: '20px', textAlign: 'center', fontWeight: 700, fontSize: '18px', color: '#92400E' }}>
                ⏳ {hours} hrs {minutes} mins {seconds} secs remaining
              </div>
              <div style={S.rulesGrid}>
                {[
                  { icon: '📷', text: 'Camera and microphone required throughout',           color: '#0EA5E9' },
                  { icon: '🔒', text: 'Questions are hidden — revealed when you start recording', color: '#8B5CF6' },
                  { icon: '🚫', text: 'Do NOT switch tabs or apps — session ends immediately',  color: '#EF4444' },
                  { icon: '💡', text: 'Find a quiet, well-lit environment before starting',    color: '#F59E0B' },
                  { icon: '✅', text: 'Complete the entire interview in one sitting',           color: '#22C55E' },
                  { icon: '🎙', text: 'Speak clearly — your voice is transcribed in real time', color: '#6366F1' },
                ].map(({ icon, text, color }) => (
                  <div key={text} style={S.ruleItem}>
                    <div style={{ ...S.ruleIcon, background: `${color}15`, color }}>{icon}</div>
                    <span style={{ fontSize: '13px', color: '#374151', lineHeight: 1.5 }}>{text}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: '32px' }}>
                <label style={S.fieldLabel}>Your Full Name</label>
                <input
                  style={{ ...S.textInput, ...(nameError ? { borderColor: '#EF4444', background: '#FFF5F5' } : {}) }}
                  type="text" placeholder="e.g. Ravi Kumar" value={nameInput}
                  onChange={e => { setNameInput(e.target.value); setNameError(''); }}
                  onKeyDown={e => e.key === 'Enter' && handleStartClick()}
                />
                {nameError && <p style={{ fontSize: '12px', color: '#EF4444', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>⚠ {nameError}</p>}
              </div>
              {permError && <div style={S.errorAlert}>{permError}</div>}
              <button style={S.btnPrimary} onClick={handleStartClick}>
                Continue to Setup
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ marginLeft: '8px' }}>
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* ── MIC / CAMERA CHECK ── */}
        {stage === 'mic_camera' && (
          <div style={S.centeredWrapper}>
            <div style={S.pageCard}>
              <div style={{ marginBottom: '28px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                  <div style={{ ...S.stepBadge, background: '#F0FDF4', color: '#16A34A', border: '1px solid #86EFAC' }}>Step 2 of 3</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: '999px', padding: '3px 12px', fontSize: '11px', fontWeight: 700, color: '#C2410C' }}>
                    ⏳ {String(hours).padStart(2,'0')}:{String(minutes).padStart(2,'0')}:{String(seconds).padStart(2,'0')} remaining
                  </div>
                </div>
                <h2 style={S.pageTitle}>Check Your Setup</h2>
                <p style={S.pageSub}>Ensure your camera and microphone are working before the interview begins.</p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
                <div>
                  <label style={{ ...S.fieldLabel, marginBottom: '10px', display: 'block' }}>Camera Preview</label>
                  <div style={S.videoContainer}>
                    <canvas ref={canvasRef} style={{ display: 'none' }} />
                    <video ref={videoRef} autoPlay muted playsInline style={S.video} />
                    <div style={{ position: 'absolute', top: '10px', left: '10px', background: cameraOk ? 'rgba(22,163,74,0.9)' : 'rgba(217,119,6,0.9)', color: 'white', fontSize: '11px', fontWeight: 600, padding: '4px 12px', borderRadius: '999px', letterSpacing: '0.04em', backdropFilter: 'blur(4px)' }}>
                      {checkingCamera ? '⏳ Checking...' : cameraOk ? '✓ Camera OK' : '⚠ Checking camera'}
                    </div>
                  </div>
                  {cameraWarning && <div style={{ ...S.warnAlert, marginTop: '10px' }}>⚠️ {cameraWarning}</div>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <label style={S.fieldLabel}>🎙 Microphone Level</label>
                      <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 10px', borderRadius: '999px', background: micOk ? '#DCFCE7' : '#F1F5F9', color: micOk ? '#15803D' : '#94A3B8' }}>
                        {micOk ? '✓ Detected' : 'Speak now...'}
                      </span>
                    </div>
                    <div style={S.micBar}>
                      <div style={{ ...S.micFill, width: `${micLevel}%`, background: micLevel > 60 ? '#EF4444' : micLevel > 30 ? '#F59E0B' : '#22C55E' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
                      <span style={{ fontSize: '10px', color: '#94A3B8' }}>Silent</span>
                      <span style={{ fontSize: '10px', color: '#94A3B8' }}>Loud</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <CheckRow ok={cameraOk} label="Camera visible and clear" />
                    <CheckRow ok={micOk}    label="Microphone detecting voice" />
                  </div>
                  <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '16px', fontSize: '12px', color: '#64748B', lineHeight: 1.7 }}>
                    <strong style={{ color: '#334155', display: 'block', marginBottom: '4px' }}>💡 Tips for a great interview</strong>
                    Sit with light in front of you, not behind. Keep the camera at eye level. Use a quiet room.
                  </div>
                </div>
              </div>
              <button
                style={{ ...S.btnPrimary, opacity: (micOk && cameraOk && !isLoadingQ) ? 1 : 0.45, cursor: (micOk && cameraOk && !isLoadingQ) ? 'pointer' : 'not-allowed' }}
                onClick={handleBeginInterview}
                disabled={!micOk || !cameraOk || isLoadingQ}
              >
                {isLoadingQ ? '⏳ Preparing your questions...' : (micOk && cameraOk) ? <>Begin Interview <span style={{ marginLeft: '8px' }}>→</span></> : 'Waiting for camera & microphone...'}
              </button>
            </div>
          </div>
        )}

        {/* ── INTERVIEW ── */}
        {stage === 'interview' && questions.length > 0 && (
          <div style={{ position: 'relative', width: '100%', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {windowHiddenWarning && (
              <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(8px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '32px' }}>
                <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'rgba(239,68,68,0.15)', border: '3px solid #EF4444', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '36px', marginBottom: '24px', animation: 'pulse 1s infinite' }}>⚠️</div>
                <h2 style={{ color: 'white', fontSize: '26px', fontWeight: 800, marginBottom: '12px' }}>Return to Interview</h2>
                <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '15px', maxWidth: '400px', lineHeight: 1.7, marginBottom: '24px' }}>
                  You switched away from the interview window.<br />
                  Return within <strong style={{ color: '#F87171' }}>10 seconds</strong> or your session will be terminated.
                </p>
                <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '12px', padding: '12px 28px', color: '#FCA5A5', fontSize: '14px', fontWeight: 600 }}>
                  Click anywhere on this window to resume
                </div>
              </div>
            )}

            <div style={S.interviewLayout}>
            <div style={S.leftPanel}>
  {/* ── Step tracker circles ── */}
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: '16px', borderBottom: '1px solid #F1F5F9' }}>
    {questions.map((q, i) => {
      const done   = q.recorded;
      const active = i === currentQIdx;
      return (
        <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <div style={{
              width: '34px', height: '34px', borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '12px', fontWeight: 700, flexShrink: 0,
              background: done ? '#22C55E' : active ? '#6366F1' : 'white',
              color: done || active ? 'white' : '#94A3B8',
              border: `2px solid ${done ? '#22C55E' : active ? '#6366F1' : '#E2E8F0'}`,
              boxShadow: active ? '0 0 0 4px rgba(99,102,241,0.15)' : 'none',
              transition: 'all 0.3s ease',
            }}>
              {done ? '✓' : i + 1}
            </div>
            <span style={{
              fontSize: '10px', fontWeight: 600,
              color: done ? '#16A34A' : active ? '#4F46E5' : '#94A3B8',
            }}>
              Q{i + 1}
            </span>
          </div>
          {i < questions.length - 1 && (
            <div style={{
              width: '40px', height: '2px', marginBottom: '16px', flexShrink: 0,
              background: q.recorded ? '#22C55E' : '#E2E8F0',
              transition: 'background 0.3s ease',
            }} />
          )}
        </div>
      );
    })}
  </div>

                <div style={S.questionCard}>
                  <div style={S.qBadge}>Q{currentQIdx + 1}</div>
                  {questionRevealed ? (
                    <p style={S.qText}>{questions[currentQIdx].text}</p>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '24px 0' }}>
                      <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔒</div>
                      <p style={{ fontSize: '15px', fontWeight: 700, color: '#6366F1', marginBottom: '6px' }}>Question Hidden</p>
                      <p style={{ fontSize: '13px', color: '#94A3B8', lineHeight: 1.6 }}>
                        Click <strong style={{ color: '#EF4444' }}>Start Recording</strong> to reveal the question.<br />
                        The timer begins immediately — answer right away.
                      </p>
                    </div>
                  )}
                </div>

                <div style={S.instructRow}>
                  <p style={{ fontSize: '13px', color: '#64748B', lineHeight: 1.6, flex: 1 }}>
                    {!questionRevealed
                      ? '🔒 Question will be revealed the moment you start recording.'
                      : isRecording
                        ? '🔴 Recording in progress — speak clearly, the timer auto-stops when time runs out.'
                        : questions[currentQIdx].recorded
                          ? '✅ Answer recorded successfully. Proceed to the next question.'
                          : '👆 Click Start Recording when you are ready to answer.'}
                  </p>
                  {isRecording && (
                    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 18px', borderRadius: '12px', background: timeLeft <= 30 ? '#FFF1F2' : timeLeft <= 60 ? '#FFFBEB' : '#F0FDF4', border: `2px solid ${timeLeft <= 30 ? '#FDA4AF' : timeLeft <= 60 ? '#FCD34D' : '#86EFAC'}`, animation: timeLeft <= 10 ? 'pulse 0.6s infinite' : 'none' }}>
                      <span style={{ fontSize: '26px', fontWeight: 900, lineHeight: 1, color: timeLeft <= 30 ? '#E11D48' : timeLeft <= 60 ? '#D97706' : '#16A34A', fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace' }}>
                        {String(Math.floor(timeLeft / 60)).padStart(2, '0')}:{String(timeLeft % 60).padStart(2, '0')}
                      </span>
                      <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', marginTop: '3px', color: timeLeft <= 30 ? '#F43F5E' : timeLeft <= 60 ? '#F59E0B' : '#22C55E' }}>
                      {isCodingQuestion(questions[currentQIdx]?.text || '', questions[currentQIdx]?.type) ? 'CODE TIME' : 'TIME LEFT'}
                      </span>
                      <div style={{ width: '64px', height: '3px', background: '#E5E7EB', borderRadius: '999px', marginTop: '6px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: '999px', background: timeLeft <= 30 ? '#EF4444' : timeLeft <= 60 ? '#F59E0B' : '#22C55E',width: `${(timeLeft / getTimeLimit(questions[currentQIdx]?.text || '', questions[currentQIdx]?.timerSeconds)) * 100}%`

, transition: 'width 1s linear' }} />
                      </div>
                    </div>
                  )}
                </div>

                {questionRevealed && isCodingQuestion(questions[currentQIdx]?.text || '', questions[currentQIdx]?.type) && (
                  <div style={{ border: '1px solid #1E293B', borderRadius: '12px', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#1E293B' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '14px' }}>💻</span>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: '#94A3B8', letterSpacing: '0.06em' }}>CODE EDITOR</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <select value={codeLanguage} onChange={e => setCodeLanguage(e.target.value)} style={{ background: '#334155', color: '#E2E8F0', border: '1px solid #475569', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', outline: 'none' }}>
                          {['javascript','typescript','python','java','csharp','cpp','php','ruby','go','rust','sql'].map(lang => (
                            <option key={lang} value={lang}>{lang}</option>
                          ))}
                        </select>
                        {isRecording ? (
                          <span style={{ fontSize: '11px', fontWeight: 800, padding: '3px 10px', borderRadius: '999px', background: '#DC2626', color: 'white', animation: 'pulse 1s infinite' }}>🔴 {formatTime(recordingSeconds)}</span>
                        ) : (
                          <span style={{ fontSize: '10px', padding: '3px 10px', borderRadius: '999px', background: '#059669', color: 'white', fontWeight: 700 }}>Write your answer</span>
                        )}
                      </div>
                    </div>
                    <div style={{ height: '280px' }}>
                      <Editor height="100%" language={codeLanguage} theme="vs-dark" value={codeAnswer} onChange={(value) => setCodeAnswer(value || '')}
                        options={{ minimap: { enabled: false }, fontSize: 13, automaticLayout: true, quickSuggestions: false, suggestOnTriggerCharacters: false, acceptSuggestionOnEnter: 'off', tabCompletion: 'off', wordBasedSuggestions: 'off', parameterHints: { enabled: false }, autoClosingBrackets: 'never', autoClosingQuotes: 'never' }}
                      />
                    </div>
                    <div style={{ padding: '8px 16px', background: '#1E293B', borderTop: '1px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '11px', color: '#64748B' }}>🎙 Speak your approach while typing — both are captured</span>
                      {codeAnswer.trim().length > 0 && <span style={{ fontSize: '11px', color: '#4ADE80', fontWeight: 600 }}>✓ {codeAnswer.trim().split('\n').length} lines</span>}
                    </div>
                  </div>
                )}

{currentQIdx > 0 && (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, minHeight: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Answered</span>
                      <div style={{ flex: 1, height: '1px', background: '#F1F5F9' }} />
                      <span style={{ fontSize: '11px', fontWeight: 700, color: '#22C55E', background: '#F0FDF4', border: '1px solid #86EFAC', padding: '2px 8px', borderRadius: '999px' }}>
                        {questions.filter(q => q.recorded).length} / {questions.length}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', alignContent: 'start' }}>                      {questions.slice(0, currentQIdx).map((q, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '10px', padding: '10px 12px' }}>
                          <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#16A34A', color: 'white', fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '1px' }}>✓</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '11px', fontWeight: 700, color: '#15803D', marginBottom: '2px' }}>Q{i + 1} — Done</div>
                            <div style={{ fontSize: '11px', color: '#16A34A', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>{q.text}</div>
                          </div>
                        </div>
                      ))}
                      {questions.slice(currentQIdx + 1).map((_, i) => (
                        <div key={`locked-${i}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '4px', background: '#F8FAFC', border: '1px dashed #E2E8F0', borderRadius: '10px', padding: '10px 12px', minHeight: '60px' }}>
                          <span style={{ fontSize: '16px' }}>🔒</span>
                          <span style={{ fontSize: '10px', color: '#94A3B8', fontWeight: 600 }}>Q{currentQIdx + i + 2} · Locked</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
<div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: 'auto', paddingTop: '12px' }}>                  {!isRecording && !questions[currentQIdx].recorded && (
                    <button style={S.btnRecord} onClick={startRecording}>
                      <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'white', display: 'inline-block', marginRight: '10px', animation: 'pulse 1s infinite' }} />
                      Start Recording
                    </button>
                  )}
                  {isRecording && (
                    <button
                      style={{ ...S.btnStop, opacity: recordingSeconds < 3 ? 0.5 : 1 }}
                      onClick={isLastQ ? handleStopLastAndShowSubmit : handleStopAndNext}
                      disabled={recordingSeconds < 3}
                    >
                      ⏹ {isLastQ ? `Stop Recording (${formatTime(recordingSeconds)})` : `Stop & Next Question (${formatTime(recordingSeconds)})`}
                    </button>
                  )}
                  {isLastQ && questions[currentQIdx].recorded && !isRecording && (
                    <button style={S.btnSubmit} onClick={() => handleSubmit(questions)} disabled={isSubmitting}>
                      ✅ Submit Interview
                    </button>
                  )}
                </div>
              
              </div>

              <div style={S.rightPanel}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748B', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Your Camera</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', background: isRecording ? '#FFF1F2' : '#F1F5F9', border: `1px solid ${isRecording ? '#FECACA' : '#E2E8F0'}`, borderRadius: '999px', padding: '4px 12px' }}>
                    <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: isRecording ? '#DC2626' : '#94A3B8', animation: isRecording ? 'pulse 1s infinite' : 'none' }} />
                    <span style={{ fontSize: '11px', fontWeight: 700, color: isRecording ? '#DC2626' : '#94A3B8' }}>
                      {isRecording ? `REC ${formatTime(recordingSeconds)}` : 'STANDBY'}
                    </span>
                  </div>
                </div>
                <div style={{ position: 'relative', borderRadius: '14px', overflow: 'hidden', background: '#0F172A', aspectRatio: '4/3', border: interviewCameraError ? '2px solid #EF4444' : isRecording ? '2px solid #DC2626' : '2px solid #E2E8F0', boxShadow: isRecording ? '0 0 0 4px rgba(220,38,38,0.1)' : 'none', transition: 'all 0.3s' }}>
                  <video ref={videoRef} autoPlay muted playsInline style={S.video} />
                  {interviewCameraError ? (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px', textAlign: 'center' }}>
                      <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(239,68,68,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', marginBottom: '12px', boxShadow: '0 0 0 8px rgba(239,68,68,0.2)' }}>⚠️</div>
                      <p style={{ color: 'white', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>{interviewCameraError}</p>
                      <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '10px' }}>Look directly at the camera</p>
                    </div>
                  ) : (
                    <div style={{ position: 'absolute', top: '10px', right: '10px', background: 'rgba(22,163,74,0.85)', backdropFilter: 'blur(4px)', color: 'white', fontSize: '10px', fontWeight: 700, padding: '4px 10px', borderRadius: '999px' }}>✓ Face OK</div>
                  )}
                </div>
                <div style={{ marginTop: '10px', padding: '12px 14px', borderRadius: '10px', background: interviewCameraError ? '#FFF1F2' : '#F0FDF4', border: `1px solid ${interviewCameraError ? '#FECACA' : '#86EFAC'}`, display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0, background: interviewCameraError ? '#FEE2E2' : '#DCFCE7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>
                    {interviewCameraError ? '😶' : '🙂'}
                  </div>
                  <div>
                    <p style={{ margin: 0, fontSize: '12px', fontWeight: 700, color: interviewCameraError ? '#B91C1C' : '#15803D' }}>
                      {interviewCameraError ? 'Face not detected' : 'Face detected'}
                    </p>
                    <p style={{ margin: 0, fontSize: '11px', color: interviewCameraError ? '#DC2626' : '#16A34A' }}>
                      {interviewCameraError ? 'Adjust your position' : 'AI can see you clearly'}
                    </p>
                  </div>
                </div>
                <div style={{ marginTop: '12px', padding: '14px 16px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>🎙</span>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#374151' }}>Microphone</span>
                    </div>
                    <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', background: micLevel > 10 ? '#DCFCE7' : '#FEE2E2', color: micLevel > 10 ? '#15803D' : '#B91C1C' }}>
                      {micLevel > 10 ? '● LIVE' : '○ SILENT'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '32px' }}>
                    {Array.from({ length: 24 }).map((_, i) => {
                      const active   = micLevel >= (i + 1) * (100 / 24);
                      const barColor = i < 10 ? '#22C55E' : i < 18 ? '#F59E0B' : '#EF4444';
                      return <div key={i} style={{ flex: 1, height: `${30 + i * 3}%`, borderRadius: '2px 2px 0 0', background: active ? barColor : '#E2E8F0', transition: 'background 0.06s' }} />;
                    })}
                  </div>
                  {micLevel <= 2 && (
                    <div style={{ marginTop: '10px', padding: '8px 12px', background: '#FFF1F2', border: '1px solid #FECACA', borderRadius: '8px', fontSize: '11px', color: '#DC2626', fontWeight: 600, textAlign: 'center' }}>
                      ⚠️ No audio — check microphone
                    </div>
                  )}
                </div>
                {/* Tips compact row */}
<div style={{ display: 'flex', gap: '6px' }}>
  {[
    { icon: '💡', title: 'Speak clearly', sub: 'Voice transcribed live' },
    { icon: '👁', title: 'Look at camera', sub: 'Eye contact tracked' },
    { icon: '⏱', title: 'Use your time', sub: 'Depth over speed' },
  ].map(t => (
    <div key={t.title} style={{ flex: 1, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
      <span style={{ fontSize: '13px', display: 'block', marginBottom: '3px' }}>{t.icon}</span>
      <span style={{ fontSize: '10px', fontWeight: 700, color: '#374151', display: 'block' }}>{t.title}</span>
      <span style={{ fontSize: '9px', color: '#94A3B8', display: 'block', marginTop: '1px', lineHeight: 1.3 }}>{t.sub}</span>
    </div>
  ))}
</div>
              </div>
            </div>
          </div>
        )}

        {/* ── COMPLETED ── */}
        {stage === 'completed' && !isSubmitting && (
          <div style={S.completedWrapper}>
            <div style={S.successHero}>
              <div style={S.successAccent} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                <div style={S.successCheckCircle}>✓</div>
                <div>
                  <h1 style={{ fontSize: '28px', fontWeight: 800, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.03em' }}>Interview Submitted!</h1>
                  <p style={{ fontSize: '15px', color: '#64748B', margin: 0, lineHeight: 1.6 }}>
                    Great work, <strong style={{ color: '#6366F1' }}>{nameInput || candidate.candidateName}</strong>!
                    Your responses have been securely recorded and submitted.
                  </p>
                </div>
              </div>
              <div style={S.successMeta}>
                <div style={S.metaItem}><span style={S.metaLabel}>Role</span><span style={S.metaValue}>{candidate.jobRole}</span></div>
                <div style={S.metaDivider} />
                <div style={S.metaItem}><span style={S.metaLabel}>Questions</span><span style={S.metaValue}>{questions.length} answered</span></div>
                <div style={S.metaDivider} />
                <div style={S.metaItem}><span style={S.metaLabel}>Status</span><span style={{ ...S.metaValue, color: '#16A34A' }}>✓ Complete</span></div>
                <div style={S.metaDivider} />
                <div style={S.metaItem}><span style={S.metaLabel}>Submitted to</span><span style={S.metaValue}>{candidate.candidateEmail}</span></div>
              </div>
            </div>
            <div style={S.completedGrid}>
              <div style={S.completedCard}>
                <h3 style={S.cardHeading}>What happens next?</h3>
                {([
                  { icon: '✅', color: '#22C55E', bg: '#F0FDF4', border: '#A7F3D0', title: 'Interview submitted',    sub: 'Your responses have been securely recorded',        done: true  },
                  { icon: '🤖', color: '#6366F1', bg: '#F5F3FF', border: '#C4B5FD', title: 'AI evaluation complete', sub: 'Your responses are being scored by AI',             done: true  },
                  { icon: '👥', color: '#F59E0B', bg: '#FFFBEB', border: '#FDE68A', title: 'Panel review',           sub: 'HR and the hiring panel will review your interview', done: false },
                  { icon: '📧', color: '#0EA5E9', bg: '#F0F9FF', border: '#BAE6FD', title: "You'll hear from us",    sub: `We'll reach out to ${candidate.candidateEmail}`,    done: false },
                ] as Array<{ icon: string; color: string; bg: string; border: string; title: string; sub: string; done: boolean }>
                ).map((step, i, arr) => (
                  <div key={i} style={{ display: 'flex', gap: '14px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '12px', flexShrink: 0, background: step.bg, border: `1px solid ${step.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>{step.icon}</div>
                      {i < arr.length - 1 && <div style={{ width: '2px', flex: 1, background: '#E5E7EB', margin: '6px 0', minHeight: '20px' }} />}
                    </div>
                    <div style={{ paddingTop: '8px', paddingBottom: i < arr.length - 1 ? '16px' : 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>{step.title}</span>
                        {step.done && <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 7px', background: '#DCFCE7', color: '#15803D', borderRadius: '999px', letterSpacing: '0.04em' }}>DONE</span>}
                      </div>
                      <p style={{ margin: 0, fontSize: '12px', color: '#64748B' }}>{step.sub}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div style={S.completedCard}>
                <h3 style={S.cardHeading}>
                  Recorded Answers
                  <span style={{ marginLeft: '10px', fontSize: '11px', fontWeight: 600, background: '#DCFCE7', color: '#15803D', padding: '2px 10px', borderRadius: '999px' }}>
                    {questions.length}/{questions.length}
                  </span>
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {questions.map((q, i) => (
                    <div key={i} style={S.answeredItemFull}>
                      <div style={{ width: '28px', height: '28px', borderRadius: '8px', flexShrink: 0, background: '#DCFCE7', border: '1px solid #86EFAC', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, color: '#15803D' }}>✓</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: '0 0 2px', fontSize: '12px', fontWeight: 600, color: '#374151' }}>Q{i + 1}</p>
                        <p style={{ margin: 0, fontSize: '11px', color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {q.text.substring(0, 72)}{q.text.length > 72 ? '...' : ''}
                        </p>
                      </div>
                      <span style={{ fontSize: '10px', color: '#94A3B8', fontWeight: 500, flexShrink: 0 }}>Recorded</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: '20px', padding: '16px', borderRadius: '12px', background: 'linear-gradient(135deg, #F5F3FF, #EDE9FE)', border: '1px solid #DDD6FE', textAlign: 'center' }}>
                  <span style={{ fontSize: '20px', display: 'block', marginBottom: '6px' }}>📩</span>
                  <p style={{ margin: '0 0 3px', fontSize: '13px', fontWeight: 700, color: '#5B21B6' }}>Our team will review your interview</p>
                  <p style={{ margin: 0, fontSize: '12px', color: '#7C3AED' }}>If selected, HR will contact you for the next round</p>
                </div>
              </div>
            </div>
            <p style={{ textAlign: 'center', fontSize: '13px', color: '#94A3B8', marginTop: '8px' }}>You may safely close this tab. Good luck! 🍀</p>
          </div>
        )}

      </main>
    </div>
  );
}

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────
function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 14px', borderRadius: '10px', background: ok ? '#F0FDF4' : '#F8FAFC', border: `1px solid ${ok ? '#86EFAC' : '#E2E8F0'}` }}>
      <div style={{ width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0, background: ok ? '#16A34A' : '#E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: 'white', fontWeight: 700 }}>
        {ok ? '✓' : '?'}
      </div>
      <span style={{ fontSize: '13px', color: ok ? '#16A34A' : '#64748B', fontWeight: ok ? 600 : 400 }}>{label}</span>
    </div>
  );
}

// ─── CSS RESET ────────────────────────────────────────────────────────────────
const cssReset = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  @keyframes pulse    { 0%,100%{opacity:1} 50%{opacity:0.4} }
  @keyframes spin     { to{transform:rotate(360deg)} }
  @keyframes popIn    { from{transform:scale(0.8) translateY(24px);opacity:0} to{transform:scale(1) translateY(0);opacity:1} }
  @keyframes slideUp  { from{transform:translateY(20px);opacity:0} to{transform:translateY(0);opacity:1} }
  @keyframes fadeIn   { from{opacity:0} to{opacity:1} }
  @keyframes shimmer  { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: #F1F5F9; }
  ::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 4px; }
  input::placeholder { color: #94A3B8; }
  input:focus { border-color: #6366F1 !important; box-shadow: 0 0 0 3px rgba(99,102,241,0.12) !important; }
  button { transition: all 0.18s ease; }
  button:hover:not(:disabled) { filter: brightness(1.06); transform: translateY(-1px); box-shadow: 0 4px 16px rgba(0,0,0,0.15); }
  button:active:not(:disabled) { transform: translateY(0); box-shadow: none; }
`;

// ─── STYLES ───────────────────────────────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {
  root:             { minHeight: '100vh', background: '#F8FAFC', color: '#111827', fontFamily: "'Inter', system-ui, -apple-system, sans-serif", display: 'flex', flexDirection: 'column' },
  header:           { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px', height: '60px', background: 'white', borderBottom: '1px solid #E2E8F0', position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  logo:             { display: 'flex', alignItems: 'center', gap: '10px' },
  logoMark:         { width: '32px', height: '32px', borderRadius: '9px', background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(99,102,241,0.35)' },
  logoText:         { fontWeight: 800, fontSize: '17px', color: '#0F172A', letterSpacing: '-0.02em' },
  logoDivider:      { width: '1px', height: '18px', background: '#E2E8F0', margin: '0 4px' },
  logoSub:          { fontSize: '13px', color: '#64748B', fontWeight: 500 },
  recBadge:         { display: 'flex', alignItems: 'center', gap: '7px', background: '#FFF1F2', border: '1px solid #FECACA', color: '#DC2626', fontSize: '12px', fontWeight: 700, padding: '5px 14px', borderRadius: '999px' },
  recPulse:         { width: '8px', height: '8px', borderRadius: '50%', background: '#DC2626', animation: 'pulse 1s infinite', display: 'inline-block' },
  stagePill:        { display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', color: '#4F46E5', fontSize: '12px', fontWeight: 600, padding: '5px 14px', borderRadius: '999px' },
  main: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px',
    width: '100%',
  },
  
  centeredWrapper: {
    width: '100%',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageCard: {
    width: '100%',
    maxWidth: '720px',
    background: 'white',
    borderRadius: '24px',
    padding: '40px',
    position: 'relative',
    boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
  },
    welcomeIcon:      { fontSize: '3rem', marginBottom: '16px', display: 'block' },
  pageTitle:        { fontSize: '26px', fontWeight: 800, color: '#0F172A', marginBottom: '10px', letterSpacing: '-0.03em' },
  pageSub:          { fontSize: '14px', color: '#64748B', lineHeight: 1.75, marginBottom: '0' },
  stepBadge:        { fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '999px' },
  rulesGrid:        { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '24px' },
  ruleItem:         { display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px', borderRadius: '10px', background: '#F8FAFC', border: '1px solid #E2E8F0' },
  ruleIcon:         { width: '28px', height: '28px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', flexShrink: 0 },
  fieldLabel:       { display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '8px', letterSpacing: '0.01em' },
  textInput:        { width: '100%', background: '#F8FAFC', border: '1.5px solid #E2E8F0', borderRadius: '10px', padding: '12px 16px', color: '#0F172A', fontSize: '14px', outline: 'none', transition: 'all 0.2s' },
  errorAlert:       { background: '#FFF1F2', border: '1px solid #FECACA', borderRadius: '10px', padding: '12px 16px', fontSize: '13px', color: '#DC2626', marginTop: '14px' },
  warnAlert:        { background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: '10px', padding: '10px 14px', fontSize: '13px', color: '#92400E' },
  btnPrimary:       { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)', color: 'white', border: 'none', borderRadius: '12px', padding: '14px 28px', fontSize: '15px', fontWeight: 700, cursor: 'pointer', marginTop: '24px', boxShadow: '0 4px 16px rgba(99,102,241,0.35)' },
  btnRecord:        { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', background: '#DC2626', color: 'white', border: 'none', borderRadius: '12px', padding: '14px', fontSize: '15px', fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 16px rgba(220,38,38,0.3)' },
  btnStop:          { width: '100%', background: '#1E293B', color: 'white', border: 'none', borderRadius: '12px', padding: '14px', fontSize: '15px', fontWeight: 700, cursor: 'pointer' },
  btnSubmit:        { width: '100%', background: 'linear-gradient(135deg, #059669 0%, #10B981 100%)', color: 'white', border: 'none', borderRadius: '12px', padding: '14px', fontSize: '15px', fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 16px rgba(5,150,105,0.3)' },
  videoContainer: {
    position: 'relative',
    width: '100%',
    height: '260px',
    borderRadius: '18px',
    overflow: 'hidden',
    background: '#000',
  },
    video:            { width: '100%', height: '100%', objectFit: 'cover', display: 'block', transform: 'scaleX(-1)' },
  micBar:           { width: '100%', height: '8px', background: '#E2E8F0', borderRadius: '999px', overflow: 'hidden' },
  micFill:          { height: '100%', borderRadius: '999px', transition: 'width 0.1s ease, background 0.2s' },
  interviewLayout: {
    width: '100%',
    maxWidth: '1400px',
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: '1fr 380px',
    gap: '24px',
    alignItems: 'start',
  },
  leftPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  rightPanel: {
    background: 'white',
    border: '1px solid #E2E8F0',
    borderRadius: '24px',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    minWidth: '360px',
  },
    progressHeader:   { paddingBottom: '16px', borderBottom: '1px solid #F1F5F9' },
  questionCard: {
    background: '#F8FAFC',
    border: '1px solid #E2E8F0',
    borderRadius: '20px',
    padding: '32px',
    minHeight: '220px',
    position: 'relative',
  },
    qBadge:           { display: 'inline-block', fontSize: '10px', fontWeight: 800, letterSpacing: '0.08em', color: '#6366F1', background: 'white', border: '1px solid #C4B5FD', padding: '2px 10px', borderRadius: '999px', marginBottom: '10px' },
  qText:            { fontSize: '17px', fontWeight: 600, color: '#0F172A', lineHeight: 1.6, margin: 0 },
  instructRow:      { display: 'flex', alignItems: 'flex-start', gap: '16px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '12px 16px' },
  answeredItem:     { display: 'flex', alignItems: 'flex-start', gap: '10px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '10px', padding: '10px 12px' },
  answeredCheck:    { width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0, background: '#16A34A', color: 'white', fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '1px' },
  completedWrapper: { width: '100%', maxWidth: '1200px', display: 'flex', flexDirection: 'column', gap: '20px' },
  successHero:      { background: 'white', border: '1px solid #E2E8F0', borderRadius: '20px', padding: '40px 48px', boxShadow: '0 4px 24px rgba(0,0,0,0.06)', position: 'relative', overflow: 'hidden', animation: 'slideUp 0.4s ease' },
  successAccent:    { position: 'absolute', top: 0, left: 0, right: 0, height: '5px', background: 'linear-gradient(90deg, #6366F1, #8B5CF6, #06B6D4)' },
  successCheckCircle: { width: '80px', height: '80px', borderRadius: '50%', flexShrink: 0, background: 'linear-gradient(135deg, #059669 0%, #10B981 100%)', color: 'white', fontSize: '36px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 10px rgba(16,185,129,0.1), 0 8px 32px rgba(16,185,129,0.3)', animation: 'popIn 0.5s cubic-bezier(0.175,0.885,0.32,1.275)' },
  successMeta:      { display: 'flex', alignItems: 'center', gap: '0', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '16px 24px', marginTop: '28px' },
  metaItem:         { display: 'flex', flexDirection: 'column', gap: '3px', flex: 1 },
  metaLabel:        { fontSize: '10px', fontWeight: 600, color: '#94A3B8', letterSpacing: '0.06em', textTransform: 'uppercase' },
  metaValue:        { fontSize: '13px', fontWeight: 600, color: '#0F172A' },
  metaDivider:      { width: '1px', height: '36px', background: '#E2E8F0', margin: '0 20px', flexShrink: 0 },
  completedGrid:    { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' },
  completedCard:    { background: 'white', border: '1px solid #E2E8F0', borderRadius: '20px', padding: '32px', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' },
  cardHeading:      { fontSize: '16px', fontWeight: 700, color: '#0F172A', marginBottom: '24px', display: 'flex', alignItems: 'center' },
  answeredItemFull: { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', borderRadius: '10px', background: '#F8FAFC', border: '1px solid #E2E8F0' },
};