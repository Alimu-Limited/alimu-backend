/**
 * Mikhmon (manual hotspot voucher) -> payment_queue sync.
 *
 * Manual users exist only on the router. Mikhmon never writes to the backend,
 * so the admin dashboards (which read payment_queue) cannot see them until the
 * router pushes them here. This module is deliberately database-only and free
 * of Deno globals so it can be unit-tested without a live Supabase project.
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
  valid: number;
  created: number;
  updated: number;
  expired: number;
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
  // Unknown/manual profiles stay visibly separate and are not counted as revenue.
  return "mikhmon";
}

/**
 * Mikhmon writes an expiry timestamp into the user comment when a voucher logs
 * in (e.g. "2026-10-22 18:22:00"). Voucher-code comments and empty comments
 * have no usable expiry and return null (never auto-expire in the dashboard).
 */
export function parseMikhmonExpiry(comment: unknown): string | null {
  const text = String(comment ?? "");
  const m = text.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 2020 || year > 2100) return null;
  // Africa/Lagos is UTC+01:00 and has no DST.
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

  return {
    transaction_id: `mikhmon-${name}`,
    customer_email: "Mikhmon",
    customer_phone: "Mikhmon",
    plan: mapMikhmonPlan(input?.profile),
    mikrotik_username: name,
    mikrotik_password: String(input?.password ?? ""),
    mac_address: mac,
    status: disabled ? "expired" : "processed",
    expires_at: parseMikhmonExpiry(input?.comment),
  };
}

/**
 * Upserts manual users into payment_queue. No schema change: the dashboards
 * already read this table, so a processed row appears immediately and green.
 *
 * `complete: true` means the router enumerated its full user list; only then
 * are Mikhmon rows missing from the payload marked expired. This prevents a
 * truncated/partial push from expiring everybody.
 */
export async function syncMikhmonUsers(
  sb: any,
  users: MikhmonUserInput[],
  opts: { dryRun?: boolean; complete?: boolean } = {},
): Promise<MikhmonSyncResult> {
  const rows = users.map(toMikhmonRow).filter((r): r is MikhmonRow => r !== null);
  const names = rows.map((r) => r.mikrotik_username);
  const result: MikhmonSyncResult = {
    received: users.length,
    valid: rows.length,
    created: 0,
    updated: 0,
    expired: 0,
    failed: 0,
    names,
  };

  if (opts.dryRun) return result;

  const { data: existing, error: readError } = await sb
    .from("payment_queue")
    .select("id, transaction_id")
    .like("transaction_id", "mikhmon-%");
  if (readError) throw new Error(readError.message || "Failed to read existing Mikhmon users");

  const ids = new Map<string, unknown>();
  for (const row of existing ?? []) ids.set(String(row.transaction_id), row.id);

  for (const row of rows) {
    const id = ids.get(row.transaction_id);
    if (id !== undefined) {
      const { error } = await sb.from("payment_queue").update(row).eq("id", id);
      if (error) result.failed++;
      else result.updated++;
    } else {
      const { error } = await sb.from("payment_queue").insert(row);
      if (error) result.failed++;
      else result.created++;
    }
  }

  if (opts.complete && rows.length > 0) {
    const { data: all, error } = await sb
      .from("payment_queue")
      .select("id, mikrotik_username")
      .like("transaction_id", "mikhmon-%")
      .eq("status", "processed");
    if (!error) {
      const keep = new Set(names);
      for (const row of all ?? []) {
        if (!keep.has(String(row.mikrotik_username ?? ""))) {
          const { error: updateError } = await sb
            .from("payment_queue")
            .update({ status: "expired" })
            .eq("id", row.id);
          if (!updateError) result.expired++;
        }
      }
    }
  }

  return result;
}
