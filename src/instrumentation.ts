/**
 * Next.js instrumentation hook. Runs once per server process at boot,
 * before any route handlers. Used here to trigger the env-var check in
 * src/lib/env.ts so a misconfigured VPS fails loudly on startup rather
 * than surfacing a mystery 500 from a route down the line.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@/lib/env");
    // Fire-and-forget warmup of the local fastembed model so the first
    // user-facing upload doesn't pay the ~10s ONNX cold-start mid-demo.
    // No-op on openai/voyage. Errors are swallowed inside warmEmbedder.
    const { warmEmbedder } = await import("@/lib/knowledge/embedder");
    warmEmbedder();
  }
}
