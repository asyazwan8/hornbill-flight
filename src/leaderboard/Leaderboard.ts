/**
 * The online leaderboard, spoken to over plain HTTP.
 *
 * Supabase exposes every table through PostgREST, so reading the top ten and
 * posting a run are one `fetch` each. That is the whole reason there is no
 * client library here: the dependency would cost more bundle than the feature
 * it implements.
 *
 * Everything in this file is best-effort. The game is playable with no network
 * and no Supabase project at all, so a failure here must never do more than
 * hide the board — hence a single `submit`/`fetchTop` pair that the UI can
 * treat as optional, and a local best score that always works.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const TABLE = "leaderboard";

/** How many rows the board holds. */
export const TOP_N = 10;

/** How many of those to show on the pre-flight screens, which are already tall. */
export const PREFLIGHT_ROWS = 5;

/** Longest name we accept, matching the CHECK constraint in supabase/schema.sql. */
export const MAX_NAME_LENGTH = 16;

/** Nothing hangs the panel on "Loading…" for longer than this. */
const TIMEOUT_MS = 6000;

export type LeaderboardEntry = {
  id: string;
  name: string;
  stars: number;
  duration_seconds: number;
  created_at: string;
};

/** A finished run, ready to post. */
export type RunResult = {
  name: string;
  stars: number;
  durationSeconds: number;
};

/** False when no project is configured, which is the normal state in dev. */
export function isConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function endpoint(query = ""): string {
  return `${SUPABASE_URL}/rest/v1/${TABLE}${query}`;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SUPABASE_ANON_KEY as string,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    ...extra,
  };
}

/**
 * PostgREST puts the useful part of a failure in the body, not the status, so
 * a rejected CHECK constraint reads as something better than "400".
 */
async function describeFailure(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string; details?: string };
    if (body.message) return body.message;
  } catch {
    // Not JSON, or an empty body. The status will have to do.
  }
  return `Request failed (${res.status})`;
}

/**
 * The top runs, best first: most stars, and among equal star counts the run
 * that stayed in the air longest.
 */
export async function fetchTop(limit = TOP_N): Promise<LeaderboardEntry[]> {
  if (!isConfigured()) return [];

  const query =
    `?select=id,name,stars,duration_seconds,created_at` +
    `&order=stars.desc,duration_seconds.desc,created_at.asc` +
    `&limit=${limit}`;

  const res = await fetch(endpoint(query), {
    headers: headers(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(await describeFailure(res));
  return (await res.json()) as LeaderboardEntry[];
}

/**
 * Post a run and return the row that was stored, whose id lets the caller
 * highlight it once the board is re-read.
 *
 * The score is taken on trust: the anon key is in the bundle, so anyone
 * determined can post whatever they like with curl. The table's constraints
 * throw out the physically impossible (see supabase/schema.sql) and that is
 * the honest limit of what a client-side game can enforce. If this ever needs
 * to be stricter, a Supabase Edge Function holding the service role key would
 * slot in behind this one function without the rest of the game noticing.
 */
export async function submit(run: RunResult): Promise<LeaderboardEntry> {
  if (!isConfigured()) throw new Error("No leaderboard is configured.");

  const row = {
    name: cleanName(run.name),
    stars: Math.max(0, Math.round(run.stars)),
    // Two decimals is plenty for a tiebreak, and keeps the payload tidy.
    duration_seconds: Math.round(run.durationSeconds * 100) / 100,
  };

  const res = await fetch(endpoint(), {
    method: "POST",
    headers: headers({
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(await describeFailure(res));

  const [stored] = (await res.json()) as LeaderboardEntry[];
  return stored;
}

/** Trim, collapse whitespace and clip to what the table will accept. */
export function cleanName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
  return name || "Anonymous";
}

/* ---------------- Things remembered on this device ---------------- */

const NAME_KEY = "hornbill-flight:name";
const BEST_KEY = "hornbill-flight:best";

/** localStorage throws in private browsing; none of it is worth a crash. */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing can refuse writes. A forgotten name or best score is
    // not worth breaking the game over.
  }
}

/** The name last used on this device, so it only has to be typed once. */
export function readName(): string {
  return read(NAME_KEY) ?? "";
}

export function writeName(name: string) {
  write(NAME_KEY, cleanName(name));
}

/**
 * The local best score. Kept even when the online board is working, because
 * it is what the game falls back to offline, or before the player has typed a
 * name, or when no Supabase project is configured at all.
 */
export function readBest(): number {
  const raw = Number(read(BEST_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

export function writeBest(score: number) {
  write(BEST_KEY, String(score));
}
