"use client";

import { Check, File, Image as ImageIcon, RefreshCw, Send, Video } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MobileShell } from "../../components/mobile-shell";
import { ErrorState, LoadingState } from "../../components/dashboard-ui";

interface IngressFile {
  name: string;
  relativePath: string;
  kind: "image" | "video" | "audio" | "document" | "other";
  mimeType: string;
  size: number;
  modifiedAt: string;
  downloadState: "downloaded" | "not_downloaded" | "downloading" | "unknown";
  previewUrl: string | null;
}

interface IngressListing {
  source: string;
  directories: { in: string };
  files: IngressFile[];
}

export default function IngressPage() {
  const [listing, setListing] = useState<IngressListing | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState(false);
  const [downloading, setDownloading] = useState<string[]>([]);
  const [failedPreviews, setFailedPreviews] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(options: { initial?: boolean } = {}) {
    if (options.initial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const response = await fetch("/api/ingress", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessage(body, "Could not load Ingress."));
      setListing(body as IngressListing);
      setSelected((current) => current.filter((name) => body.files.some((file: IngressFile) => file.name === name)));
      setFailedPreviews((current) => current.filter((name) => body.files.some((file: IngressFile) => file.name === name)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load({ initial: true });
  }, []);

  const allSelected = Boolean(listing?.files.length) && selected.length === listing?.files.length;
  const selectedLabel = useMemo(
    () => selected.length === 1 ? "1 item selected" : `${selected.length} items selected`,
    [selected.length]
  );

  function toggle(name: string) {
    setMessage(null);
    setSelected((current) => current.includes(name)
      ? current.filter((candidate) => candidate !== name)
      : [...current, name]);
  }

  function toggleAll() {
    if (!listing) return;
    setSelected(allSelected ? [] : listing.files.map((file) => file.name));
  }

  async function downloadFile(name: string) {
    setDownloading((current) => [...current, name]);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/ingress/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: name })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessage(body, "Could not request the iCloud download."));
      setMessage(`${name}: iCloud download requested. Refreshing shortly.`);
      window.setTimeout(() => void load(), 2500);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : String(downloadError));
    } finally {
      setDownloading((current) => current.filter((candidate) => candidate !== name));
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected.length === 0 || !description.trim()) return;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/ingress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: selected, description: description.trim() })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessage(body, "Could not queue the Ingress Action."));
      setMessage(typeof body.message === "string" ? body.message : "Ingress Action queued.");
      setSelected([]);
      setDescription("");
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setPending(false);
    }
  }

  return (
    <MobileShell>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-moss">Arcadia</p>
          <h1 className="text-xl font-semibold">Ingress</h1>
          <p className="mt-1 text-sm text-muted">Select incoming Artifacts and describe the Action.</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={refreshing}
          aria-label="Refresh Ingress"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-line bg-panel text-muted hover:text-ink disabled:opacity-60"
        >
          <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden="true" />
        </button>
      </div>

      {error ? <div className="mt-4"><ErrorState title="Ingress unavailable" message={error} /></div> : null}
      {message ? <p className="mt-4 rounded-md border border-moss/30 bg-moss/10 px-3 py-2 text-sm font-medium text-moss">{message}</p> : null}

      {loading && !listing ? <div className="mt-6"><LoadingState /></div> : null}
      {listing ? (
        <div className="mt-6 grid gap-5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted">{listing.files.length} item{listing.files.length === 1 ? "" : "s"} in {listing.source}/In</span>
            {listing.files.length > 0 ? (
              <button type="button" onClick={toggleAll} className="font-semibold text-steel hover:text-ink">
                {allSelected ? "Clear selection" : "Select all"}
              </button>
            ) : null}
          </div>

          {listing.files.length === 0 ? (
            <div className="rounded-md border border-dashed border-line bg-panel px-4 py-8 text-center text-sm text-muted">
              Nothing is waiting in Ingress yet.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {listing.files.map((file) => {
                const isSelected = selected.includes(file.name);
                return (
                  <div key={file.name} className="grid gap-2">
                    <button
                      type="button"
                      onClick={() => toggle(file.name)}
                      className={`overflow-hidden rounded-md border text-left transition ${isSelected ? "border-moss ring-2 ring-moss/20" : "border-line bg-panel hover:border-steel"}`}
                    >
                      <div className="relative aspect-square bg-canvas">
                        {file.kind === "image" && file.previewUrl && !failedPreviews.includes(file.name) && file.downloadState !== "not_downloaded" ? (
                          // The browser needs the native element here for HEIC and other local media fallbacks.
                          <img
                            src={file.previewUrl}
                            alt={file.name}
                            onError={() => setFailedPreviews((current) => current.includes(file.name) ? current : [...current, file.name])}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="grid h-full place-items-center gap-2 px-3 text-center text-muted">
                            {file.kind === "video" ? <Video className="h-9 w-9" aria-hidden="true" /> : file.kind === "image" ? <ImageIcon className="h-9 w-9" aria-hidden="true" /> : <File className="h-9 w-9" aria-hidden="true" />}
                            {file.downloadState === "not_downloaded"
                              ? <span className="text-xs">Stored in iCloud only</span>
                              : failedPreviews.includes(file.name)
                                ? <span className="text-xs">Preview unavailable; local download may be required</span>
                                : null}
                          </div>
                        )}
                        <span className={`absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full border ${isSelected ? "border-moss bg-moss text-white" : "border-white/80 bg-ink/50 text-white"}`}>
                          {isSelected ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
                        </span>
                      </div>
                      <div className="min-w-0 px-3 py-2">
                        <p className="truncate text-sm font-medium text-ink">{file.name}</p>
                        <p className="mt-1 text-xs text-muted">{formatBytes(file.size)} · {formatDate(file.modifiedAt)}</p>
                      </div>
                    </button>
                    {file.downloadState === "not_downloaded" || failedPreviews.includes(file.name) ? (
                      <button
                        type="button"
                        onClick={() => void downloadFile(file.name)}
                        disabled={downloading.includes(file.name)}
                        className="min-h-9 rounded-md border border-steel/30 bg-steel/10 px-3 text-xs font-semibold text-steel hover:border-steel disabled:opacity-60"
                      >
                        {downloading.includes(file.name) ? "Requesting download..." : "Download from iCloud"}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          <form onSubmit={(event) => void submit(event)} className="grid gap-3 rounded-md border border-line bg-panel p-4">
            <div>
              <p className="text-sm font-semibold text-ink">Describe the Action</p>
              <p className="mt-1 text-xs text-muted">{selected.length > 0 ? selectedLabel : "Select one or more items first."}</p>
            </div>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Example: combine these images and loop them as a Rebuster Rebus video."
              rows={4}
              disabled={selected.length === 0}
              className="min-w-0 rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted focus:border-steel disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={pending || selected.length === 0 || !description.trim()}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-steel/30 bg-steel/10 px-4 text-sm font-semibold text-steel transition hover:border-steel disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              {pending ? "Queueing..." : "Describe Action"}
            </button>
          </form>
        </div>
      ) : null}
    </MobileShell>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

function errorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  return "error" in body && typeof body.error === "string" ? body.error : fallback;
}
