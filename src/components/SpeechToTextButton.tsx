import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, Loader2, AlertTriangle } from "lucide-react";
import SpeechToElementImport from "speech-to-element";

// Handle CJS default export interop — Vite dev may wrap it as { default: class }
const SpeechToElement =
  (SpeechToElementImport as any).default || SpeechToElementImport;
import { useJobs } from "@/lib/JobsContext";

export function SpeechToTextButton() {
  const { spawnVoiceJob, spawning, activeJobs } = useJobs();
  // Evaluated after mount so SSR and first client render both start as false,
  // preventing React hydration mismatch from module-level window access.
  const [isSpeechSupported, setIsSpeechSupported] = useState(false);
  useEffect(() => {
    setIsSpeechSupported(
      !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    );
  }, []);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [targetSessionId, setTargetSessionId] = useState<string | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // Close preview on outside click
  useEffect(() => {
    if (!showPreview) return;
    const handler = (e: MouseEvent) => {
      if (previewRef.current && !previewRef.current.contains(e.target as Node)) {
        setShowPreview(false);
        if (isRecording) {
          SpeechToElement.stop();
          setIsRecording(false);
        }
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPreview, isRecording]);

  const handleToggle = useCallback(() => {
    if (isRecording) {
      // Stop recording and submit
      SpeechToElement.stop();
      setIsRecording(false);

      const text = textRef.current?.textContent?.trim() || "";
      if (text) {
        setTranscript(text);
        spawnVoiceJob(text, targetSessionId || undefined);
        setTimeout(() => {
          if (textRef.current) textRef.current.textContent = "";
          setTranscript("");
          setShowPreview(false);
          setTargetSessionId(null);
        }, 1500);
      } else {
        setShowPreview(false);
      }
    } else {
      // Start recording — reset target session
      setShowPreview(true);
      setTranscript("");
      setTargetSessionId(null);
      setSpeechError(null);
      if (textRef.current) textRef.current.textContent = "";

      if (!isSpeechSupported) {
        setSpeechError(
          "Speech recognition is not supported in this browser. Use Chrome or Edge for voice commands."
        );
        return;
      }

      setTimeout(() => {
        SpeechToElement.toggle("webspeech", {
          element: textRef.current!,
          displayInterimResults: true,
          textColor: {
            interim: "var(--text-muted)",
            final: "var(--text-primary)",
          },
          onStart: () => {
            setIsRecording(true);
          },
          onStop: () => {
            setIsRecording(false);
          },
          onResult: (text: string) => {
            setTranscript(text);
          },
          onError: (err: string) => {
            setIsRecording(false);
            setSpeechError(err || "Microphone access denied or speech recognition failed.");
          },
        });
      }, 100);
    }
  }, [isRecording, isSpeechSupported, spawnVoiceJob, targetSessionId]);

  return (
    <div className="relative" ref={previewRef}>
      {/* Mic button in sidebar */}
      <button
        onClick={handleToggle}
        disabled={spawning}
        className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all ${
          isRecording
            ? "recording-glow text-red-400"
            : spawning
              ? "text-[var(--text-muted)] opacity-50"
              : "text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-tertiary)]"
        }`}
        title={
          isRecording
            ? "Click to stop & submit"
            : spawning
              ? "Spawning job..."
              : "Record"
        }
      >
        {spawning ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <Mic size={18} />
        )}
      </button>

      {/* Recording popup */}
      {showPreview && (
        <div className="absolute bottom-full left-0 mb-2 w-80 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-lg z-50 overflow-hidden">
          {/* Header */}
          <div className="px-3 py-2 border-b border-[var(--border)] flex items-center justify-between">
            <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
              Voice Command
            </span>
            {activeJobs.length > 0 && (
              <select
                value={targetSessionId || ""}
                onChange={(e) => setTargetSessionId(e.target.value || null)}
                className="text-[10px] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border)] rounded px-1.5 py-0.5 outline-none"
              >
                <option value="">New session</option>
                {activeJobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.id.substring(0, 8)}... ({job.agent})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Recording state */}
          <div className="flex flex-col items-center gap-3 px-4 py-5">
            {isRecording ? (
              <>
                {/* Large red glowing mic */}
                <button
                  onClick={handleToggle}
                  className="recording-glow w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center transition-all hover:bg-red-500/30"
                >
                  <Mic size={32} className="text-red-400" />
                </button>
                <span className="text-sm font-semibold text-red-400">
                  Recording
                </span>
              </>
            ) : transcript ? (
              <>
                <Loader2 size={24} className="text-[var(--accent)] animate-spin" />
                <span className="text-xs text-[var(--accent)]">
                  Submitting...
                </span>
              </>
            ) : speechError ? (
              <>
                <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
                  <AlertTriangle size={24} className="text-red-400" />
                </div>
                <span className="text-xs text-red-400 text-center px-2">
                  {speechError}
                </span>
              </>
            ) : (
              <>
                <div className="w-16 h-16 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center">
                  <Loader2 size={24} className="text-[var(--text-muted)] animate-spin" />
                </div>
                <span className="text-xs text-[var(--text-muted)]">
                  Starting...
                </span>
              </>
            )}
          </div>

          {/* Live transcript */}
          <div className="px-4 pb-3 min-h-[24px]">
            <div
              ref={textRef}
              className="text-sm text-[var(--text-primary)] leading-relaxed text-center"
              style={{ minHeight: "1.2em" }}
            />
          </div>

          {/* Stop hint */}
          {isRecording && (
            <div className="px-3 py-1.5 border-t border-[var(--border)] bg-[var(--bg-tertiary)]/50">
              <p className="text-[10px] text-[var(--text-muted)] text-center">
                Click the mic to stop & submit
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
