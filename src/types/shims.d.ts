// Ambient declarations for third-party modules that ship no types and
// have no @types package. Keeps `tsc --noEmit` honest without pulling
// `any` into call sites silently.

declare module "canvas-confetti" {
  // The library default-exports a callable. We only use the basic call
  // shape (confetti(options)); the option bag is intentionally loose.
  interface ConfettiOptions {
    particleCount?: number;
    angle?: number;
    spread?: number;
    startVelocity?: number;
    decay?: number;
    gravity?: number;
    drift?: number;
    ticks?: number;
    origin?: { x?: number; y?: number };
    colors?: string[];
    shapes?: string[];
    scalar?: number;
    zIndex?: number;
    disableForReducedMotion?: boolean;
  }
  type ConfettiFn = (options?: ConfettiOptions) => Promise<null> | null;
  const confetti: ConfettiFn;
  export default confetti;
}

declare module "pdf-parse" {
  // pdf-parse(dataBuffer) -> { text, numpages, info, ... }. Only `text`
  // is consumed in this codebase.
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    version: string;
  }
  function pdfParse(
    dataBuffer: Buffer | Uint8Array,
    options?: Record<string, unknown>,
  ): Promise<PdfParseResult>;
  export default pdfParse;
}
