import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  dateKey,
  priceOf,
  revenueByDay,
  revenueByMonth,
  sumRevenue,
} from "./revenue.ts";

Deno.test("priceOf uses the Alimu plan prices", () => {
  assertEquals(priceOf("24hr"), 200);
  assertEquals(priceOf("3d"), 600);
  assertEquals(priceOf("5d"), 1000);
  assertEquals(priceOf("7d"), 1400);
  assertEquals(priceOf("14d"), 2500);
  assertEquals(priceOf("30d"), 5000);
  assertEquals(priceOf("6h"), 0);
  assertEquals(priceOf("default"), 0);
});

Deno.test("dateKey is Lagos local date", () => {
  assertEquals(dateKey("2026-10-22T23:30:00Z"), "2026-10-23");
  assertEquals(dateKey("2026-10-22T10:00:00Z"), "2026-10-22");
});

Deno.test("sumRevenue filters from a Lagos date and ignores free plans", () => {
  const rows = [
    { plan: "24hr", created_at: "2026-10-21T10:00:00Z" },
    { plan: "3d", created_at: "2026-10-22T10:00:00Z" },
    { plan: "24hr", created_at: "2026-10-23T10:00:00Z" },
    { plan: "6h", created_at: "2026-10-23T10:00:00Z" },
  ];
  assertEquals(sumRevenue(rows), 1000);
  assertEquals(sumRevenue(rows, "2026-10-22"), 800);
  assertEquals(sumRevenue(rows, "2026-10-23"), 200);
});

Deno.test("revenueByMonth and revenueByDay group correctly", () => {
  const rows = [
    { plan: "24hr", created_at: "2026-10-22T10:00:00Z" },
    { plan: "24hr", created_at: "2026-10-22T12:00:00Z" },
    { plan: "3d", created_at: "2026-10-23T10:00:00Z" },
  ];
  assertEquals(revenueByMonth(rows)["2026-10"], 1000);
  assertEquals(revenueByDay(rows, "2026-10"), { 22: 400, 23: 600 });
});
