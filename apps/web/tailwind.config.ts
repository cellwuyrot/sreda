import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-playfair)", "Georgia", "serif"],
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Semantic, theme-aware tokens (resolve per active theme via CSS vars).
        // `accent` is channel-based so opacity modifiers work: text-accent/30, bg-accent/10.
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          hover: "rgb(var(--accent-hover) / <alpha-value>)",
        },
        card: {
          DEFAULT: "var(--card-bg)",
          border: "var(--card-border)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          bg: "var(--muted-bg)",
        },
        tag: {
          DEFAULT: "var(--tag-bg)",
          text: "var(--tag-text)",
        },
        dark: {
          900: "#0a0a0f",
          800: "#12121a",
          700: "#1a1a2e",
          600: "#22223a",
          500: "#2a2a40",
        },
        cyan: {
          400: "#00f0ff",
          500: "#00d4e0",
          600: "#00b8c4",
        },
        fantasy: {
          red: "#ff4444",
          purple: "#8b5cf6",
          gold: "#fbbf24",
          emerald: "#10b981",
        },
      },
      animation: {
        "glow-pulse": "glow-pulse 3s ease-in-out infinite",
        "float": "float 6s ease-in-out infinite",
        "fade-in": "fade-in 0.8s ease-out forwards",
        "slide-up": "slide-up 0.8s ease-out forwards",
        "scale-in": "scale-in 0.5s ease-out forwards",
        "dice-shake": "dice-shake 0.65s ease-in-out",
      },
      keyframes: {
        "glow-pulse": {
          "0%, 100%": { boxShadow: "0 0 20px rgba(0, 240, 255, 0.3)" },
          "50%": { boxShadow: "0 0 40px rgba(0, 240, 255, 0.6)" },
        },
        "float": {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(30px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.9)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "dice-shake": {
          "0%": { transform: "rotate(0) scale(1)" },
          "12%": { transform: "rotate(-13deg) scale(1.07)" },
          "30%": { transform: "rotate(10deg) scale(1.09)" },
          "50%": { transform: "rotate(-7deg) scale(1.05)" },
          "70%": { transform: "rotate(5deg) scale(1.03)" },
          "100%": { transform: "rotate(0) scale(1)" },
        },
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
      },
    },
  },
  plugins: [],
};
export default config;
