import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../api";
import { EmptyState, ErrorBanner } from "../components/States";
import SourceList from "../components/Sources";
import { Badge, Card, MetaRow } from "../components/ui";
import type { AssistantStatus, ChatResponse, ContextSource, TranscriptResponse } from "../types";

type VoiceState = "idle" | "requesting" | "listening" | "processing" | "speaking" | "error";
type MicPermission = "unknown" | "granted" | "denied" | "unavailable";

interface SpeechResultAlternative {
  transcript: string;
}
interface SpeechResult {
  isFinal: boolean;
  0: SpeechResultAlternative;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | null {
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

function readPreference(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

const STATUS_LABEL: Record<VoiceState, string> = {
  idle: "Ready",
  requesting: "Requesting microphone…",
  listening: "Listening…",
  processing: "Processing your question…",
  speaking: "Speaking…",
  error: "Needs attention",
};

export default function VoiceAssistant() {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [micPermission, setMicPermission] = useState<MicPermission>("unknown");
  const [transcript, setTranscript] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<ContextSource[]>([]);
  const [clarification, setClarification] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(() => readPreference("bee.voice.muted", "false") === "true");
  const [voiceName, setVoiceName] = useState(() => readPreference("bee.voice.name", ""));
  const [rate, setRate] = useState(() => Number(readPreference("bee.voice.rate", "1")) || 1);
  const [pitch, setPitch] = useState(() => Number(readPreference("bee.voice.pitch", "1")) || 1);
  const [wakePhrase, setWakePhrase] = useState(() =>
    readPreference("bee.voice.wakePhrase", "Hey Bee"),
  );
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [ttsSupported] = useState(
    () => typeof window !== "undefined" && "speechSynthesis" in window,
  );
  const [sttSupported] = useState(() => recognitionCtor() !== null);
  const [mediaSupported] = useState(
    () => typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia),
  );
  const [recordingSupported] = useState(
    () => typeof window !== "undefined" && "MediaRecorder" in window,
  );

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const activeRef = useRef(false);
  const finalTextRef = useRef("");
  const cancelledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<AssistantStatus>("/api/assistant/status")
      .then((value) => {
        if (cancelled) return;
        setStatus(value);
        if (!readPreference("bee.voice.wakePhrase", "")) {
          setWakePhrase(value.wake_word.phrase);
        }
      })
      .catch(() => {
        // The voice page remains usable with browser STT/TTS even if the status
        // endpoint is temporarily unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ttsSupported) return;
    const synth = window.speechSynthesis;
    const load = () => setVoices(synth.getVoices());
    load();
    synth.addEventListener?.("voiceschanged", load);
    return () => synth.removeEventListener?.("voiceschanged", load);
  }, [ttsSupported]);

  useEffect(() => {
    try {
      window.localStorage.setItem("bee.voice.muted", String(muted));
      window.localStorage.setItem("bee.voice.name", voiceName);
      window.localStorage.setItem("bee.voice.rate", String(rate));
      window.localStorage.setItem("bee.voice.pitch", String(pitch));
      window.localStorage.setItem("bee.voice.wakePhrase", wakePhrase);
    } catch {
      // Preferences are optional; private browsing can reject storage.
    }
  }, [muted, voiceName, rate, pitch, wakePhrase]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (ttsSupported) window.speechSynthesis.cancel();
    };
  }, [ttsSupported]);

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function speak(text: string) {
    if (!ttsSupported || muted || !text.trim()) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const selected = voices.find((voice) => voice.name === voiceName);
    if (selected) utterance.voice = selected;
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.onstart = () => setVoiceState("speaking");
    utterance.onend = () => setVoiceState("idle");
    utterance.onerror = () => {
      setVoiceState("error");
      setError("Speech playback failed. You can still read the answer below.");
    };
    synth.speak(utterance);
  }

  async function processQuestion(text: string) {
    const clean = text.trim();
    if (!clean) return;
    setVoiceState("processing");
    setError(null);
    setAnswer(null);
    setSources([]);
    setClarification(false);
    try {
      const response = await api.post<ChatResponse>("/api/assistant/chat", {
        message: clean,
      });
      setAnswer(response.answer);
      setSources(response.sources);
      setClarification(response.clarification_needed);
      setVoiceState("idle");
      speak(response.answer);
    } catch (caught) {
      setVoiceState("error");
      setError(errorMessage(caught));
    }
  }

  async function uploadRecording(blob: Blob) {
    if (cancelledRef.current || blob.size === 0) return;
    setVoiceState("processing");
    try {
      const form = new FormData();
      form.append("audio", blob, "recording.webm");
      const result = await api.upload<TranscriptResponse>("/api/assistant/transcribe", form);
      setTranscript(result.text);
      await processQuestion(result.text);
    } catch (caught) {
      setVoiceState("error");
      setError(errorMessage(caught));
    }
  }

  async function startListening() {
    if (activeRef.current || voiceState === "processing") return;
    if (!mediaSupported) {
      setMicPermission("unavailable");
      setVoiceState("error");
      setError(
        "This browser does not expose microphone access (navigator.mediaDevices.getUserMedia). Use a current Chromium, Edge, or Safari browser over HTTPS or localhost.",
      );
      return;
    }
    if (!sttSupported && !(recordingSupported && status?.configured)) {
      setVoiceState("error");
      setError(
        "This browser has no SpeechRecognition API, and the server transcription provider is not configured. Use a supported browser or configure the server STT provider.",
      );
      return;
    }

    activeRef.current = true;
    cancelledRef.current = false;
    finalTextRef.current = "";
    setTranscript("");
    setAnswer(null);
    setSources([]);
    setError(null);
    setVoiceState("requesting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setMicPermission("granted");
    } catch (caught) {
      activeRef.current = false;
      const name = caught instanceof DOMException ? caught.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setMicPermission("denied");
        setError(
          "Microphone permission was denied. Allow microphone access in the browser site settings, then try again.",
        );
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setMicPermission("unavailable");
        setError("No microphone was found. Connect a microphone or headset and try again.");
      } else {
        setError("The microphone could not be opened. Check your browser and operating system permissions.");
      }
      setVoiceState("error");
      return;
    }

    const Ctor = recognitionCtor();
    if (Ctor) {
      const recognition = new Ctor();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.onstart = () => setVoiceState("listening");
      recognition.onresult = (event) => {
        let interim = "";
        let finalText = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const text = result?.[0]?.transcript ?? "";
          if (result.isFinal) finalText += text;
          else interim += text;
        }
        if (finalText) finalTextRef.current += finalText;
        setTranscript((finalTextRef.current + interim).trim());
      };
      recognition.onerror = (event) => {
        activeRef.current = false;
        stopStream();
        const code = event.error ?? "";
        if (code === "not-allowed" || code === "service-not-allowed") {
          setMicPermission("denied");
          setError("Microphone permission was denied by the browser.");
        } else if (code === "no-speech") {
          setError("No speech was detected. Try again and speak a little closer to the microphone.");
          setVoiceState("idle");
          return;
        } else if (code === "network") {
          setError(
            "The browser's speech recognition service is unavailable. Configure server STT or try again.",
          );
        } else {
          setError(`Speech recognition failed (${code || "unknown error"}).`);
        }
        setVoiceState("error");
      };
      recognition.onend = () => {
        stopStream();
        activeRef.current = false;
        if (cancelledRef.current) return;
        const text = finalTextRef.current.trim();
        if (text) void processQuestion(text);
        else setVoiceState((current) => (current === "listening" ? "idle" : current));
      };
      recognitionRef.current = recognition;
      try {
        recognition.start();
      } catch {
        activeRef.current = false;
        stopStream();
        setVoiceState("error");
        setError("Speech recognition could not start. Stop any other recording and try again.");
      }
      return;
    }

    if (!recordingSupported) {
      activeRef.current = false;
      stopStream();
      setVoiceState("error");
      setError("This browser cannot record audio. Use a supported browser.");
      return;
    }

    const recorder = new MediaRecorder(streamRef.current as MediaStream);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      stopStream();
      activeRef.current = false;
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      if (!cancelledRef.current) void uploadRecording(blob);
    };
    recorderRef.current = recorder;
    recorder.start();
    setVoiceState("listening");
  }

  function stopListening() {
    if (!activeRef.current) return;
    activeRef.current = false;
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    } else if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }

  function cancel() {
    cancelledRef.current = true;
    activeRef.current = false;
    recognitionRef.current?.abort();
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    stopStream();
    if (ttsSupported) window.speechSynthesis.cancel();
    setTranscript("");
    setAnswer(null);
    setSources([]);
    setClarification(false);
    setError(null);
    setVoiceState("idle");
  }

  async function requestMicPermission() {
    if (!mediaSupported) {
      setMicPermission("unavailable");
      setError("Microphone access is not available in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicPermission("granted");
      setError(null);
    } catch (caught) {
      const name = caught instanceof DOMException ? caught.name : "";
      setMicPermission(name === "NotAllowedError" ? "denied" : "unavailable");
      setError("Microphone permission was not granted. Check the browser site settings.");
    }
  }

  const listening = voiceState === "listening" || voiceState === "requesting";

  return (
    <div className="page-stack">
      <Card
        title="Voice assistant"
        subtitle="Push-to-talk with browser speech recognition, grounded answers, and browser text-to-speech."
        actions={
          status ? (
            <Badge tone={status.configured ? "success" : "warning"}>
              {status.configured ? `AI: ${status.model}` : "AI provider not configured"}
            </Badge>
          ) : null
        }
      >
        <div className="voice-status" aria-live="polite">
          <span className={`voice-dot ${voiceState}`} aria-hidden="true" />
          <strong>{STATUS_LABEL[voiceState]}</strong>
          <span className="muted small">
            Microphone: {micPermission === "unknown" ? "not requested yet" : micPermission}
          </span>
        </div>

        <div className="voice-controls">
          <button
            type="button"
            className={`button primary talk-button ${listening ? "active" : ""}`}
            aria-pressed={listening}
            aria-label="Hold to talk"
            onPointerDown={() => void startListening()}
            onPointerUp={stopListening}
            onPointerCancel={stopListening}
            onMouseDown={() => void startListening()}
            onMouseUp={stopListening}
            onMouseLeave={() => {
              if (listening) stopListening();
            }}
            onKeyDown={(event) => {
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                void startListening();
              }
            }}
            onKeyUp={(event) => {
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                stopListening();
              }
            }}
            disabled={voiceState === "processing"}
          >
            {listening ? "Listening…" : "Hold to talk"}
          </button>
          <button type="button" className="button secondary" onClick={stopListening} disabled={!listening}>
            Stop
          </button>
          <button
            type="button"
            className="button ghost"
            onClick={cancel}
            disabled={!listening && !answer && voiceState === "idle"}
          >
            Cancel
          </button>
          <button type="button" className="button ghost" onClick={() => void requestMicPermission()}>
            Allow microphone
          </button>
        </div>

        <p className="muted small">
          Press and hold, speak, then release. Sending starts only after you activate the
          microphone. Audio is not stored by this app; the browser speech service may process
          it according to that browser's policy.
        </p>

        {!sttSupported ? (
          <div className="inline-alert warning" role="status">
            <div>
              <strong>Browser speech recognition is not available</strong>
              <p className="small">
                {recordingSupported && status?.configured
                  ? "Recording will upload audio to the configured server STT provider for transcription."
                  : "Use a supported browser or configure the server STT provider (AI_API_KEY + AI_STT_MODEL)."}
              </p>
            </div>
          </div>
        ) : null}

        {error ? <ErrorBanner message={error} /> : null}

        {transcript ? (
          <div className="transcript-block">
            <h3>You said</h3>
            <p>{transcript}</p>
          </div>
        ) : null}

        {voiceState === "processing" ? (
          <p className="muted" role="status">
            Retrieving your records and asking the AI provider…
          </p>
        ) : null}

        {answer ? (
          <div className="answer-block" aria-live="polite">
            <div className="answer-head">
              <h3>{clarification ? "More context needed" : "Answer"}</h3>
              <div className="audio-controls" aria-label="Speech playback controls">
                <button type="button" className="button ghost small" onClick={() => speak(answer)}>
                  Play
                </button>
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => {
                    if (ttsSupported) window.speechSynthesis.pause();
                  }}
                  disabled={!ttsSupported}
                >
                  Pause
                </button>
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => {
                    if (ttsSupported) window.speechSynthesis.resume();
                  }}
                  disabled={!ttsSupported}
                >
                  Resume
                </button>
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => {
                    if (ttsSupported) window.speechSynthesis.cancel();
                    setVoiceState("idle");
                  }}
                  disabled={!ttsSupported}
                >
                  Stop
                </button>
                <label className="checkbox-inline">
                  <input
                    type="checkbox"
                    checked={muted}
                    onChange={(event) => {
                      setMuted(event.target.checked);
                      if (event.target.checked && ttsSupported) window.speechSynthesis.cancel();
                    }}
                  />
                  Mute
                </label>
              </div>
            </div>
            <p className="voice-answer">{answer}</p>
            <SourceList sources={sources} />
          </div>
        ) : null}

        {!answer && !error && voiceState === "idle" && !transcript ? (
          <EmptyState
            title="Your voice is the input"
            description="Hold the button and ask a question. The transcript is matched against stored records; answers include source links, and missing evidence is called out."
          />
        ) : null}
      </Card>

      <div className="grid-2">
        <Card title="Audio preferences">
          <label className="field">
            <span>Browser voice</span>
            <select
              value={voiceName}
              onChange={(event) => setVoiceName(event.target.value)}
              disabled={!ttsSupported}
            >
              <option value="">System default</option>
              {voices.map((voice) => (
                <option key={voice.name} value={voice.name}>
                  {voice.name} ({voice.lang})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Speaking rate: {rate.toFixed(1)}×</span>
            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.1"
              value={rate}
              onChange={(event) => setRate(Number(event.target.value))}
              disabled={!ttsSupported}
            />
          </label>
          <label className="field">
            <span>Pitch: {pitch.toFixed(1)}</span>
            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.1"
              value={pitch}
              onChange={(event) => setPitch(Number(event.target.value))}
              disabled={!ttsSupported}
            />
          </label>
          <p className="muted small">
            Playback uses the operating system's current output device, including Bluetooth
            earbuds and external speakers. The browser does not let the web app choose the
            hardware device directly.
          </p>
        </Card>

        <Card title="Wake phrase and platform limits">
          <label className="field">
            <span>Activation phrase (stored on this device)</span>
            <input
              type="text"
              value={wakePhrase}
              maxLength={40}
              onChange={(event) => setWakePhrase(event.target.value)}
            />
          </label>
          <div className="badge-row">
            <Badge tone={status?.wake_word.available ? "warning" : "neutral"}>
              engine: {status?.wake_word.engine ?? "unknown"}
            </Badge>
            <Badge tone="neutral">local engine bundled: no</Badge>
          </div>
          <p className="muted small">
            Wake-word detection is not active in this build. No local wake-word engine is
            bundled, and continuous microphone audio is intentionally not streamed to a cloud
            provider just to detect a phrase. Use push-to-talk above. Reliable background
            detection needs a native/mobile companion or an on-device wake-word engine.
          </p>
          <MetaRow label="Text to speech">
            {ttsSupported ? "browser speech synthesis" : "unavailable"}
          </MetaRow>
          <MetaRow label="Speech to text">
            {sttSupported
              ? "browser SpeechRecognition"
              : recordingSupported && status?.configured
                ? "server provider after recording"
                : "unavailable"}
          </MetaRow>
          <p className="muted small">
            Browsers pause or suspend microphone and speech APIs when a tab is inactive,
            suspended, or closed. There is no reliable background wake word in a plain web tab.
          </p>
        </Card>
      </div>
    </div>
  );
}
