import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: { port: 5173, open: true },
  build: {
    target: "es2022",
    // Split the domain layer out of the UI chunk. It is the part you will lift
    // wholesale into a React Native / Electron build, so keeping it separable
    // here keeps you honest about what actually depends on the DOM.
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          icons: ["lucide-react"],
        },
      },
    },
  },
});
