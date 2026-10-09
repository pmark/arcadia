import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      // Channels live in app/globals.css as CSS variables. Their default values
      // are the original palette, so every page renders exactly as before; a
      // container marked `data-theme-scope="auto"` follows the system theme.
      colors: {
        canvas: "rgb(var(--color-canvas) / <alpha-value>)",
        ink: "rgb(var(--color-ink) / <alpha-value>)",
        muted: "rgb(var(--color-muted) / <alpha-value>)",
        line: "rgb(var(--color-line) / <alpha-value>)",
        panel: "rgb(var(--color-panel) / <alpha-value>)",
        moss: "rgb(var(--color-moss) / <alpha-value>)",
        clay: "rgb(var(--color-clay) / <alpha-value>)",
        gold: "rgb(var(--color-gold) / <alpha-value>)",
        steel: "rgb(var(--color-steel) / <alpha-value>)"
      },
      boxShadow: {
        soft: "0 1px 2px rgb(31 35 40 / 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
