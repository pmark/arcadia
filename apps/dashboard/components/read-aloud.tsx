"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import type { IntelligenceArtifactRecord, IntelligenceJob } from "@pmark/arcadia/intelligence/contracts";
/** Any Dashboard text surface can submit a read-aloud job and use the same player. */
type ReadAloudProps = {
  endpoint?: string; request: unknown; label?: string; filename?: string;
};

export function ReadAloud(props: ReadAloudProps) {
  return <ReadAloudPlayer key={readAloudPlayerKey(props.endpoint, props.request)} {...props} />;
}

export function readAloudPlayerKey(endpoint: string | undefined, request: unknown): string {
  return `${endpoint ?? "/api/read-aloud"}:${JSON.stringify(request)}`;
}

function ReadAloudPlayer({ endpoint = "/api/read-aloud", request, label = "Play", filename = "arcadia-read-aloud.mp3" }: ReadAloudProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [retryExhausted, setRetryExhausted] = useState(false);
  const playerRef = useRef<HTMLAudioElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => {
    if (startedAt === null || !loading) return;
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [loading, startedAt]);

  async function play() {
    setLoading(true); setError(null); setStage("Preparing audio"); setStartedAt(Date.now()); setElapsed(0); setRetryExhausted(false);
    const abort = new AbortController(); controller.current = abort;
    const player = playerRef.current;
    if (!player) { setLoading(false); return; }
    const warmupUrl = URL.createObjectURL(silentWav());
    player.src = warmupUrl; player.loop = true;
    // Preserve gesture permission on this same media element through generation.
    const warmup = player.play().catch(() => {});
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), signal: abort.signal });
      const prepared = await response.json();
      if (!response.ok) throw new Error(prepared.error ?? "Could not prepare audio.");
      let job = prepared.job as IntelligenceJob;
      setJobId(job.id);
      setStage(job.status === "queued" ? "Audio queued" : job.status === "running" ? "Generating audio" : "Checking audio");
      const deadline = Date.now() + 15 * 60_000;
      while (job.status === "queued" || job.status === "running") {
        if (Date.now() > deadline) throw new Error("Audio is still being generated. Try Play again to reconnect to the same job.");
        await new Promise(resolve => setTimeout(resolve, 1000));
        const poll = await fetch(`/api/admin-intelligence/jobs/${encodeURIComponent(job.id)}`, { cache: "no-store", signal: abort.signal });
        const body = await poll.json();
        if (!poll.ok) throw new Error(body.error ?? "Could not check audio generation.");
        job = body.job;
        setStage(job.status === "queued" ? "Audio queued" : job.status === "running" ? "Generating audio" : "Checking audio");
      }
      if (job.status !== "completed") {
        const exhausted = isAudioRetryExhausted(job);
        setRetryExhausted(exhausted);
        throw new Error(exhausted
          ? `Job ${job.id} ${job.status} (${job.error?.code ?? "INTELLIGENCE_ERROR"}). The audio retry limit is reached; keep the written TLDR and generate again only after its source changes.`
          : `Job ${job.id} ${job.status} (${job.error?.code ?? "INTELLIGENCE_ERROR"}). Retry is available.`);
      }
      const artifact = (job.result as { artifact?: IntelligenceArtifactRecord } | null)?.artifact;
      if (!artifact || artifact.kind !== "audio" || artifact.mimeType !== "audio/mpeg" || artifact.format !== "mp3") throw new Error("Intelligence did not return the requested MP3 artifact.");
      if (abort.signal.aborted) return;
      const artifactUrl = `/api/admin-intelligence/artifacts/${encodeURIComponent(artifact.id)}`;
      setUrl(artifactUrl);
      setStage("Audio ready");
      await warmup;
      player.loop = false; player.src = artifactUrl;
      await player.play().catch(() => { setError("Audio is ready, but your browser blocked playback. Tap Play in the audio controls."); });
    } catch (failure) {
      if (!abort.signal.aborted) { setStage("Audio failed"); setError(failure instanceof Error ? failure.message : String(failure)); }
    } finally {
      if (player.src === warmupUrl) { player.pause(); player.removeAttribute("src"); player.load(); }
      URL.revokeObjectURL(warmupUrl); setLoading(false);
    }
  }

  return (
    <section className="mt-4 grid gap-2" aria-label="Read aloud">
      {!url ? <button type="button" onClick={() => void play()} disabled={loading || retryExhausted} className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md border border-steel/30 px-3 py-2 text-sm font-semibold text-steel disabled:opacity-60"><Play className="h-4 w-4" aria-hidden="true" />{retryExhausted ? "Audio retry limit reached" : loading ? `${stage ?? "Preparing audio"}…` : label}</button> : null}
      <audio ref={playerRef} controls preload="none" className={url ? "w-full" : "hidden"} aria-label="Generated audio" />
      {url ? <a href={`${url}?download=1`} download={filename} className="w-fit text-xs font-semibold text-steel underline">Download MP3</a> : null}
      {stage ? <p role="status" className="text-xs text-muted">{stage} · {formatElapsed(elapsed)}{jobId ? ` · Job ${jobId}` : ""}</p> : null}
      {error ? <p role="alert" className="text-xs text-clay">{error}</p> : null}
    </section>
  );
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

export function isAudioRetryExhausted(job: IntelligenceJob): boolean {
  return (job.status === "failed" || job.status === "blocked")
    && job.retryCount >= job.request.executionPolicy.maxRetries;
}

/** A short silent PCM clip keeps the user-activated element playing while TTS runs. */
function silentWav(): Blob {
  const buffer = new ArrayBuffer(44 + 1600);
  const view = new DataView(buffer);
  const tag = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  tag(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); tag(8, "WAVE");
  tag(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); tag(36, "data"); view.setUint32(40, 1600, true);
  return new Blob([buffer], { type: "audio/wav" });
}
