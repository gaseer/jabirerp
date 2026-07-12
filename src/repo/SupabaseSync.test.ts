import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory fake Supabase: a Map keyed by `${table}:${id}`.
const server = new Map<string, Record<string, unknown>>();

vi.mock("@/lib/supabase", () => {
  const api = {
    from(table: string) {
      return {
        upsert(row: Record<string, unknown>) {
          server.set(`${table}:${row.id}`, row);
          return Promise.resolve({ error: null });
        },
        select() {
          let gtVal: string | null = null;
          const chain = {
            gt(_col: string, val: string) {
              gtVal = val;
              return chain;
            },
            order() {
              const rows = [...server.entries()]
                .filter(([k]) => k.startsWith(`${table}:`))
                .map(([, v]) => v)
                .filter((r) => !gtVal || (r.updated_at as string) > gtVal)
                .sort((a, b) =>
                  (a.updated_at as string).localeCompare(b.updated_at as string),
                );
              return Promise.resolve({ data: rows, error: null });
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
