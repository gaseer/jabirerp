import { beforeEach, describe, expect, it } from "vitest";
import { db, type ProfileRow } from "@/lib/db";
import { DexieRepo } from "./DexieRepo";

const OWNER = "owner-123";
const repo = new DexieRepo<ProfileRow>(db.profiles, "profiles", () => OWNER);

beforeEach(async () => {
  await db.profiles.clear();
  await db.outbox.clear();
});

describe("DexieRepo (local source of truth)", () => {
  it("put then getById round-trips and stamps metadata", async () => {
    const saved = await repo.put({ display_name: "Jabir" });

    expect(saved.id).toBeTruthy();
    expect(saved.owner_id).toBe(OWNER);
    expect(saved.deleted_at).toBeNull();
    expect(saved._dirty).toBe(1);

    const read = await repo.getById(saved.id);
    expect(read?.display_name).toBe("Jabir");
  });

  it("queues every write to the outbox for later sync", async () => {
    await repo.put({ display_name: "A" });
    expect(await db.outbox.count()).toBe(1);
  });

  it("softDelete hides the row from reads but keeps history", async () => {
    const saved = await repo.put({ display_name: "B" });
    await repo.softDelete(saved.id);

    expect(await repo.getById(saved.id)).toBeUndefined();
    expect((await repo.getAll()).length).toBe(0);

    // history preserved (soft, not destroyed)
    const raw = await db.profiles.get(saved.id);
    expect(raw?.deleted_at).not.toBeNull();

    // delete was also queued
    const ops = await db.outbox.toArray();
    expect(ops.some((o) => o.op === "delete")).toBe(true);
  });

  it("put preserves created_at on update but bumps updated_at", async () => {
    const a = await repo.put({ display_name: "C" });
    await new Promise((r) => setTimeout(r, 5));
    const b = await repo.put({ id: a.id, display_name: "C2" });

    expect(b.created_at).toBe(a.created_at);
    expect(b.updated_at >= a.updated_at).toBe(true);
    expect(b.display_name).toBe("C2");
  });
});
