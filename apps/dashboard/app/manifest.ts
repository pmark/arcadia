import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Arcadia",
    short_name: "Arcadia",
    description: "Capture any thought, see the deterministic response, give feedback.",
    start_url: "/capture",
    display: "standalone",
    background_color: "#f5f7f8",
    theme_color: "#f5f7f8",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" }
    ]
  };
}
