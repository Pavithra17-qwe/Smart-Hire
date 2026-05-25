'use client';
// app/interview/[token]/InterviewClient.tsx

import { useState, useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { useMediaPipeAnalysis } from '@/hooks/useMediaPipeAnalysis';
import { useSoloWindow } from '@/hooks/useSoloWindow';

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

  // ── Question revealed state (hidden until recording starts) ─────────────────
  const [questionRevealed,  setQuestionRevealed]  = useState(false);

  // ── Per-question time limits ─────────────────────────────────────────────────
  const NORMAL_Q_LIMIT = 60;
  const CODING_Q_LIMIT = 300;

  const isCodingQuestion = (text: string) =>
    /\bwrite\b|\bimplement\b|\bpseudocode\b/i.test(text);

  const getTimeLimit = (qText: string) =>
    isCodingQuestion(qText) ? CODING_Q_LIMIT : NORMAL_Q_LIMIT;

  const [timeLeft,    setTimeLeft]    = useState<number>(NORMAL_Q_LIMIT);
  const [timerActive, setTimerActive] = useState(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Detect coding language from job role ────────────────────────────────────
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
  const mediaPipeResultRef = useRef<any>(null);

  // ── Mic/Camera check state ──────────────────────────────────────────────────
  const [micLevel,       setMicLevel]       = useState(0);
  const [micOk,          setMicOk]          = useState(false);
  const [cameraOk,       setCameraOk]       = useState(false);
  const [cameraWarning,  setCameraWarning]  = useState('');
  const [checkingCamera, setCheckingCamera] = useState(false);
  const [permError,      setPermError]      = useState('');

  const [interviewCameraError, setInterviewCameraError] = useState('');
  const [windowHiddenWarning,  setWindowHiddenWarning]  = useState(false);

  // ── Refs ────────────────────────────────────────────────────────────────────
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

  // ── Tab close refs ──────────────────────────────────────────────────────────
  const tabIdRef   = useRef<string>(`tab_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const channelRef = useRef<BroadcastChannel | null>(null);

  // ══════════════════════════════════════════════════════════════════════════════
  // Re-attach stream when stage becomes 'interview'
  // ══════════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (stage === 'interview' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [stage]);

  // ══════════════════════════════════════════════════════════════════════════════
  // Reset question reveal when question index changes
  // ══════════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    setQuestionRevealed(false);
  }, [currentQIdx]);

  // ══════════════════════════════════════════════════════════════════════════════
  // TAB SWITCH + APP SWITCH PROTECTION
  // ══════════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (stage !== 'interview' && stage !== 'mic_camera') return;

    const expireSession = async (reason: string) => {
      if (sessionLockRef.current) return;
      sessionLockRef.current = true;
    
      // ── Stop current recording and collect the blob ──────────────
      let lastBlob: Blob | null = null;
      try {
        const recorder = recorderRef.current;
        if (recorder && recorder.state !== 'inactive') {
          lastBlob = await new Promise<Blob>((resolve) => {
            recorder.onstop = () =>
              resolve(new Blob(chunksRef.current, { type: 'video/webm' }));
            recorder.stop();
          });
        }
      } catch (_) {}
    
      streamRef.current?.getTracks().forEach(t => t.stop());
    
      // ── Build allQs with the last blob included ──────────────────
      const allQs = questionsRef.current.map((q, i) => {
        if (i === currentQIdxRef.current && lastBlob && !q.recorded) {
          return { ...q, recorded: true, blob: lastBlob };
        }
        return q;
      });
    
      // ── Upload only answered questions (those with a blob) ────────
      try {
        const uploadResults = await Promise.all(
          allQs.map(async (q, i) => {
            if (!q.blob) return { i, url: '' };
            const formData = new FormData();
            formData.append('video',          q.blob, `q${i + 1}.webm`);
            formData.append('token',          candidate.token);
            formData.append('candidateId',    candidate.candidateId);
            formData.append('questionIdx',    String(i));
            formData.append('candidateName',  candidate.candidateName);
            formData.append('candidateEmail', candidate.candidateEmail);
            formData.append('questionText',   q.text);
            try {
              const res  = await fetch('/api/interview/complete', { method: 'POST', body: formData });
              const data = await res.json();
              return { i, url: data.videoUrl || '' };
            } catch { return { i, url: '' }; }
          })
        );
    
        uploadResults.sort((a, b) => a.i - b.i);
        const uploadedUrls = uploadResults.map(r => r.url);
    
        // ── Score based on what was uploaded ─────────────────────────
        await fetch('/api/interview/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token:             candidate.token,
            candidateId:       candidate.candidateId,
            questions:         allQs.map(q => q.text),
            jobRole:           candidate.jobRole,
            videoUrls:         uploadedUrls,
            codeAnswer,
            codeLanguage,
            eyeContactScore:   mediaPipeResultRef.current?.eyeContactScore   ?? null,
            bodyLanguageScore: mediaPipeResultRef.current?.bodyLanguageScore ?? null,
            faceVisiblePct:    mediaPipeResultRef.current?.faceVisiblePct    ?? null,
          }),
        });
      } catch (_) {}
    
      // ── Mark session as expired ───────────────────────────────────
      try {
        await fetch('/api/interview/expire', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: candidate.token, reason }),
        });
      } catch (_) {}
    
      setExpiredReason(reason);
      setSessionExpired(true);
    };

    const onHide = () => {
      if (document.hidden) expireSession('tab_switch');
    };

    const blurTimerRef = { current: null as ReturnType<typeof setTimeout> | null };
    const onWindowBlur = () => {
      if (stage === 'interview' && !sessionLockRef.current) {
        setWindowHiddenWarning(true);
        blurTimerRef.current = setTimeout(() => {
          expireSession('app_switch');
        }, 10000);
      }
    };
    const onWindowFocus = () => {
      if (blurTimerRef.current) { clearTimeout(blurTimerRef.current); blurTimerRef.current = null; }
      setWindowHiddenWarning(false);
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
      if (!sessionLockRef.current) {
        navigator.sendBeacon('/api/interview/expire',
          JSON.stringify({ token: candidate.token, reason: 'closed' }));
      }
    };
    const blockContext = (e: MouseEvent) => { if (stage === 'interview') e.preventDefault(); };

    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('focus', onWindowFocus);
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

  // ── Cleanup on unmount ──────────────────────────────────────────────────────
  useEffect(() => {
    return () => { stopAllMedia(); };
  }, []);

  // ── Close all other tabs when this interview tab opens ──────────────────────
  useEffect(() => {
    const channel = new BroadcastChannel('smarthire_interview');
    channelRef.current = channel;
    channel.onmessage = (e) => {
      if (e.data?.type === 'interview-open' && e.data?.tabId !== tabIdRef.current) {
        channel.close();
        window.close();
      }
    };
    channel.postMessage({ type: 'interview-open', tabId: tabIdRef.current });
    return () => { channel.close(); };
  }, []);

  // ══════════════════════════════════════════════════════════════════════════════
  // STEP 1 — LANDING
  // ══════════════════════════════════════════════════════════════════════════════
  const handleStartClick = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed.length < 2) { setNameError('Please enter your name to continue.'); return; }
    setNameError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' },
        audio: true,
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

  // ══════════════════════════════════════════════════════════════════════════════
  // MIC LEVEL MONITOR
  // ══════════════════════════════════════════════════════════════════════════════
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

  // ── Refs to read latest state inside setInterval closure ──────────────────
  const currentQIdxRef = useRef(currentQIdx);
  const questionsRef   = useRef(questions);
  useEffect(() => { currentQIdxRef.current = currentQIdx; }, [currentQIdx]);
  useEffect(() => { questionsRef.current   = questions;   }, [questions]);

  // ══════════════════════════════════════════════════════════════════════════════
  // PER-QUESTION COUNTDOWN TIMER
  // ══════════════════════════════════════════════════════════════════════════════
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
      chunksRef.current  = [];
      recorderRef.current = null;
    }
  };

  const startCountdown = (qText: string) => {
    const limit = getTimeLimit(qText);
    setTimeLeft(limit);
    setTimerActive(true);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          setTimerActive(false);
          autoStopOnTimeout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // FACE DETECTION
  // ══════════════════════════════════════════════════════════════════════════════
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
        const i = (y * w + x) * 4;
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        const brightness = (r + g + b) / 3;
        totalBrightness += brightness;
        brightnessValues.push(brightness);
        pixelCount++;
        const isSkin = r > 70 && g > 45 && b > 20 && r > g && r > b && r - g > 12 && r - b > 15 && brightness > 50 && brightness < 230;
        const inCentre = x >= cx1 && x <= cx2 && y >= cy1 && y <= cy2;
        if (inCentre) { centrePixelCount++; if (isSkin) centreSkinPixels++; }
        else          { edgePixelCount++;   if (isSkin) edgeSkinPixels++;   }
      }
    }

    const avg      = totalBrightness / pixelCount;
    const variance = brightnessValues.reduce((a, v) => a + Math.pow(v - avg, 2), 0) / pixelCount;
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

  // ══════════════════════════════════════════════════════════════════════════════
  // STEP 2 — BEGIN INTERVIEW
  // ══════════════════════════════════════════════════════════════════════════════
  const handleBeginInterview = async () => {
    if (!micOk || !cameraOk) return;
    setIsLoadingQ(true);
    stopMicMonitor();
    stopCameraCheck();

    await fetch('/api/interview/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: candidate.token }),
    });

    const res  = await fetch('/api/interview/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobRole:        candidate.jobRole,
        experience:     candidate.experience,
        candidateName:  candidate.candidateName,
        resumeText:     candidate.resumeText,
        jobDescription: candidate.jobDescription,
      }),
    });
    const data = await res.json();
    const qs: Question[] = (data.questions as string[]).map((text, i) => ({ id: i, text, recorded: false, blob: null }));
    setQuestions(qs);
    setCurrentQIdx(0);
    setIsLoadingQ(false);

    if (streamRef.current) startMicMonitor(streamRef.current);
    startCameraCheck(true);
    setStage('interview');
    setTimeout(() => { if (videoRef.current) startCapture(videoRef.current); }, 500);
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // STEP 3 — PER-QUESTION RECORDING
  // ══════════════════════════════════════════════════════════════════════════════
  const startRecording = () => {
    setQuestionRevealed(true); // ← reveal question when recording starts
    if (!streamRef.current) return;

    if (videoRef.current && !videoRef.current.srcObject) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }

    chunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus' : 'video/webm';
    const recorder = new MediaRecorder(streamRef.current, { mimeType });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.start(500);
    recorderRef.current = recorder;
    setIsRecording(true);
    setRecordingSeconds(0);
    recTimerRef.current = setInterval(() => setRecordingSeconds(prev => prev + 1), 1000);
    startCountdown(questionsRef.current[currentQIdxRef.current]?.text || '');
  };

  const stopRecording = (): Promise<Blob> => {
    return new Promise((resolve) => {
      clearInterval(recTimerRef.current!);
      setIsRecording(false);
      stopCountdown();
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        resolve(new Blob(chunksRef.current, { type: 'video/webm' }));
        return;
      }
      recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: 'video/webm' }));
      recorder.stop();
    });
  };

  const handleStopAndNext = async () => {
    const blob = await stopRecording();
    setQuestions(prev => prev.map((q, i) => i === currentQIdx ? { ...q, recorded: true, blob } : q));
    if (currentQIdx < questions.length - 1) setCurrentQIdx(prev => prev + 1);
  };

  const handleStopLastAndShowSubmit = async () => {
    const blob = await stopRecording();
    setQuestions(prev => prev.map((q, i) => i === currentQIdx ? { ...q, recorded: true, blob } : q));
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // STEP 4 — SUBMIT (parallel uploads)
  // ══════════════════════════════════════════════════════════════════════════════
  const handleSubmit = async (currentQuestions: Question[]) => {
    
    let lastBlob: Blob | null = null;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      lastBlob = await stopRecording();
    }
    setQuestions(prev => prev.map((q, i) =>
      i === currentQIdx && !q.recorded && lastBlob ? { ...q, recorded: true, blob: lastBlob } : q,
    ));

    const mediaPipeResult = stopCapture();
    mediaPipeResultRef.current = mediaPipeResult;

    setIsSubmitting(true);
    sessionLockRef.current = true;
    stopAllMedia();

    setSubmitStep('Uploading your interview recordings...');

    // Build allQs from state snapshot passed directly — don't rely on ref
    const allQs = currentQuestions.map((q, i) => {
      if (i === currentQIdx && lastBlob && !q.recorded) {
        return { ...q, recorded: true, blob: lastBlob };
      }
      return q;
    });

    // ── Upload all videos in PARALLEL ─────────────────────────────────────────
    const uploadResults = await Promise.all(
      allQs.map(async (q, i) => {
        if (!q.blob) return { i, url: '' };
        const formData = new FormData();
        formData.append('video',         q.blob, `q${i + 1}.webm`);
        formData.append('token',         candidate.token);
        formData.append('candidateId',   candidate.candidateId);
        formData.append('questionIdx',   String(i));
        formData.append('candidateName', candidate.candidateName);
        formData.append('candidateEmail',candidate.candidateEmail);
        formData.append('questionText',  q.text);
        try {
          const res  = await fetch('/api/interview/complete', { method: 'POST', body: formData });
          const data = await res.json();
          return { i, url: data.videoUrl || '' };
        } catch { return { i, url: '' }; }
      })
    );

    uploadResults.sort((a, b) => a.i - b.i);
    const uploadedUrls = uploadResults.map(r => r.url);
    setUploadedVideoUrls(uploadedUrls);
    setSubmittedAt(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

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
          codeAnswer,
          codeLanguage,
          eyeContactScore:   mediaPipeResultRef.current?.eyeContactScore   ?? null,
          bodyLanguageScore: mediaPipeResultRef.current?.bodyLanguageScore ?? null,
          faceVisiblePct:    mediaPipeResultRef.current?.faceVisiblePct    ?? null,
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

  // ── Helpers ─────────────────────────────────────────────────────────────────
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

  // ── Session expired ─────────────────────────────────────────────────────────
  if (sessionExpired) {
    const body = expiredReason === 'app_switch'
      ? 'Your interview session ended because you switched to another application. For security, this link can no longer be used. Please contact HR.'
      : 'Your interview session ended because you switched tabs or closed the browser. For security, this link can no longer be used. Please contact HR.';
    return <FullScreen icon="🔒" title="Session Ended" body={body} />;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════════
  return (
    <div style={S.root}>

      {/* ── SUBMITTING OVERLAY — full screen, above everything ── */}
      {isSubmitting && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          background: '#F5F6FA',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ ...S.card, textAlign: 'center', maxWidth: '420px' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>⚙️</div>
            <h2 style={S.cardTitle}>Submitting Your Interview</h2>
            <p style={S.cardSub}>{submitStep}</p>
            <div style={S.spinner} />
            <p style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '16px' }}>
              Please do not close this tab.
            </p>
          </div>
        </div>
      )}

      {/* ── HEADER ── */}
      <header style={S.header}>
        <div style={S.logo}>
          <span style={S.logoDot} />
          SmartHire
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {stage === 'interview' && isRecording && (
            <div style={S.recBadge}>
              <span style={S.recDot} />
              REC {formatTime(recordingSeconds)}
            </div>
          )}
          <span style={{ fontSize: '12px', color: '#9CA3AF' }}>
            AI Interview · {candidate.jobRole}
          </span>
        </div>
      </header>

      <main style={S.main}>

        {/* ════════════════════════════════════════════════════
            LANDING
        ════════════════════════════════════════════════════ */}
        {stage === 'landing' && (
          <div style={S.card}>
            <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>👋</div>
            <h1 style={S.cardTitle}>Welcome to Your Interview</h1>
            <p style={S.cardSub}>
              You've been shortlisted for{' '}
              <strong style={{ color: '#7C3AED' }}>{candidate.jobRole}</strong>.
              This is an AI-powered video interview.
            </p>
            <div style={S.rulesBox}>
              {[
                ['⏱', 'This link is valid for 48 hours'],
                ['📷', 'Camera and microphone required throughout'],
                ['🔒', 'Questions are hidden — revealed only when you start recording'],
                ['🚫', 'Do NOT switch tabs or apps — session will end immediately'],
                ['💡', 'Find a quiet, well-lit environment'],
                ['✅', 'Complete the interview in one sitting'],
              ].map(([icon, text]) => (
                <div key={String(text)} style={S.ruleRow}>
                  <span style={{ fontSize: '14px' }}>{icon}</span>
                  <span style={{ fontSize: '13px', color: '#374151' }}>{text}</span>
                </div>
              ))}
            </div>
            <div style={{ textAlign: 'left', marginBottom: '16px' }}>
              <label style={S.label}>Enter your name to begin</label>
              <input
                style={{ ...S.input, ...(nameError ? { borderColor: '#EF4444' } : {}) }}
                type="text"
                placeholder="e.g. Ravi or Ravi Kumar"
                value={nameInput}
                onChange={e => { setNameInput(e.target.value); setNameError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleStartClick()}
              />
              {nameError && <p style={S.errText}>{nameError}</p>}
            </div>
            {permError && <div style={S.errorBox}>{permError}</div>}
            <button style={S.btnPrimary} onClick={handleStartClick}>Continue →</button>
          </div>
        )}

        {/* ════════════════════════════════════════════════════
            MIC + CAMERA CHECK
        ════════════════════════════════════════════════════ */}
        {stage === 'mic_camera' && (
          <div style={{ ...S.card, maxWidth: '700px' }}>
            <h2 style={S.cardTitle}>Check Your Setup</h2>
            <p style={S.cardSub}>Make sure your microphone and camera are working before you begin.</p>
            <div style={S.videoBox}>
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              <video ref={videoRef} autoPlay muted playsInline style={S.video} />
              <div style={{
                position: 'absolute', top: '10px', left: '10px',
                background: 'rgba(0,0,0,0.7)',
                color: cameraOk ? '#4ADE80' : '#FCD34D',
                fontSize: '11px', fontWeight: 600, padding: '3px 10px',
                borderRadius: '999px', letterSpacing: '0.05em',
              }}>
                {checkingCamera ? 'Checking...' : cameraOk ? '✓ Camera OK' : '⚠ Checking camera'}
              </div>
            </div>
            {cameraWarning && <div style={S.warnBox}>⚠️ {cameraWarning}</div>}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={S.label}>🎙 Microphone level — speak to test</span>
                <span style={{ fontSize: '11px', color: micOk ? '#16A34A' : '#9CA3AF' }}>
                  {micOk ? '✓ Mic detected' : 'Speak now...'}
                </span>
              </div>
              <div style={S.micBarBg}>
                <div style={{ ...S.micBarFill, width: `${micLevel}%`, background: micLevel > 50 ? '#16A34A' : micLevel > 20 ? '#F59E0B' : '#E5E7EB' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                <span style={{ fontSize: '10px', color: '#9CA3AF' }}>Silent</span>
                <span style={{ fontSize: '10px', color: '#9CA3AF' }}>Loud</span>
              </div>
            </div>
            <div style={S.checkGrid}>
              <CheckRow ok={cameraOk} label="Camera visible and clear" />
              <CheckRow ok={micOk}    label="Microphone detecting voice" />
            </div>
            <button
              style={{ ...S.btnPrimary, opacity: (micOk && cameraOk && !isLoadingQ) ? 1 : 0.45, cursor: (micOk && cameraOk && !isLoadingQ) ? 'pointer' : 'not-allowed' }}
              onClick={handleBeginInterview}
              disabled={!micOk || !cameraOk || isLoadingQ}
            >
              {isLoadingQ ? '⏳ Preparing questions...' : (micOk && cameraOk) ? 'Begin Interview →' : 'Waiting for mic and camera...'}
            </button>
          </div>
        )}

        {/* ════════════════════════════════════════════════════
            INTERVIEW
        ════════════════════════════════════════════════════ */}
        {stage === 'interview' && questions.length > 0 && (
          <div style={{ position: 'relative' }}>

            {/* Window hidden warning overlay */}
            {windowHiddenWarning && (
              <div style={{
                position: 'fixed', inset: 0, zIndex: 9999,
                background: 'rgba(0,0,0,0.82)',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                textAlign: 'center', padding: '32px',
              }}>
                <div style={{
                  width: '72px', height: '72px', borderRadius: '50%',
                  background: 'rgba(239,68,68,0.15)', border: '3px solid #EF4444',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '36px', marginBottom: '20px', animation: 'pulse 1s infinite',
                }}>⚠️</div>
                <h2 style={{ color: 'white', fontSize: '22px', fontWeight: 800, margin: '0 0 10px' }}>
                  Return to Interview
                </h2>
                <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '14px', maxWidth: '380px', lineHeight: 1.6, margin: '0 0 20px' }}>
                  You switched away from the interview window.
                  Return within <strong style={{ color: '#F87171' }}>10 seconds</strong> or your session will be terminated.
                </p>
                <div style={{
                  background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.5)',
                  borderRadius: '8px', padding: '10px 24px',
                  color: '#FCA5A5', fontSize: '13px', fontWeight: 600,
                }}>
                  Click anywhere on this window to resume
                </div>
              </div>
            )}

            <div style={S.interviewLayout}>

              {/* LEFT — question + controls */}
              <div style={S.leftPanel}>

                <div style={S.qCounter}>
                  <span style={{ fontSize: '12px', color: '#6B7280', fontWeight: 500 }}>
                    Question {currentQIdx + 1} of {questions.length}
                  </span>
                  <div style={S.qDots}>
                    {questions.map((q, i) => (
                      <div key={i} style={{
                        ...S.qDot,
                        background: q.recorded ? '#16A34A' : i === currentQIdx ? '#7C3AED' : '#E5E7EB',
                      }} />
                    ))}
                  </div>
                </div>

                {/* ── QUESTION BOX — hidden until recording starts ── */}
                <div style={S.questionBox}>
                  <div style={S.qLabel}>Q{currentQIdx + 1}</div>
                  {questionRevealed ? (
                    <p style={S.qText}>{questions[currentQIdx].text}</p>
                  ) : (
                    <div style={{
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      padding: '20px 0', gap: '10px', textAlign: 'center',
                    }}>
                      <span style={{ fontSize: '32px' }}>🔒</span>
                      <p style={{ fontSize: '14px', fontWeight: 700, color: '#7C3AED', margin: 0 }}>
                        Question Hidden
                      </p>
                      <p style={{ fontSize: '12px', color: '#9CA3AF', margin: 0, lineHeight: 1.6 }}>
                        Click <strong style={{ color: '#DC2626' }}>Start Recording</strong> to reveal.<br />
                        Timer starts immediately — answer right away.
                      </p>
                    </div>
                  )}
                </div>

                {/* ── INSTRUCTION + TIMER ── */}
                <div style={S.instructBox}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                    <p style={{ fontSize: '12px', color: '#6B7280', margin: 0, lineHeight: 1.6 }}>
                      {!questionRevealed
                        ? '🔒 Question will be revealed when you start recording.'
                        : isRecording
                          ? '🔴 Recording in progress — answer clearly. Timer will auto-stop.'
                          : questions[currentQIdx].recorded
                            ? '✅ Answer recorded. Proceed to the next question.'
                            : '👆 Click Start Recording when you are ready to answer.'}
                    </p>

                    {/* Countdown timer */}
                    {isRecording && (
                      <div style={{
                        flexShrink: 0,
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        padding: '6px 14px', borderRadius: '10px',
                        background: timeLeft <= 30 ? '#FEF2F2' : timeLeft <= 60 ? '#FFFBEB' : '#F0FDF4',
                        border: `2px solid ${timeLeft <= 30 ? '#EF4444' : timeLeft <= 60 ? '#F59E0B' : '#22C55E'}`,
                        transition: 'all 0.3s',
                        animation: timeLeft <= 10 ? 'pulse 0.5s infinite' : 'none',
                      }}>
                        <span style={{
                          fontSize: '22px', fontWeight: 900, lineHeight: 1,
                          color: timeLeft <= 30 ? '#DC2626' : timeLeft <= 60 ? '#D97706' : '#16A34A',
                          fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace',
                        }}>
                          {String(Math.floor(timeLeft / 60)).padStart(2, '0')}:{String(timeLeft % 60).padStart(2, '0')}
                        </span>
                        <span style={{
                          fontSize: '9px', fontWeight: 700, letterSpacing: '0.05em',
                          color: timeLeft <= 30 ? '#EF4444' : timeLeft <= 60 ? '#F59E0B' : '#22C55E',
                          marginTop: '2px',
                        }}>
                          {isCodingQuestion(questions[currentQIdx]?.text || '') ? 'CODE TIME' : 'TIME LEFT'}
                        </span>
                        <div style={{ marginTop: '4px', width: '60px', height: '3px', background: '#E5E7EB', borderRadius: '999px', overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', borderRadius: '999px',
                            background: timeLeft <= 30 ? '#EF4444' : timeLeft <= 60 ? '#F59E0B' : '#22C55E',
                            width: `${(timeLeft / getTimeLimit(questions[currentQIdx]?.text || '')) * 100}%`,
                            transition: 'width 1s linear, background 0.3s',
                          }} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── CODING EDITOR — last Q for dev roles ── */}
                {questionRevealed &&
                  currentQIdx === questions.length - 1 &&
                  isCodingQuestion(questions[currentQIdx]?.text || '') && (
                  <div style={{ border: '1px solid #E5E7EB', borderRadius: '12px', overflow: 'hidden', marginTop: '4px' }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 14px', background: '#1E1E1E', borderBottom: '1px solid #333',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '13px', color: '#9CA3AF' }}>💻</span>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: '#E5E7EB', letterSpacing: '0.04em' }}>CODE EDITOR</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <select
                          value={codeLanguage}
                          onChange={e => setCodeLanguage(e.target.value)}
                          style={{
                            background: '#3C3C3C', color: '#E5E7EB',
                            border: '1px solid #555', borderRadius: '6px',
                            padding: '3px 8px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', outline: 'none',
                          }}
                        >
                          {['javascript','typescript','python','java','csharp','cpp','php','ruby','go','rust','sql'].map(lang => (
                            <option key={lang} value={lang}>{lang}</option>
                          ))}
                        </select>
                        {isRecording ? (
                          <span style={{
                            fontSize: '12px', fontWeight: 800, padding: '3px 10px',
                            borderRadius: '999px', background: '#DC2626', color: 'white',
                            animation: 'pulse 1s infinite', letterSpacing: '0.05em',
                          }}>🔴 {formatTime(recordingSeconds)}</span>
                        ) : (
                          <span style={{
                            fontSize: '10px', padding: '2px 8px', borderRadius: '999px',
                            background: '#059669', color: 'white', fontWeight: 700,
                          }}>Write your answer below</span>
                        )}
                      </div>
                    </div>
                    <div style={{ height: '260px' }}>
                      <Editor
                        height="100%"
                        language={codeLanguage}
                        theme="vs-dark"
                        value={codeAnswer}
                        onChange={(value) => setCodeAnswer(value || '')}
                        options={{
                          minimap: { enabled: false }, fontSize: 13, automaticLayout: true,
                          quickSuggestions: false, suggestOnTriggerCharacters: false,
                          acceptSuggestionOnEnter: 'off', tabCompletion: 'off',
                          wordBasedSuggestions: 'off', parameterHints: { enabled: false },
                          autoClosingBrackets: 'never', autoClosingQuotes: 'never',
                        }}
                      />
                    </div>
                    <div style={{
                      padding: '8px 14px', background: '#252526', borderTop: '1px solid #333',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                      <span style={{ fontSize: '10px', color: '#6B7280' }}>🎙 Speak your approach while typing — both are recorded</span>
                      {codeAnswer.trim().length > 0 && (
                        <span style={{ fontSize: '10px', color: '#4ADE80', fontWeight: 600 }}>
                          ✓ {codeAnswer.trim().split('\n').length} lines
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Answered questions list */}
                {questions.slice(0, currentQIdx).map((q, i) => (
                  <div key={i} style={S.answeredCard}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{
                        width: '18px', height: '18px', borderRadius: '50%',
                        background: '#16A34A', color: 'white',
                        fontSize: '10px', fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>✓</span>
                      <p style={{ fontSize: '12px', color: '#6B7280', margin: 0 }}>
                        Q{i + 1}: {q.text.substring(0, 60)}{q.text.length > 60 ? '...' : ''}
                      </p>
                    </div>
                  </div>
                ))}

                {/* Buttons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
                  {isLastQ && questionRevealed && isCodingQuestion(questions[currentQIdx]?.text || '') && (
                    <div style={{
                      padding: '8px 14px', borderRadius: '8px',
                      background: '#FFF7ED', border: '1px solid #FED7AA',
                      fontSize: '12px', color: '#92400E', textAlign: 'center',
                    }}>
                      🎙 <strong>Speak your approach</strong> while typing — recording captures both audio and your code
                    </div>
                  )}

                  {!isRecording && !questions[currentQIdx].recorded && (
                    <button style={S.btnRecord} onClick={startRecording}>
                      🔴 Start Recording
                    </button>
                  )}

                  {isRecording && (
                    <button
                      style={{ ...S.btnStop, opacity: recordingSeconds < 3 ? 0.5 : 1 }}
                      onClick={isLastQ ? handleStopLastAndShowSubmit : handleStopAndNext}
                      disabled={recordingSeconds < 3}
                    >
                      {isLastQ
                        ? `⏹ Stop Recording (${formatTime(recordingSeconds)})`
                        : `⏹ Stop & Next Question (${formatTime(recordingSeconds)})`}
                    </button>
                  )}

                  {isLastQ && questions[currentQIdx].recorded && !isRecording && (
<button style={S.btnSubmit} onClick={() => handleSubmit(questions)} disabled={isSubmitting}>
                      ✅ Submit Interview
                    </button>
                  )}
                </div>
              </div>

              {/* RIGHT — camera + mic panel */}
              <div style={S.rightPanel}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'10px' }}>
                  <span style={{ fontSize:'12px', fontWeight:700, color:'#374151', letterSpacing:'0.04em' }}>YOUR CAMERA</span>
                  <div style={{
                    display:'flex', alignItems:'center', gap:'5px',
                    background: isRecording ? '#FEF2F2' : '#F3F4F6',
                    border:`1px solid ${isRecording ? '#FECACA' : '#E5E7EB'}`,
                    borderRadius:'999px', padding:'3px 10px',
                  }}>
                    <span style={{
                      width:'7px', height:'7px', borderRadius:'50%',
                      background: isRecording ? '#DC2626' : '#9CA3AF',
                      animation: isRecording ? 'pulse 1s infinite' : 'none', flexShrink:0,
                    }} />
                    <span style={{ fontSize:'11px', fontWeight:700, color: isRecording ? '#DC2626' : '#6B7280' }}>
                      {isRecording ? `REC ${formatTime(recordingSeconds)}` : 'STANDBY'}
                    </span>
                  </div>
                </div>

                <div style={{
                  position:'relative', borderRadius:'12px', overflow:'hidden',
                  background:'#0F172A', aspectRatio:'4/3',
                  border: interviewCameraError ? '2px solid #EF4444' : isRecording ? '2px solid #DC2626' : '2px solid #E5E7EB',
                  boxShadow: interviewCameraError ? '0 0 0 3px rgba(239,68,68,0.15)' : isRecording ? '0 0 0 3px rgba(220,38,38,0.12)' : 'none',
                  transition:'border-color 0.3s, box-shadow 0.3s',
                }}>
                  <video ref={videoRef} autoPlay muted playsInline style={S.video} />
                  {interviewCameraError && (
                    <div style={{
                      position:'absolute', inset:0, background:'rgba(0,0,0,0.55)',
                      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'16px', textAlign:'center',
                    }}>
                      <div style={{
                        width:'44px', height:'44px', borderRadius:'50%', background:'rgba(239,68,68,0.9)',
                        display:'flex', alignItems:'center', justifyContent:'center', fontSize:'22px', marginBottom:'10px',
                        boxShadow:'0 0 0 6px rgba(239,68,68,0.25)',
                      }}>⚠️</div>
                      <p style={{ color:'white', fontSize:'12px', fontWeight:700, margin:'0 0 4px', lineHeight:1.4 }}>{interviewCameraError}</p>
                      <p style={{ color:'rgba(255,255,255,0.65)', fontSize:'10px', margin:0 }}>Please look directly at the camera</p>
                    </div>
                  )}
                  {!interviewCameraError && (
                    <div style={{
                      position:'absolute', top:'8px', right:'8px',
                      background:'rgba(22,163,74,0.85)', color:'white',
                      fontSize:'10px', fontWeight:700, padding:'3px 8px',
                      borderRadius:'999px', display:'flex', alignItems:'center', gap:'4px',
                    }}>
                      <span>✓</span> Face OK
                    </div>
                  )}
                </div>

                <div style={{
                  marginTop:'8px', padding:'8px 12px', borderRadius:'8px',
                  background: interviewCameraError ? '#FEF2F2' : '#F0FDF4',
                  border:`1px solid ${interviewCameraError ? '#FECACA' : '#86EFAC'}`,
                  display:'flex', alignItems:'center', gap:'8px',
                }}>
                  <div style={{
                    width:'28px', height:'28px', borderRadius:'50%', flexShrink:0,
                    background: interviewCameraError ? '#FEE2E2' : '#DCFCE7',
                    display:'flex', alignItems:'center', justifyContent:'center', fontSize:'14px',
                  }}>
                    {interviewCameraError ? '😶' : '🙂'}
                  </div>
                  <div>
                    <p style={{ margin:0, fontSize:'11px', fontWeight:700, color: interviewCameraError ? '#B91C1C' : '#15803D' }}>
                      {interviewCameraError ? 'Face not detected' : 'Face detected'}
                    </p>
                    <p style={{ margin:0, fontSize:'10px', color: interviewCameraError ? '#DC2626' : '#16A34A' }}>
                      {interviewCameraError ? 'Look directly at the camera' : 'AI can see you clearly'}
                    </p>
                  </div>
                </div>

                <div style={{ marginTop:'12px', padding:'12px 14px', background:'#F8FAFC', border:'1px solid #E2E8F0', borderRadius:'10px' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'8px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                      <span style={{ fontSize:'14px' }}>🎙</span>
                      <span style={{ fontSize:'12px', fontWeight:700, color:'#374151' }}>Microphone</span>
                    </div>
                    <span style={{
                      fontSize:'10px', fontWeight:700, padding:'2px 8px', borderRadius:'999px',
                      background: micLevel > 10 ? '#DCFCE7' : '#FEE2E2',
                      color:      micLevel > 10 ? '#15803D' : '#B91C1C',
                    }}>
                      {micLevel > 10 ? '● LIVE' : '○ SILENT'}
                    </span>
                  </div>
                  <div style={{ display:'flex', alignItems:'flex-end', gap:'3px', height:'28px' }}>
                    {Array.from({ length: 20 }).map((_, i) => {
                      const active   = micLevel >= (i + 1) * 5;
                      const barColor = i < 8 ? '#22C55E' : i < 14 ? '#F59E0B' : '#EF4444';
                      return (
                        <div key={i} style={{
                          flex:1, height:`${38 + i * 3}%`, borderRadius:'2px',
                          background: active ? barColor : '#E2E8F0', transition:'background 0.08s',
                        }} />
                      );
                    })}
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', marginTop:'5px' }}>
                    <span style={{ fontSize:'9px', color:'#94A3B8' }}>Silent</span>
                    <span style={{ fontSize:'9px', color:'#94A3B8' }}>Loud</span>
                  </div>
                  {micLevel <= 2 && (
                    <div style={{
                      marginTop:'8px', padding:'6px 10px',
                      background:'#FEF2F2', border:'1px solid #FECACA',
                      borderRadius:'6px', fontSize:'10px', color:'#DC2626', fontWeight:600, textAlign:'center',
                    }}>
                      ⚠️ No audio — check microphone
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════
            COMPLETED
        ════════════════════════════════════════════════════ */}
        {stage === 'completed' && !isSubmitting && (
          <div style={{ width: '100%', maxWidth: '680px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

            <div style={{
              background: 'white', border: '1px solid #E5E7EB',
              borderRadius: '20px', padding: '36px 32px',
              textAlign: 'center', position: 'relative', overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: '4px',
                background: 'linear-gradient(90deg, #7C3AED, #A855F7, #06B6D4)',
              }} />
              <div style={{
                width: '72px', height: '72px', borderRadius: '50%',
                background: 'linear-gradient(135deg, #059669, #10B981)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '32px', margin: '0 auto 20px',
                boxShadow: '0 0 0 8px rgba(16,185,129,0.12), 0 8px 24px rgba(16,185,129,0.25)',
                animation: 'popIn 0.5s cubic-bezier(0.175,0.885,0.32,1.275)',
              }}>✓</div>
              <h1 style={{ fontSize: '26px', fontWeight: 800, color: '#111827', margin: '0 0 8px', letterSpacing: '-0.03em' }}>
                Interview Submitted!
              </h1>
              <p style={{ fontSize: '15px', color: '#6B7280', margin: '0 0 4px', lineHeight: 1.6 }}>
                Great work, <strong style={{ color: '#7C3AED' }}>{nameInput || candidate.candidateName}</strong>!
                Your responses have been securely recorded and submitted.
              </p>
              <p style={{ fontSize: '12px', color: '#9CA3AF', margin: 0 }}>
                Submitted on {submittedAt} · {candidate.jobRole}
              </p>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '12px',
                marginTop: '24px', padding: '14px 20px',
                background: 'linear-gradient(135deg, #F5F3FF, #EDE9FE)',
                border: '1px solid #DDD6FE', borderRadius: '14px',
              }}>
                <span style={{ fontSize: '24px' }}>📩</span>
                <div style={{ textAlign: 'left' }}>
                  <p style={{ margin: '0 0 2px', fontSize: '13px', fontWeight: 700, color: '#5B21B6' }}>
                    Our team will review your interview
                  </p>
                  <p style={{ margin: 0, fontSize: '12px', color: '#7C3AED' }}>
                    If selected, HR will contact you for the next round
                  </p>
                </div>
              </div>
            </div>

            <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '16px', padding: '24px 28px' }}>
              <h3 style={{ margin: '0 0 20px', fontSize: '14px', fontWeight: 700, color: '#111827' }}>What happens next?</h3>
              {([
                { icon: '✅', bg: '#F0FDF4', border: '#A7F3D0', title: 'Interview submitted successfully', sub: 'Your responses have been securely recorded', done: true },
                { icon: '🤖', bg: '#F0F9FF', border: '#BAE6FD', title: 'AI evaluation complete', sub: 'Your responses are being evaluated', done: true },
                { icon: '👥', bg: '#FFFBEB', border: '#FDE68A', title: 'Panel review', sub: 'HR and hiring panel will review your interview', done: false },
                { icon: '📧', bg: '#F0FDF4', border: '#A7F3D0', title: "You'll hear from us", sub: `We'll reach out to ${candidate.candidateEmail}`, done: false },
              ] as Array<{ icon: string; bg: string; border: string; title: string; sub: string; done: boolean }>
              ).map((step, i) => (
                <div key={i} style={{ display: 'flex', gap: '14px', marginBottom: i < 3 ? '16px' : 0 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{
                      width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
                      background: step.bg, border: `1px solid ${step.border}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px',
                    }}>{step.icon}</div>
                    {i < 3 && <div style={{ width: '1px', flex: 1, background: '#E5E7EB', margin: '4px 0' }} />}
                  </div>
                  <div style={{ paddingTop: '6px', paddingBottom: i < 3 ? '12px' : 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                      <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: '#111827' }}>{step.title}</p>
                      {step.done && (
                        <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 6px', background: '#DCFCE7', color: '#15803D', borderRadius: '999px' }}>DONE</span>
                      )}
                    </div>
                    <p style={{ margin: 0, fontSize: '12px', color: '#6B7280' }}>{step.sub}</p>
                  </div>
                </div>
              ))}
            </div>

            {uploadedVideoUrls.length > 0 && (
              <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '16px', padding: '24px 28px' }}>
                <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: 700, color: '#111827' }}>
                  🎬 Recorded Answers ({uploadedVideoUrls.length}/{questions.length})
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {questions.map((q, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '10px 14px', borderRadius: '10px',
                      background: uploadedVideoUrls[i] ? '#F0FDF4' : '#F9FAFB',
                      border: `1px solid ${uploadedVideoUrls[i] ? '#86EFAC' : '#E5E7EB'}`,
                    }}>
                      <div style={{
                        width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                        background: uploadedVideoUrls[i] ? '#16A34A' : '#E5E7EB',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '11px', color: 'white', fontWeight: 700,
                      }}>
                        {uploadedVideoUrls[i] ? '✓' : i + 1}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: '12px', fontWeight: 600, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          Q{i + 1}: {q.text}
                        </p>
                        <p style={{ margin: 0, fontSize: '10px', color: uploadedVideoUrls[i] ? '#16A34A' : '#9CA3AF' }}>
                          {uploadedVideoUrls[i] ? 'Uploaded to Cloudinary ✓' : 'Upload pending'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p style={{ textAlign: 'center', fontSize: '12px', color: '#9CA3AF' }}>
              You may safely close this tab. Good luck! 🍀
            </p>
          </div>
        )}

      </main>

      <style>{`
        @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes spin   { to{transform:rotate(360deg)} }
        @keyframes popIn  { from{transform:scale(0.5);opacity:0} to{transform:scale(1);opacity:1} }
      `}</style>
    </div>
  );
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '10px 14px', borderRadius: '8px',
      background: ok ? '#F0FDF4' : '#F9FAFB',
      border: `1px solid ${ok ? '#86EFAC' : '#E5E7EB'}`,
    }}>
      <div style={{
        width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
        background: ok ? '#16A34A' : '#E5E7EB',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '11px', color: 'white', fontWeight: 700,
      }}>
        {ok ? '✓' : '?'}
      </div>
      <span style={{ fontSize: '13px', color: ok ? '#16A34A' : '#6B7280', fontWeight: ok ? 600 : 400 }}>
        {label}
      </span>
    </div>
  );
}

function FullScreen({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#F5F6FA', padding: '2rem', textAlign: 'center',
    }}>
      <div style={{ fontSize: '3rem', marginBottom: '16px' }}>{icon}</div>
      <h1 style={{ color: '#111827', fontSize: '1.6rem', fontWeight: 700, marginBottom: '12px' }}>{title}</h1>
      <p style={{ color: '#6B7280', maxWidth: '420px', lineHeight: 1.7 }}>{body}</p>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {
  root:     { minHeight: '100vh', background: '#F5F6FA', color: '#111827', fontFamily: "'Segoe UI', system-ui, sans-serif", display: 'flex', flexDirection: 'column' },
  header:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', background: 'white', borderBottom: '1px solid #E5E7EB' },
  logo:     { display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '16px', color: '#111827' },
  logoDot:  { width: '10px', height: '10px', borderRadius: '50%', background: '#7C3AED', display: 'inline-block' },
  recBadge: { display: 'flex', alignItems: 'center', gap: '6px', background: '#FEF2F2', border: '1px solid #FECACA', color: '#DC2626', fontSize: '12px', fontWeight: 700, padding: '4px 12px', borderRadius: '999px' },
  recDot:   { width: '8px', height: '8px', borderRadius: '50%', background: '#DC2626', animation: 'pulse 1s infinite' },
  main:     { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' },
  card:     { background: 'white', border: '1px solid #E5E7EB', borderRadius: '16px', padding: '32px', maxWidth: '520px', width: '100%' },
  cardTitle:{ fontSize: '22px', fontWeight: 700, color: '#111827', marginBottom: '8px', letterSpacing: '-0.02em' },
  cardSub:  { fontSize: '14px', color: '#6B7280', lineHeight: 1.7, marginBottom: '20px' },
  rulesBox: { background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '10px', padding: '14px 16px', marginBottom: '20px', display: 'flex', flexDirection: 'column', gap: '8px' },
  ruleRow:  { display: 'flex', alignItems: 'flex-start', gap: '10px' },
  label:    { display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px' },
  input:    { width: '100%', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '8px', padding: '10px 14px', color: '#111827', fontSize: '14px', outline: 'none', boxSizing: 'border-box' },
  errText:  { color: '#EF4444', fontSize: '12px', marginTop: '6px' },
  errorBox: { background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: '#DC2626', marginBottom: '16px' },
  warnBox:  { background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: '#92400E', marginBottom: '14px' },
  btnPrimary: { width: '100%', background: '#7C3AED', color: 'white', border: 'none', borderRadius: '8px', padding: '13px 24px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', marginTop: '4px' },
  videoBox: { position: 'relative', borderRadius: '12px', overflow: 'hidden', background: '#000', aspectRatio: '16/9', marginBottom: '14px' },
  video:    { width: '100%', height: '100%', objectFit: 'cover', display: 'block', transform: 'scaleX(-1)' },
  micBarBg: { width: '100%', height: '10px', background: '#E5E7EB', borderRadius: '999px', overflow: 'hidden' },
  micBarFill: { height: '100%', borderRadius: '999px', transition: 'width 0.1s ease, background 0.3s' },
  checkGrid:  { display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' },
  spinner:  { width: '36px', height: '36px', border: '3px solid #E5E7EB', borderTop: '3px solid #7C3AED', borderRadius: '50%', margin: '16px auto 0', animation: 'spin 1s linear infinite' },
  interviewLayout: { display: 'flex', gap: '20px', width: '100%', maxWidth: '1100px', alignItems: 'flex-start' },
  leftPanel:  { flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', background: 'white', borderRadius: '16px', border: '1px solid #E5E7EB', padding: '24px' },
  rightPanel: { width: '340px', flexShrink: 0, background: 'white', borderRadius: '16px', border: '1px solid #E5E7EB', padding: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  qCounter:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  qDots:      { display: 'flex', gap: '6px' },
  qDot:       { width: '10px', height: '10px', borderRadius: '50%' },
  questionBox:{ background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: '12px', padding: '18px 20px' },
  qLabel:     { fontSize: '11px', fontWeight: 700, color: '#7C3AED', marginBottom: '8px', letterSpacing: '0.06em' },
  qText:      { fontSize: '16px', fontWeight: 600, color: '#111827', lineHeight: 1.6, margin: 0 },
  instructBox:{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '8px', padding: '10px 14px' },
  answeredCard:{ background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: '8px', padding: '10px 14px' },
  btnRecord:  { width: '100%', background: '#DC2626', color: 'white', border: 'none', borderRadius: '8px', padding: '13px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' },
  btnStop:    { width: '100%', background: '#1F2937', color: 'white', border: 'none', borderRadius: '8px', padding: '13px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' },
  btnSubmit:  { width: '100%', background: '#059669', color: 'white', border: 'none', borderRadius: '8px', padding: '13px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' },
  scoreCard:  { background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: '12px', padding: '20px', marginTop: '20px', textAlign: 'center' },
};