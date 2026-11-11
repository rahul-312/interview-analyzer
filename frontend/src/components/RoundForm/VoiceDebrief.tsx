'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import Button from '../ui/Button';
import { ErrorMessage, Spinner } from '../ui/Feedback';
import { useUsage } from '@/hooks/useUsage';
import type { DebriefDraft } from '@/models/Interview';
import { roundService } from '@/services/RoundService';
import { errorText } from '@/utils/errorText';

/** Recording stops by itself after this long, which keeps the upload well under the server's limit. */
const MAX_SECONDS = 10 * 60;
const MIN_SECONDS = 3;

// Opus in Ogg or WebM where the browser can record it (Chrome, Edge, Firefox); MP4 for Safari.
const MIME_TYPES = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

type Phase = 'idle' | 'recording' | 'working';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function micError(err: unknown) {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return "Microphone access is blocked. Allow it for this site in your browser's settings, then try again.";
  if (name === 'NotFoundError') return 'No microphone was found.';
  return "Couldn't start the microphone.";
}

interface VoiceDebriefProps {
  /** Gets the written-up draft; the caller merges it into the form. */
  onDraft: (draft: DebriefDraft) => void;
}

/**
 * "Talk it through instead of typing": records a spoken recap of the round, sends it to the server
 * (Gemini writes it up), and hands back a draft debrief. Hidden when the plan has no AI or the
 * browser can't record.
 */
const VoiceDebrief: React.FC<VoiceDebriefProps> = ({ onDraft }) => {
  const { usage } = useUsage();
  const [supported, setSupported] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [filled, setFilled] = useState(false);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const discard = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);

  // Checked after mounting so the server render and the first client render match.
  useEffect(() => {
    setSupported(typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia));
  }, []);

  const release = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  // Closing the form mid-recording turns the microphone off and throws the recording away.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      discard.current = true;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      release();
    };
  }, []);

  const send = async (audio: Blob, length: number) => {
    if (length < MIN_SECONDS || audio.size === 0) {
      setPhase('idle');
      setError('That recording was too short. Try again and describe the round.');
      return;
    }
    setPhase('working');
    try {
      const draft = await roundService.debriefFromVoice(audio);
      if (!mounted.current) return;
      onDraft(draft);
      setFilled(true);
    } catch (err) {
      if (mounted.current) setError(errorText(err));
    } finally {
      if (mounted.current) setPhase('idle');
    }
  };

  const start = async () => {
    setError('');
    setFilled(false);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setError(micError(err));
      return;
    }
    const mimeType = MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream.current, { ...(mimeType && { mimeType }), audioBitsPerSecond: 32000 });
    chunks.current = [];
    discard.current = false;
    let elapsed = 0;

    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.current.push(e.data);
    };
    rec.onstop = () => {
      release();
      if (discard.current) {
        if (mounted.current) setPhase('idle');
        return;
      }
      void send(new Blob(chunks.current, { type: rec.mimeType || mimeType || 'audio/webm' }), elapsed);
    };

    recorder.current = rec;
    rec.start(1000);
    setSeconds(0);
    setPhase('recording');
    timer.current = setInterval(() => {
      elapsed += 1;
      setSeconds(elapsed);
      if (elapsed >= MAX_SECONDS && rec.state === 'recording') rec.stop();
    }, 1000);
  };

  const stop = (keep: boolean) => {
    discard.current = !keep;
    if (recorder.current?.state === 'recording') recorder.current.stop();
  };

  if (!supported || !usage?.ai_enabled) return null;

  return (
    <div className="flex flex-col gap-lg rounded-lg border border-primary-light bg-page-bg p-2xl">
      <div className="flex flex-wrap items-center justify-between gap-lg">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-charcoal-gray">Rather talk it through?</p>
          <p className="text-xs text-medium-gray">
            Describe the questions, how you answered, and how it went. We&apos;ll fill in the form for you to check.
          </p>
        </div>

        {phase === 'idle' && (
          <Button variant="secondary" onClick={start}>
            <Mic size={16} aria-hidden="true" />
            {filled ? 'Record more' : 'Fill in by voice'}
          </Button>
        )}

        {phase === 'recording' && (
          <div className="flex items-center gap-lg">
            <span role="status" className="flex items-center gap-md text-sm font-medium text-crimson-red">
              <span aria-hidden="true" className="h-[0.6em] w-[0.6em] animate-pulse rounded-full bg-crimson-red" />
              Recording {clock(seconds)}
              <span className="sr-only">, up to {MAX_SECONDS / 60} minutes</span>
            </span>
            <Button variant="link" onClick={() => stop(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => stop(true)}>
              <Square size={14} aria-hidden="true" />
              Done
            </Button>
          </div>
        )}

        {phase === 'working' && (
          <span role="status" className="flex items-center gap-md text-sm text-dark-gray">
            <Spinner className="text-primary" />
            Writing up your debrief…
          </span>
        )}
      </div>

      {filled && phase === 'idle' && (
        <p role="status" className="text-xs font-medium text-deep-green">
          Filled in from your recording. Check it over before you save.
        </p>
      )}
      <ErrorMessage message={error} />
    </div>
  );
};

export default VoiceDebrief;
