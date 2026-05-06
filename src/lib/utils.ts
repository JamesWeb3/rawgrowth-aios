import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Strict RFC 4122 UUID matcher (any version, hex variant). Used at the
// edge of API routes that take an [id] path param so a non-UUID never
// reaches Postgres and trips an "invalid input syntax for type uuid"
// 500 (which leaks the storage engine + column type).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}
