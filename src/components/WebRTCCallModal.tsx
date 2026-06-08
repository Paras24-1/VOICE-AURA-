"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Mic, MicOff, PhoneOff, Volume2, Wifi, WifiOff, AlertCircle, Loader2, X } from "lucide-react";

interface WebRTCCallModalProps {
  agentId: string;
  agentName: string;
  onClose: () => void;
}

type CallState = "idle" | "requesting_mic" | "connecting" | "connected" | "ended" | "error";

// The WebSocket server runs on port 5050 (server.js)
const WS_SERVER_URL =
  process.env.NEXT_PUBLIC_WS_URL ||
  (typeof window !== "undefined"
    ? `ws://${window.location.hostname}:5050/webRTC-stream`
    : "ws://localhost:5050/webRTC-stream");

export default function WebRTCCallModal({ agentId, agentName, onClose }: WebRTCCallModalProps) {
  const [callState, setCallState] = useState<CallState>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [statusText, setStatusText] = useState("Tap to start call");
  const [elapsedTime, setElapsedTime] = useState(0);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const volumeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const audioOutContextRef = useRef<AudioContext | null>(null);
  const isMutedRef = useRef(false);

  // Keep isMuted ref in sync
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const cleanup = useCallback(() => {
    // Stop mic stream tracks
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    // Disconnect audio processor
    processorRef.current?.disconnect();
    processorRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;

    // Close audio contexts
    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    audioOutContextRef.current?.close().catch(() => {});
    audioOutContextRef.current = null;

    // Close WebSocket
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      wsRef.current.close();
    }
    wsRef.current = null;

    // Clear timers
    if (timerRef.current) clearInterval(timerRef.current);
    if (volumeTimerRef.current) clearInterval(volumeTimerRef.current);
  }, []);

  // Float32 PCM → 16-bit PCM buffer
  function float32ToPcm16(float32Array: Float32Array): Int16Array {
    const pcm = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const clamped = Math.max(-1, Math.min(1, float32Array[i]));
      pcm[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
    }
    return pcm;
  }

  // ArrayBuffer → base64
  function arrayBufferToBase64(buffer: ArrayBufferLike): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  // base64 → Float32 PCM (16kHz linear PCM from server)
  function base64ToPcm16(base64: string): Int16Array {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Int16Array(bytes.buffer);
  }

  // Play audio received from the server (Gemini response — 24kHz PCM16)
  const playAudio = useCallback(async (base64Audio: string, sampleRate = 24000) => {
    try {
      if (
        !audioOutContextRef.current ||
        audioOutContextRef.current.state === "closed" ||
        audioOutContextRef.current.sampleRate !== sampleRate
      ) {
        if (audioOutContextRef.current && audioOutContextRef.current.state !== "closed") {
          await audioOutContextRef.current.close();
        }
        audioOutContextRef.current = new AudioContext({ sampleRate });
      }
      const ctx = audioOutContextRef.current;
      const pcm16 = base64ToPcm16(base64Audio);
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768.0;
      }
      const audioBuffer = ctx.createBuffer(1, float32.length, sampleRate);
      audioBuffer.copyToChannel(float32, 0);
      audioQueueRef.current.push(audioBuffer);
      if (!isPlayingRef.current) {
        playNextInQueue(ctx);
      }
    } catch (err) {
      console.error("[WebRTC] Error playing audio:", err);
    }
  }, []);

  function playNextInQueue(ctx: AudioContext) {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      return;
    }
    isPlayingRef.current = true;
    const buffer = audioQueueRef.current.shift()!;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => playNextInQueue(ctx);
    source.start();
  }

  const startCall = useCallback(async () => {
    setCallState("requesting_mic");
    setStatusText("Requesting microphone...");
    setErrorMessage("");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
    } catch (err) {
      setCallState("error");
      setStatusText("Microphone denied");
      setErrorMessage(
        "Could not access microphone. Please allow microphone permission in your browser and try again."
      );
      return;
    }

    setCallState("connecting");
    setStatusText("Connecting to AI voice server...");

    const wsUrl = `${WS_SERVER_URL}?agentId=${agentId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setCallState("connected");
      setStatusText(`Live with ${agentName}`);

      // Start elapsed timer
      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);

      // Set up audio capture pipeline
      const ctx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);

      // Analyser for volume visualisation
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      source.connect(analyser);

      // ScriptProcessor to capture raw PCM frames
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      analyser.connect(processor);
      processor.connect(ctx.destination);

      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        if (isMutedRef.current || ws.readyState !== WebSocket.OPEN) return;
        const float32 = e.inputBuffer.getChannelData(0);
        const pcm16 = float32ToPcm16(float32);
        const base64 = arrayBufferToBase64(pcm16.buffer);
        ws.send(JSON.stringify({ event: "audio", payload: base64 }));
      };

      // Volume level polling
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      volumeTimerRef.current = setInterval(() => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setVolumeLevel(Math.min(100, (avg / 128) * 100));
      }, 80);
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string);
        if (msg.event === "audio" && msg.payload) {
          playAudio(msg.payload, msg.sampleRate ?? 24000);
        }
      } catch {}
    };

    ws.onclose = () => {
      setCallState("ended");
      setStatusText("Call ended");
      if (timerRef.current) clearInterval(timerRef.current);
      if (volumeTimerRef.current) clearInterval(volumeTimerRef.current);
    };

    ws.onerror = () => {
      setCallState("error");
      setStatusText("Connection failed");
      setErrorMessage(
        "Could not connect to the AuraVoice server. Make sure the voice server is running: npm run server"
      );
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [agentId, agentName, playAudio]);

  const endCall = useCallback(() => {
    cleanup();
    setCallState("ended");
    setStatusText("Call ended");
    setVolumeLevel(0);
  }, [cleanup]);

  const toggleMute = () => setIsMuted((m) => !m);

  // Format elapsed seconds as MM:SS
  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const isConnected = callState === "connected";
  const isLoading = callState === "requesting_mic" || callState === "connecting";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md"
      onClick={(e) => { if (e.target === e.currentTarget) { endCall(); onClose(); } }}
    >
      <div className="relative w-full max-w-sm mx-4 rounded-3xl border border-zinc-800 bg-[#0a0a0a] shadow-2xl overflow-hidden">
        {/* Ambient glow */}
        <div className={`absolute inset-0 transition-opacity duration-1000 pointer-events-none ${
          isConnected ? "opacity-100" : "opacity-0"
        }`}>
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 bg-violet-600/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-0 w-48 h-48 bg-indigo-500/5 rounded-full blur-3xl" />
        </div>

        {/* Header */}
        <div className="relative flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            {isConnected ? (
              <Wifi className="w-4 h-4 text-emerald-400" />
            ) : callState === "error" ? (
              <WifiOff className="w-4 h-4 text-rose-400" />
            ) : (
              <Wifi className="w-4 h-4 text-zinc-500" />
            )}
            <span className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest">
              WebRTC Live Call
            </span>
          </div>
          <button
            onClick={() => { endCall(); onClose(); }}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Agent avatar & name */}
        <div className="relative flex flex-col items-center px-5 pt-4 pb-8 space-y-4">
          {/* Animated ring */}
          <div className="relative">
            <div className={`absolute inset-0 rounded-full transition-all duration-300 ${
              isConnected && !isMuted
                ? "animate-ping bg-violet-500/20 scale-110"
                : ""
            }`} />
            <div
              className={`relative w-24 h-24 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${
                isConnected
                  ? isMuted
                    ? "border-zinc-700 bg-zinc-900"
                    : "border-violet-500/60 bg-gradient-to-br from-violet-900/40 to-indigo-900/40"
                  : callState === "error"
                  ? "border-rose-500/40 bg-rose-950/20"
                  : "border-zinc-800 bg-zinc-950"
              }`}
              style={{
                boxShadow: isConnected && !isMuted
                  ? `0 0 0 ${Math.round(volumeLevel / 10) * 2}px rgba(139,92,246,0.15)`
                  : undefined,
              }}
            >
              {isLoading ? (
                <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
              ) : callState === "error" ? (
                <AlertCircle className="w-8 h-8 text-rose-400" />
              ) : (
                <Mic className={`w-8 h-8 transition-colors ${
                  isConnected ? (isMuted ? "text-zinc-500" : "text-violet-300") : "text-zinc-500"
                }`} />
              )}
            </div>
          </div>

          {/* Agent name */}
          <div className="text-center space-y-1">
            <h2 className="font-heading font-bold text-lg text-white tracking-tight">
              {agentName}
            </h2>
            <p className="text-xs text-zinc-500">{statusText}</p>
          </div>

          {/* Call timer */}
          {isConnected && (
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-mono text-sm text-emerald-400 font-bold tabular-nums">
                {formatTime(elapsedTime)}
              </span>
            </div>
          )}

          {/* Volume bar */}
          {isConnected && !isMuted && (
            <div className="w-full px-4">
              <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-indigo-400 rounded-full transition-all duration-75"
                  style={{ width: `${volumeLevel}%` }}
                />
              </div>
              <p className="text-[10px] text-zinc-600 font-mono text-center mt-1">
                Mic Level
              </p>
            </div>
          )}

          {/* Error message */}
          {callState === "error" && errorMessage && (
            <div className="w-full mx-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
              <p className="text-xs text-rose-400 leading-relaxed text-center">{errorMessage}</p>
            </div>
          )}

          {/* Connecting message */}
          {callState === "connecting" && (
            <div className="flex items-center gap-2 text-xs text-zinc-500 font-mono">
              <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center gap-4 pt-2">
            {isConnected && (
              <button
                onClick={toggleMute}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl border transition-all ${
                  isMuted
                    ? "bg-rose-500/10 border-rose-500/30 text-rose-400"
                    : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                <span className="text-[9px] font-mono uppercase tracking-wider">
                  {isMuted ? "Unmute" : "Mute"}
                </span>
              </button>
            )}

            {callState === "idle" || callState === "error" || callState === "ended" ? (
              <button
                onClick={startCall}
                className="flex flex-col items-center gap-1.5 px-8 py-3 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-lg shadow-violet-600/30 transition-all"
              >
                <Mic className="w-5 h-5" />
                <span className="text-[9px] font-mono uppercase tracking-wider">
                  {callState === "ended" ? "Reconnect" : "Start Call"}
                </span>
              </button>
            ) : isLoading ? (
              <button
                disabled
                className="flex flex-col items-center gap-1.5 px-8 py-3 rounded-2xl bg-zinc-800 border border-zinc-700 text-zinc-500 cursor-not-allowed"
              >
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-[9px] font-mono uppercase tracking-wider">Connecting</span>
              </button>
            ) : (
              <button
                onClick={() => { endCall(); }}
                className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-rose-500 hover:bg-rose-400 text-white shadow-lg shadow-rose-500/30 transition-all"
              >
                <PhoneOff className="w-5 h-5" />
                <span className="text-[9px] font-mono uppercase tracking-wider">End Call</span>
              </button>
            )}

            {isConnected && (
              <button
                className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 transition-all"
                title="Audio output"
              >
                <Volume2 className="w-5 h-5" />
                <span className="text-[9px] font-mono uppercase tracking-wider">Speaker</span>
              </button>
            )}
          </div>

          {/* Status note */}
          <p className="text-[10px] text-zinc-600 text-center px-4">
            {isConnected
              ? "Speak naturally. Gemini AI is listening and will respond in real-time."
              : "Connects to the AuraVoice voice server (port 5050) via WebSocket."}
          </p>
        </div>
      </div>
    </div>
  );
}
