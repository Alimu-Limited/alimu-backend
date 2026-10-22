/**
 * Mikhmon (manual hotspot voucher) -> payment_queue sync.
 *
 * Rule: a manual voucher appears on the dashboard after its FIRST login and
 * then stays there until its expiry. Unused vouchers never appear. Logging out
 * does not remove the row.
 *
 * The router sends all Mikhmon-pattern users plus the active-session list.
 * A user is eligible when they are active now OR their comment already carries
 * an expiry timestamp (written by Mikhmon's on-login script on first login).
 */

export interface MikhmonUserInput {
  name?: unknown;
  password?: unknown;
  profile?: unknown;
  mac?: unknown;
  "mac-address"?: unknown;
  comment?: unknown;
  disabled?: unknown;
  "limit-uptime"?: unknown;
}

export interface MikhmonRow {
  transaction_id: string;
  customer_email: string;
  customer_phone: string;
  plan: string;
  mikrotik_username: string;
  mikrotik_password: string;
  mac_address: string;
  status: "processed" | "expired";
  expires_at: string | null;
}

export interface MikhmonSyncResult {
  received: number;
  eligible: number;
  skipped: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  names: string[];
}

/** Maps Mikhmon voucher profile names to the plan codes used by the dashboards. */
export function mapMikhmonPlan(profile: unknown): string {
  const p = String(profile ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (["24hr", "24hrs", "24-hour", "24-hours", "daily", "1d"].includes(p)) return "24hr";
  if (["3d", "3day", "3days", "3-day", "3-days"].includes(p)) return "3d";
  if (["5d", "5day", "5days", "5-day", "5-days"].includes(p)) return "5d";
  if (["7d", "7day", "7days", "7-day", "7-days", "1w", "weekly"].includes(p)) return "7d";
  if (["14d", "14day", "14days", "14-day", "14-days", "2w"].includes(p)) return "14d";
  if (["30d", "30day", "30days", "30-day", "30-days", "4w2d", "monthly"].includes(p)) return "30d";
  return "mikhmon";
}

/**
 * Mikhmon writes an expiry timestamp into the user comment on first login
 * (e.g. "2026-10-22 18:22:00"). Voucher-code comments such as
 * "vc-137-10.22.26-4GBProfile" have no usable expiry and return null.
 */
export function parseMikhmonExpiry(comment: unknown): string | null {
  const text = String(comment ?? "");
  const m = text.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 2020 || year > 2100) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+01:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function toMikhmonRow(input: MikhmonUserInput): MikhmonRow | null {
  const name = String(input?.name ?? "").trim();
  if (!name) return null;

  const rawMac = String(input?.mac ?? input?.["mac-address"] ?? "").trim().toUpperCase();
  const mac = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(rawMac) ? rawMac : "";

  const disabled = String(input?.disabled ?? "").toLowerCase() === "true" ||
    String(input?.["limit-uptime"] ?? "") === "1s";

  // Keep manual users OUT of paid-plan revenue. The real Mikhmon profile is
  // shown in the contact line; the plan tag stays "Mikhmon".
  const mapped = mapMikhmonPlan(input?.profile);
  const contact = mapped === "mikhmon" ? "Mikhmon" : `Mikhmon (${mapped})`;

  return {
    transaction_id: `mikhmon-${name}`,
    customer_email: contact,
    customer_phone: "Mikhmon",
    plan: "mikhmon",
    mikrotik_username: name,
    mikrotik_password: String(input?.password ?? ""),
    mac_address: mac,
    status: disabled ? "expired" : "processed",
    expires_at: parseMikhmonExpiry(input?.comment),
  };
}

/**
 * Inserts/updates eligible Mikhmon users. Never deletes: logout keeps the row,
 * and the dashboard turns it EXPIRED when expires_at passes.
 */
export async function syncMikhmonUsers(
  sb: any,
  users: MikhmonUserInput[],
  opts: { dryRun?: boolean; firstLoginOnly?: boolean; active?: string[] } = {},
): Promise<MikhmonSyncResult> {
  const activeSet = new Set((opts.active ?? []).map((x) => String(x)));
  const candidates = users.map(toMikhmonRow).filter((r): r is MikhmonRow => r !== null);
  const rows = opts.firstLoginOnly
    ? candidates.filter((r) => activeSet.has(r.mikrotik_username) || r.expires_at !== null)
    : candidates;
  const names = rows.map((r) => r.mikrotik_username);
  const result: MikhmonSyncResult = {
    received: users.length,
    eligible: rows.length,
    skipped: candidates.length - rows.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    names,
  };

  if (opts.dryRun) return result;

  const { data: existing, error: readError } = await sb
    .from("payment_queue")
    .select("id, transaction_id, mikrotik_password, plan, mac_address, status, expires_at, customer_email, customer_phone")
    .like("transaction_id", "mikhmon-%");
  if (readError) throw new Error(readError.message || "Failed to read existing Mikhmon users");

  const byTx = new Map<string, any>();
  for (const row of existing ?? []) byTx.set(String(row.transaction_id), row);

  const sameDate = (a: unknown, b: string | null): boolean => {
    if (!a && !b) return true;
    if (!a || !b) return false;
    const ta = new Date(String(a)).getTime();
    const tb = new Date(String(b)).getTime();
    return !Number.isNaN(ta) && !Number.isNaN(tb) && ta === tb;
  };

  for (const row of rows) {
    const old = byTx.get(row.transaction_id);
    if (old) {
      const unchanged =
        String(old.mikrotik_password ?? "") === row.mikrotik_password &&
        String(old.plan ?? "") === row.plan &&
        String(old.mac_address ?? "") === row.mac_address &&
        String(old.status ?? "") === row.status &&
        String(old.customer_email ?? "") === row.customer_email &&
        String(old.customer_phone ?? "") === row.customer_phone &&
        sameDate(old.expires_at, row.expires_at);
      if (unchanged) {
        result.unchanged++;
        continue;
      }
      const { error } = await sb.from("payment_queue").update(row).eq("id", old.id);
      if (error) result.failed++;
      else result.updated++;
    } else {
      const { error } = await sb.from("payment_queue").insert(row);
      if (error) result.failed++;
      else result.created++;
    }
  }

  return result;
}
