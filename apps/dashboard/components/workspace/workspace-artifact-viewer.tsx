"use client";

import { useEffect, useRef, useState } from "react";

export function WorkspaceArtifactViewer({ id, receipt, onClose }: { id: string; receipt: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [content, setContent] = useState<{ text: string } | { image: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const controller = new AbortController();
    let imageUrl: string | undefined;
    dialog.current?.showModal();
    void (async () => {
      try {
        const response = await fetch(`/api/workspace/artifacts/${encodeURIComponent(id)}?receipt=${encodeURIComponent(receipt)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) { const body = await response.json() as { error?: string }; throw new Error(body.error ?? "The Artifact could not be opened."); }
        if (response.headers.get("content-type")?.startsWith("image/")) {
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          imageUrl = URL.createObjectURL(blob);
          setContent({ image: imageUrl });
        } else { const text = await response.text(); if (!controller.signal.aborted) setContent({ text }); }
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "The Artifact could not be opened."); }
    })();
    return () => { controller.abort(); if (imageUrl) URL.revokeObjectURL(imageUrl); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [id, receipt]);
  return <dialog ref={dialog} className="workspace-artifact-viewer" aria-labelledby="workspace-artifact-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id="workspace-artifact-title">Artifact</h2><button type="button" onClick={onClose} autoFocus>Close Artifact</button></header>
    {error ? <p role="alert">{error}</p> : content ? "image" in content
      // SVG is always an image resource, never injected markup or an embedded document.
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={content.image} alt="Linked Artifact output" onError={() => setError("The Artifact image could not be displayed.")} />
      : <pre>{content.text}</pre> : <p role="status">Opening Artifact…</p>}
  </dialog>;
}
