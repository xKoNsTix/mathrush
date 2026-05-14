import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        paper: "#F4F1EA",
        ink: "#111111",
        accent: "#FF4A1C",
        good: "#1BC47D",
        bad: "#E5384F",
        muted: "#7A746A",
      },
      boxShadow: {
        hard: "6px 6px 0 0 #111111",
        hardsm: "3px 3px 0 0 #111111",
      },
    },
  },
  plugins: [],
};
export default config;
