import { assertEquals, assert } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  mapMikhmonPlan,
  parseMikhmonExpiry,
  syncMikhmonUsers,
  toMikhmonRow,
} from "./mikhmon.ts";

Deno.test("mapMikhmonPlan maps every Mikhmon voucher profile", () => {
  assertEquals(mapMikhmonPlan("24hrs"), "24hr");
  assertEquals(mapMikhmonPlan("3-Days"), "3d");
  assertEquals(mapMikhmonPlan("5-Days"), "5d");
  assertEquals(mapMikhmonPlan("7-Days"), "7d");
  assertEquals(mapMikhmonPlan("14-Days"), "14d");
  assertEquals(mapMikhmonPlan("30-Days"), "30d");
  assertEquals(mapMikhmonPlan("daily"), "24hr");
  assertEquals(mapMikhmonPlan("default"), "mikhmon");
  assertEquals(mapMikhmonPlan(""), "mikhmon");
});

Deno.test("parseMikhmonExpiry handles timestamps and refuses junk", () => {
  assertEquals(parseMikhmonExpiry("2026-10-22 18:22:00"), "2026-10-22T17:22:00.000Z");
  assertEquals(parseMikhmonExpiry("2026-10-22T18:22:00"), "2026-10-22T17:22:00.000Z");
  assertEquals(parseMikhmonExpiry("vc-591-10.20.26-24"), null);
  assertEquals(parseMikhmonExpiry(""), null);
  assertEquals(parseMikhmonExpiry("2026-13-40 99:99:99"), null);
});

Deno.test("toMikhmonRow builds a safe payment_queue row", () => {
  const row = toMikhmonRow({
    name: "mktabc123",
    password: "pass1234",
    profile: "24hrs",
    "mac-address": "aa:bb:cc:dd:ee:ff",
    comment: "2026-10-22 18:22:00",
  })!;
  assertEquals(row.transaction_id, "mikhmon-mktabc123");
  assertEquals(row.customer_email, "Mikhmon");
  assertEquals(row.customer_phone, "Mikhmon");
  assertEquals(row.plan, "24hr");
  assertEquals(row.mikrotik_username, "mktabc123");
  assertEquals(row.mikrotik_password, "pass1234");
  assertEquals(row.mac_address, "AA:BB:CC:DD:EE:FF");
  assertEquals(row.status, "processed");
  assertEquals(row.expires_at, "2026-10-22T17:22:00.000Z");
});

Deno.test("toMikhmonRow marks disabled/exhausted users expired", () => {
  assertEquals(toMikhmonRow({ name: "u1", disabled: "true" })!.status, "expired");
  assertEquals(toMikhmonRow({ name: "u2", "limit-uptime": "1s" })!.status, "expired");
  assertEquals(toMikhmonRow({ name: "u3" })!.status, "processed");
});

Deno.test("toMikhmonRow rejects empty names and bad MACs", () => {
  assertEquals(toMikhmonRow({ name: "   " }), null);
  assertEquals(toMikhmonRow({ name: "u4", mac: "not-a-mac" })!.mac_address, "");
});

// ---------- fake Supabase (thenable query) ----------
class Query {
  db: FakeDb;
  table: string;
  mode = "select";
  payload: any = null;
  eqs: Array<[string, unknown]> = [];
  likes: Array<[string, unknown]> = [];

  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }
  select() { this.mode = "select"; return this; }
  like(col: string, val: unknown) { this.likes.push([col, val]); return this; }
  eq(col: string, val: unknown) { this.eqs.push([col, val]); return this; }
  update(row: any) { this.mode = "update"; this.payload = row; return this; }
  insert(row: any) { this.mode = "insert"; this.payload = row; return this; }

  then(resolve: (value: any) => void) {
    if (this.mode === "select") {
      resolve({ data: this.db.select(this.table, this.eqs, this.likes), error: null });
    } else if (this.mode === "insert") {
      this.db.insert(this.table, this.payload);
      resolve({ error: null });
    } else {
      this.db.update(this.table, this.payload, this.eqs);
      resolve({ error: null });
    }
  }
}

class FakeDb {
  tables: Record<string, any[]> = { payment_queue: [] };
  ops: Array<{ type: string; row: any }> = [];
  nextId = 1;

  from(table: string) { return new Query(this, table); }

  select(table: string, eqs: Array<[string, unknown]>, likes: Array<[string, unknown]>) {
    return (this.tables[table] ?? [])
      .filter((row) =>
        eqs.every(([col, val]) => {
          if (col === "status") return row.status === val;
          if (col === "id") return row.id === val;
          if (col === "transaction_id") return row.transaction_id === val;
          if (col === "mikrotik_username") return row.mikrotik_username === val;
          return true;
        })
      )
      .filter((row) =>
        likes.every(([col, val]) => {
          if (col === "transaction_id") {
            return String(row.transaction_id ?? "").startsWith(String(val).replace(/%$/, ""));
          }
          return true;
        })
      );
  }
  insert(table: string, row: any) {
    this.ops.push({ type: "insert", row });
    this.tables[table].push({ ...row, id: this.nextId++ });
  }
  update(table: string, row: any, eqs: Array<[string, unknown]>) {
    this.ops.push({ type: "update", row });
    const idFilter = eqs.find(([col]) => col === "id")?.[1];
    for (const existing of this.tables[table]) {
      if (idFilter === undefined || existing.id === idFilter) Object.assign(existing, row);
    }
  }
}

Deno.test("sync creates new users, updates existing, expires missing only when complete", async () => {
  const db = new FakeDb();
  db.tables.payment_queue.push(
    { id: 1, transaction_id: "mikhmon-old", mikrotik_username: "old", status: "processed" },
    { id: 2, transaction_id: "mikhmon-gone", mikrotik_username: "gone", status: "processed" },
    { id: 3, transaction_id: "pay-1", mikrotik_username: "paid", status: "processed" },
  );

  const res = await syncMikhmonUsers(db, [
    { name: "old", password: "p1", profile: "3-Days", comment: "" },
    { name: "new", password: "p2", profile: "7-Days", comment: "2026-10-22 18:22:00" },
  ], { complete: true });

  assertEquals(res.updated, 1);
  assertEquals(res.created, 1);
  assertEquals(res.expired, 1);
  assertEquals(res.failed, 0);

  const newRow = db.tables.payment_queue.find((r) => r.transaction_id === "mikhmon-new")!;
  assertEquals(newRow.customer_email, "Mikhmon");
  assertEquals(newRow.customer_phone, "Mikhmon");
  assertEquals(newRow.plan, "7d");
  assertEquals(newRow.status, "processed");
  assertEquals(newRow.expires_at, "2026-10-22T17:22:00.000Z");

  const gone = db.tables.payment_queue.find((r) => r.transaction_id === "mikhmon-gone")!;
  assertEquals(gone.status, "expired");
  const paid = db.tables.payment_queue.find((r) => r.transaction_id === "pay-1")!;
  assertEquals(paid.status, "processed");
});

Deno.test("sync dry-run writes nothing", async () => {
  const db = new FakeDb();
  const res = await syncMikhmonUsers(db, [{ name: "u1", profile: "24hrs" }], { dryRun: true });
  assertEquals(res.valid, 1);
  assertEquals(res.created, 0);
  assertEquals(db.ops.length, 0);
});

Deno.test("sync without complete never expires missing users", async () => {
  const db = new FakeDb();
  db.tables.payment_queue.push(
    { id: 1, transaction_id: "mikhmon-gone", mikrotik_username: "gone", status: "processed" },
  );
  const res = await syncMikhmonUsers(db, [{ name: "new" }], { complete: false });
  assertEquals(res.expired, 0);
  assertEquals(db.tables.payment_queue[0].status, "processed");
});

Deno.test("sync with an empty complete payload does not expire everyone", async () => {
  const db = new FakeDb();
  db.tables.payment_queue.push(
    { id: 1, transaction_id: "mikhmon-a", mikrotik_username: "a", status: "processed" },
  );
  const res = await syncMikhmonUsers(db, [], { complete: true });
  assertEquals(res.expired, 0);
  assertEquals(db.tables.payment_queue[0].status, "processed");
});

Deno.test("sync sends disabled users as expired", async () => {
  const db = new FakeDb();
  await syncMikhmonUsers(db, [{ name: "dead", disabled: "true" }], { complete: true });
  const row = db.tables.payment_queue.find((r) => r.transaction_id === "mikhmon-dead")!;
  assertEquals(row.status, "expired");
  assert(db.ops.some((o) => o.type === "insert"));
});
