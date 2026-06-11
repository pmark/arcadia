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
      colors: {
        canvas: "#f5f7f8",
        ink: "#1f2328",
        muted: "#69727d",
        line: "#d6dde3",
        panel: "#ffffff",
        moss: "#2f6f55",
        clay: "#a7472c",
        gold: "#b7791f",
        steel: "#3264a8"
      },
      boxShadow: {
        soft: "0 1px 2px rgb(31 35 40 / 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
