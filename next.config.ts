import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a minimal standalone server bundle for Docker images.
  // Hosted (Vercel) builds ignore this; self-hosted Docker images ship with it.
  output: "standalone",
  // Pin the workspace root for dev only. Pedro has /home/pedroafonso/
  // package.json + lockfile from another project; without a pin Turbopack
  // walks up, picks $HOME as workspace root, and PostCSS resolves
  // tailwindcss against the wrong node_modules → ERR_MODULE_NOT_FOUND on
  // first request. CI runs from a different absolute path
  // (/home/runner/work/...), so a hardcoded literal there breaks
  // distDirRoot validation. Use the env-provided override when set
  // (TURBOPACK_ROOT=/home/pedroafonso/rawclaw-research/rawclaw in dev),
  // otherwise let Turbopack fall back to its own default — which works
  // fine in CI where there's no parallel $HOME lockfile.
  turbopack: process.env.TURBOPACK_ROOT
    ? { root: process.env.TURBOPACK_ROOT }
    : undefined,
  // Typecheck runs locally and in CI. Skip inside the Docker build so
  // low-RAM VPSes don't OOM/hang during `next build`.
  typescript: { ignoreBuildErrors: true },
  // fastembed loads platform-native ONNX/tokenizer binaries at runtime
  // via dynamic require(), which Turbopack can't statically resolve and
  // would warn on every per-agent file upload. Mark it as an external
  // server package so it stays a plain Node module loaded at runtime.
  serverExternalPackages: [
    "fastembed",
    "onnxruntime-node",
    "@anush008/tokenizers",
  ],
  // Auto-train + default-org seed read role-template starter MDs at
  // runtime via fs.readFile from src/lib/agents/starter-content/. Next
  // standalone output only copies files it can statically trace through
  // imports - the .md files are read by string path so they don't get
  // included. This silently broke the hire flow in prod (ENOENT). List
  // them explicitly so they ship inside the standalone bundle.
  outputFileTracingIncludes: {
    "/api/agents": ["./src/lib/agents/starter-content/**/*"],
    "/api/admin/clients": ["./src/lib/agents/starter-content/**/*"],
    "/api/onboarding/chat": ["./src/lib/agents/starter-content/**/*"],
  },
};

export default nextConfig;
