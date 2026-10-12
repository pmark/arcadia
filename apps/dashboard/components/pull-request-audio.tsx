"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";

export function PullRequestAudio({ repository, number }: { repository: string; number: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [format, setFormat] = useState("mp3");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  async function play() {
    setLoading(true);
    setError(null);
    controller.current = new AbortController();
    const player = audio.current;
    if (!player) { setLoading(false); return; }
    // Start this SAME element during the tap, before awaiting synthesis. WebKit
    // grants playback per element; switching its source preserves that permission.
    const warmupUrl = URL.createObjectURL(silentWav());
    player.src = warmupUrl;
    player.loop = true;
    const warmup = player.play().catch(() => {});
    try {
      const response = await fetch("/api/pull-requests/audio", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ repository, number }), signal: controller.current.signal,
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? "Could not prepare PR audio.");
      }
      const blob = await response.blob();
      setFormat(blob.type === "audio/mpeg" ? "mp3" : "wav");
      const objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
      await warmup;
      player.loop = false;
      player.src = objectUrl;
      await player.play().catch(() => {
        setError("Audio is ready, but your browser blocked playback. Tap Play in the audio controls.");
      });
    } catch (failure) {
      if (!(failure instanceof Error && failure.name === "AbortError")) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (player.src === warmupUrl) { player.pause(); player.removeAttribute("src"); player.load(); }
      URL.revokeObjectURL(warmupUrl);
      setLoading(false);
    }
  }

  return (
    <section className="mt-4 grid gap-2" aria-label={`Read PR ${number} body aloud`}>
      {!url ? (
        <button type="button" onClick={() => void play()} disabled={loading} className="inline-flex w-fit items-center gap-2 rounded-md border border-steel/30 px-3 py-2 text-sm font-semibold text-steel disabled:opacity-60">
          <Play className="h-4 w-4" aria-hidden="true" />{loading ? "Preparing audio…" : "Play body"}
        </button>
      ) : null}
      <audio ref={audio} controls preload="none" className={url ? "w-full" : "hidden"} aria-label={`PR ${number} body audio`} />
      {url ? <a href={url} download={`${repository.replace("/", "-")}-pr-${number}-body.${format}`} className="w-fit text-xs font-semibold text-steel underline">Download {format.toUpperCase()}</a> : null}
      {loading ? <p role="status" className="text-xs text-muted">Reading the body only. Long descriptions may take a few minutes.</p> : null}
      {error ? <p role="alert" className="text-xs text-clay">{error}</p> : null}
    </section>
  );
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
