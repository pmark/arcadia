"use client";

import { useEffect, useRef } from "react";
import { mountSky } from "./controller";

export function WorkspaceBackdrop() {
  const sky = useRef<HTMLCanvasElement>(null);
  const stars = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const surface = sky.current?.closest<HTMLElement>(".workspace-shell");
    if (!surface || !sky.current || !stars.current) return;
    return mountSky(surface, sky.current, stars.current);
  }, []);
  return <><canvas ref={sky} className="workspace-sky" aria-hidden="true" /><canvas ref={stars} className="workspace-stars" aria-hidden="true" /></>;
}
