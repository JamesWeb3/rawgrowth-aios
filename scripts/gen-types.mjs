// Generate src/lib/supabase/types.ts from the live Postgres schema.
//
// Why this exists: `supabase gen types` requires Docker, which is not
// available on every workstation. This script introspects the schema
// directly over the `DATABASE_URL` connection (read-only - it only
// SELECTs from information_schema and the pg_catalog) and emits the
// same `Database` type shape supabase-js expects.
//
// Usage: node scripts/gen-types.mjs
//   Reads DATABASE_URL from .env (or the process env).
//   Writes src/lib/supabase/types.ts.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envText = readFileSync(join(root, ".env"), "utf8");
  const line = envText
    .split("\n")
    .find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL not found in .env");
  return line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}

// Postgres type -> TypeScript type. `udtName` disambiguates arrays,
// enums and other USER-DEFINED types.
function pgToTs(dataType, udtName, enumMap) {
  if (dataType === "ARRAY") {
    // udt_name for arrays is the element type prefixed with `_`.
    const elem = udtName.replace(/^_/, "");
    return `${scalarToTs(elem, enumMap)}[]`;
  }
  if (dataType === "USER-DEFINED") {
    if (enumMap.has(udtName)) return enumUnion(enumMap.get(udtName));
    if (udtName === "vector") return "string";
    return "Record<string, unknown>"; // composite type
  }
  return scalarToTs(dataType, enumMap);
}

// Maps a scalar pg type name (data_type OR a bare udt_name) to TS.
function scalarToTs(t, enumMap) {
  if (enumMap.has(t)) return enumUnion(enumMap.get(t));
  switch (t) {
    case "uuid":
    case "text":
    case "character varying":
    case "varchar":
    case "character":
    case "bpchar":
    case "name":
    case "citext":
    case "inet":
    case "bytea":
    case "xml":
      return "string";
    case "smallint":
    case "int2":
    case "integer":
    case "int4":
    case "bigint":
    case "int8":
    case "numeric":
    case "real":
    case "float4":
    case "double precision":
    case "float8":
      return "number";
    case "boolean":
    case "bool":
      return "boolean";
    case "json":
    case "jsonb":
      return "Record<string, unknown>";
    case "timestamp without time zone":
    case "timestamp with time zone":
    case "timestamptz":
    case "timestamp":
    case "date":
    case "time without time zone":
    case "time with time zone":
    case "interval":
      return "string";
    case "vector":
      return "string";
    default:
      return "unknown";
  }
}

function enumUnion(values) {
  return values.map((v) => JSON.stringify(v)).join(" | ");
}

async function main() {
  const client = new pg.Client({
    connectionString: loadDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // 1. Enums.
  const enumRes = await client.query(`
    SELECT t.typname AS enum_name, e.enumlabel AS enum_value
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    ORDER BY t.typname, e.enumsortorder
  `);
  const enumMap = new Map();
  for (const r of enumRes.rows) {
    if (!enumMap.has(r.enum_name)) enumMap.set(r.enum_name, []);
    enumMap.get(r.enum_name).push(r.enum_value);
  }

  // 2. Base-table columns.
  const colRes = await client.query(`
    SELECT c.table_name, c.column_name, c.data_type, c.udt_name,
           c.is_nullable, c.column_default, c.is_identity, c.ordinal_position
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name, c.ordinal_position
  `);

  // 3. View columns (read-only, no Insert/Update).
  const viewRes = await client.query(`
    SELECT c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable,
           c.ordinal_position
    FROM information_schema.columns c
    JOIN information_schema.views v
      ON v.table_schema = c.table_schema AND v.table_name = c.table_name
    WHERE c.table_schema = 'public'
    ORDER BY c.table_name, c.ordinal_position
  `);

  // 4. Functions (so db.rpc() type-checks its args).
  const fnRes = await client.query(`
    SELECT r.routine_name, r.specific_name,
           r.data_type AS return_type, r.type_udt_name AS return_udt,
           p.parameter_name, p.data_type AS param_type, p.udt_name AS param_udt,
           p.parameter_mode, p.ordinal_position
    FROM information_schema.routines r
    LEFT JOIN information_schema.parameters p
      ON p.specific_name = r.specific_name
    WHERE r.routine_schema = 'public' AND r.routine_type = 'FUNCTION'
    ORDER BY r.routine_name, p.ordinal_position
  `);

  await client.end();

  // ---- group ----
  const tables = new Map();
  for (const r of colRes.rows) {
    if (!tables.has(r.table_name)) tables.set(r.table_name, []);
    tables.get(r.table_name).push(r);
  }
  const views = new Map();
  for (const r of viewRes.rows) {
    if (!views.has(r.table_name)) views.set(r.table_name, []);
    views.get(r.table_name).push(r);
  }
  const fns = new Map();
  for (const r of fnRes.rows) {
    if (!fns.has(r.routine_name)) {
      fns.set(r.routine_name, {
        return_type: r.return_type,
        return_udt: r.return_udt,
        args: [],
      });
    }
    if (r.parameter_name && ["IN", "INOUT"].includes(r.parameter_mode)) {
      fns.get(r.routine_name).args.push(r);
    }
  }

  // ---- emit ----
  const I = (n) => "  ".repeat(n);
  const out = [];
  out.push("/**");
  out.push(" * Supabase type definitions.");
  out.push(" *");
  out.push(" * GENERATED by scripts/gen-types.mjs - do not edit by hand.");
  out.push(" * Re-run `node scripts/gen-types.mjs` after a schema migration.");
  out.push(" * Introspected straight from the live schema over DATABASE_URL,");
  out.push(" * so it stays correct without the Docker dependency that");
  out.push(" * `supabase gen types` needs.");
  out.push(" */");
  out.push("");
  out.push("export type Database = {");
  out.push(I(1) + "public: {");

  // Tables
  out.push(I(2) + "Tables: {");
  for (const [name, cols] of [...tables].sort()) {
    out.push(I(3) + `${name}: {`);
    out.push(I(4) + "Row: {");
    for (const c of cols) {
      const t = pgToTs(c.data_type, c.udt_name, enumMap);
      const nul = c.is_nullable === "YES" ? " | null" : "";
      out.push(I(5) + `${c.column_name}: ${t}${nul};`);
    }
    out.push(I(4) + "};");
    out.push(I(4) + "Insert: {");
    for (const c of cols) {
      const t = pgToTs(c.data_type, c.udt_name, enumMap);
      const nul = c.is_nullable === "YES" ? " | null" : "";
      const optional =
        c.is_nullable === "YES" ||
        c.column_default !== null ||
        c.is_identity === "YES";
      out.push(I(5) + `${c.column_name}${optional ? "?" : ""}: ${t}${nul};`);
    }
    out.push(I(4) + "};");
    out.push(
      I(4) +
        `Update: Partial<Database["public"]["Tables"]["${name}"]["Row"]>;`,
    );
    out.push(I(4) + "Relationships: [];");
    out.push(I(3) + "};");
  }
  out.push(I(2) + "};");

  // Views
  if (views.size === 0) {
    out.push(I(2) + "Views: Record<string, never>;");
  } else {
    out.push(I(2) + "Views: {");
    for (const [name, cols] of [...views].sort()) {
      out.push(I(3) + `${name}: {`);
      out.push(I(4) + "Row: {");
      for (const c of cols) {
        const t = pgToTs(c.data_type, c.udt_name, enumMap);
        // Views report every column as nullable in information_schema;
        // keep that conservative default.
        out.push(I(5) + `${c.column_name}: ${t} | null;`);
      }
      out.push(I(4) + "};");
      out.push(I(4) + "Relationships: [];");
      out.push(I(3) + "};");
    }
    out.push(I(2) + "};");
  }

  // Functions
  if (fns.size === 0) {
    out.push(I(2) + "Functions: Record<string, never>;");
  } else {
    out.push(I(2) + "Functions: {");
    for (const [name, fn] of [...fns].sort()) {
      out.push(I(3) + `${name}: {`);
      if (fn.args.length === 0) {
        out.push(I(4) + "Args: Record<string, never>;");
      } else {
        out.push(I(4) + "Args: {");
        for (const a of fn.args) {
          out.push(
            I(5) +
              `${a.parameter_name}: ${pgToTs(a.param_type, a.param_udt, enumMap)};`,
          );
        }
        out.push(I(4) + "};");
      }
      const ret =
        fn.return_type === "USER-DEFINED" || fn.return_type === "ARRAY"
          ? pgToTs(fn.return_type, fn.return_udt, enumMap)
          : scalarToTs(fn.return_type, enumMap);
      // Set-returning / table functions report `record` or a row type;
      // `unknown` is the safe surface - call sites already cast results.
      out.push(I(4) + `Returns: ${ret === "unknown" ? "unknown" : ret};`);
      out.push(I(3) + "};");
    }
    out.push(I(2) + "};");
  }

  // Enums
  if (enumMap.size === 0) {
    out.push(I(2) + "Enums: Record<string, never>;");
  } else {
    out.push(I(2) + "Enums: {");
    for (const [name, values] of [...enumMap].sort()) {
      out.push(I(3) + `${name}: ${enumUnion(values)};`);
    }
    out.push(I(2) + "};");
  }

  out.push(I(2) + "CompositeTypes: Record<string, never>;");
  out.push(I(1) + "};");
  out.push("};");
  out.push("");

  const dest = join(root, "src/lib/supabase/types.ts");
  writeFileSync(dest, out.join("\n"));
  console.log(
    `Wrote ${dest}: ${tables.size} tables, ${views.size} views, ` +
      `${fns.size} functions, ${enumMap.size} enums.`,
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
