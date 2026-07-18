import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory fake Supabase: a Map keyed by `${table}:${id}`.
const server = new Map<string, Record<string, unknown>>();
// Tables whose upserts fail — simulates a poison row / missing table.
const failingTables = new Set<string>();

vi.mock("@/lib/supabase", () => {
  const api = {
    from(table: string) {
      return {
        upsert(row: Record<string, unknown>) {
          if (failingTables.has(table)) {
            return Promise.resolve({ error: { message: `boom: ${table}` } });
          }
          server.set(`${table}:${row.id}`, row);
          return Promise.resolve({ error: null });
        },
        select() {
          let gtVal: string | null = null;
          const exec = (limitN: number) => {
            const rows = [...server.entries()]
              .filter(([k]) => k.startsWith(`${table}:`))
              .map(([, v]) => v)
              .filter((r) => !gtVal || (r.updated_at as string) > gtVal)
              .sort((a, b) =>
                (a.updated_at as string).localeCompare(b.updated_at as string),
              )
              .slice(0, limitN);
            return Promise.resolve({ data: rows, error: null });
          };
          const chain = {
            gt(_col: string, val: string) {
              gtVal = val;
              return chain;
            },
            order() {
              return chain;
            },
            limit(n: number) {
              return exec(n);
            },
          };
          return chain;
        },
      };
    },
  };
  return { supabase: api };
});

import { db } from "@/lib/db";
import { siteRepo } from "@/repo/repos";
import { sync } from "@/repo/SupabaseSync";
import { useAuth } from "@/store/auth";

beforeEach(async () => {
  server.clear();
  failingTables.clear();
  await db.sites.clear();
  await db.profiles.clear();
  await db.outbox.clear();
  await db.meta.clear();
  vi.stubGlobal("navigator", { onLine: true });
  // @ts-expect-error minimal user for currentOwnerId
  useAuth.setState({ user: { id: "u1" } });
});

describe("SupabaseSync", () => {
  it("push sends queued writes and clears _dirty", async () => {
    const s = await siteRepo.put({
      name: "Villa",
      phone: null,
      location: null,
      work_type: "Mixed",
      status: "Active",
    });
    expect(await db.outbox.count()).toBe(1);

    const { pushed } = await sync.push();

    expect(pushed).toBe(1);
    expect(await db.outbox.count()).toBe(0); // drained
    expect(server.has(`sites:${s.id}`)).toBe(true); // reached server
    expect((server.get(`sites:${s.id}`) as Record<string, unknown>)._dirty).toBeUndefined(); // local field stripped
    expect((await db.sites.get(s.id))?._dirty).toBe(0); // flag cleared
  });

  it("pull merges remote rows the client has never seen", async () => {
    server.set("sites:remote1", {
      id: "remote1",
      owner_id: "u1",
      name: "From other device",
      phone: null,
      location: null,
      work_type: "Electrical",
      status: "Active",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      deleted_at: null,
    });

    const { pulled } = await sync.pull();

    expect(pulled).toBe(1);
    const local = await db.sites.get("remote1");
    expect(local?.name).toBe("From other device");
    expect(local?._dirty).toBe(0);
    // cursor advanced so a second pull is a no-op
    expect((await sync.pull()).pulled).toBe(0);
  });

  it("pull does not clobber a locally-dirty (unpushed) row", async () => {
    const s = await siteRepo.put({
      name: "Local edit",
      phone: null,
      location: null,
      work_type: "Mixed",
      status: "Active",
    });
    // Stale remote copy of the same id.
    server.set(`sites:${s.id}`, {
      ...s,
      name: "Stale remote",
      updated_at: "2000-01-01T00:00:00Z",
    });

    await sync.pull();

    expect((await db.sites.get(s.id))?.name).toBe("Local edit");
  });

  it("coalesces multiple queued snapshots of the same row into one push", async () => {
    const s = await siteRepo.put({
      name: "v1",
      phone: null,
      location: null,
      work_type: "Mixed",
      status: "Active",
    });
    await siteRepo.put({ ...s, name: "v2" });
    await siteRepo.put({ ...s, name: "v3" });
    expect(await db.outbox.count()).toBe(3);

    const { pushed } = await sync.push();

    expect(pushed).toBe(1); // only the newest snapshot travels
    expect(await db.outbox.count()).toBe(0);
    expect((server.get(`sites:${s.id}`) as Record<string, unknown>).name).toBe("v3");
  });

  it("drops queued items that belong to another account", async () => {
    const s = await siteRepo.put({
      name: "Mine",
      phone: null,
      location: null,
      work_type: "Mixed",
      status: "Active",
    });
    // A stale item from a previous login on this device — RLS would 403 forever.
    await db.outbox.put({
      id: "stale-1",
      table: "sites",
      op: "put",
      row_id: "other-row",
      payload: { id: "other-row", owner_id: "someone-else", name: "Not mine" },
      queued_at: "2000-01-01T00:00:00Z",
    });

    const { pushed } = await sync.push();

    expect(pushed).toBe(1); // only the current user's row
    expect(server.has(`sites:${s.id}`)).toBe(true);
    expect(server.has("sites:other-row")).toBe(false);
    expect(await db.outbox.count()).toBe(0); // stale item discarded, not stuck
  });

  it("a failing table does not block other tables' pushes", async () => {
    // profiles will fail (e.g. its migration is missing on the server).
    failingTables.add("profiles");
    const { profileRepo } = await import("@/repo/repos");
    await profileRepo.put({ id: "u1", display_name: "Me" });
    const s = await siteRepo.put({
      name: "Still syncs",
      phone: null,
      location: null,
      work_type: "Mixed",
      status: "Active",
    });

    const { pushed } = await sync.push();

    expect(pushed).toBe(1); // the site went through
    expect(server.has(`sites:${s.id}`)).toBe(true);
    expect(await db.outbox.count()).toBe(1); // the profile stays queued for retry
    // Once the table recovers, the queued item pushes.
    failingTables.clear();
    expect((await sync.push()).pushed).toBe(1);
    expect(await db.outbox.count()).toBe(0);
  });

  it("pull compares Postgres (+00:00) and local (Z) timestamps correctly", async () => {
    const s = await siteRepo.put({
      name: "Local",
      phone: null,
      location: null,
      work_type: "Mixed",
      status: "Active",
    });
    await sync.push(); // clears _dirty so pull's LWW compare runs
    // Remote edit one year LATER, in Postgres offset format.
    server.set(`sites:${s.id}`, {
      ...server.get(`sites:${s.id}`),
      name: "Remote newer",
      updated_at: "2027-01-01T00:00:00.123456+00:00",
    });

    await sync.pull();

    expect((await db.sites.get(s.id))?.name).toBe("Remote newer");
  });

  it("pull pages past the server row cap", async () => {
    // 3 remote rows with distinct timestamps; PULL_PAGE is 1000, but the mock
    // honors .limit() — verify all rows land even across multiple pages.
    for (let i = 1; i <= 3; i++) {
      server.set(`sites:r${i}`, {
        id: `r${i}`,
        owner_id: "u1",
        name: `Site ${i}`,
        phone: null,
        location: null,
        work_type: "Mixed",
        status: "Active",
        created_at: `2026-01-0${i}T00:00:00Z`,
        updated_at: `2026-01-0${i}T00:00:00Z`,
        deleted_at: null,
      });
    }

    const { pulled } = await sync.pull();

    expect(pulled).toBe(3);
    expect(await db.sites.count()).toBe(3);
  });

  it("is a no-op when offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    await siteRepo.put({
      name: "Offline",
      phone: null,
      location: null,
      work_type: "Mixed",
      status: "Active",
    });
    expect((await sync.push()).pushed).toBe(0);
    expect(await db.outbox.count()).toBe(1); // still queued
  });
});
