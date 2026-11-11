import { describe, expect, it, vi } from "vitest";
import type { Driver, ManagedTransaction, Session } from "neo4j-driver";
import { sessionRunner, transactionRunner, withSession } from "../../src/cypher-runner.js";

function fakeSession() {
	const tx = { run: vi.fn(async () => ({ records: [] })) } as unknown as ManagedTransaction;
	const session = {
		close: vi.fn(async () => {}),
		executeRead: vi.fn((work: (t: ManagedTransaction) => unknown) => work(tx)),
		executeWrite: vi.fn((work: (t: ManagedTransaction) => unknown) => work(tx)),
	};
	return { tx, session: session as typeof session & Session };
}

function fakeDriver(session: Session) {
	return { session: vi.fn(() => session) } as unknown as Driver & {
		session: ReturnType<typeof vi.fn>;
	};
}

describe("withSession", () => {
	it("requires a driver or a session", async () => {
		await expect(withSession({}, async () => 1)).rejects.toThrow(/provide `driver` or `session`/);
	});

	it("opens a session on the configured database and always closes it", async () => {
		const { session } = fakeSession();
		const driver = fakeDriver(session);

		await expect(
			withSession({ driver, database: "auth" }, async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");

		expect(driver.session).toHaveBeenCalledWith({ database: "auth" });
		expect(session.close).toHaveBeenCalledOnce();
	});

	it("reuses a caller-owned session without closing it", async () => {
		const { session } = fakeSession();
		expect(await withSession({ session }, async (s) => s)).toBe(session);
		expect(session.close).not.toHaveBeenCalled();
	});
});

describe("sessionRunner", () => {
	it("routes reads and writes to the matching managed transaction", async () => {
		const { session, tx } = fakeSession();
		const runner = sessionRunner({ session });

		await runner.read("MATCH (n) RETURN n");
		await runner.write("CREATE (n)", { a: 1 });

		expect(session.executeRead).toHaveBeenCalledOnce();
		expect(session.executeWrite).toHaveBeenCalledOnce();
		expect(tx.run).toHaveBeenCalledWith("CREATE (n)", { a: 1 });
	});

	it("runs a multi-statement unit in a single write transaction", async () => {
		const { session, tx } = fakeSession();
		await sessionRunner({ session }).inWriteTransaction(async (run) => {
			await run("A");
			await run("B");
		});
		expect(session.executeWrite).toHaveBeenCalledOnce();
		expect(tx.run).toHaveBeenCalledTimes(2);
	});
});

describe("transactionRunner", () => {
	it("sends every statement through the given transaction", async () => {
		const { tx } = fakeSession();
		const runner = transactionRunner(tx);
		await runner.read("R");
		await runner.write("W");
		await runner.inWriteTransaction((run) => run("T"));
		expect(vi.mocked(tx.run).mock.calls.map(([cypher]) => cypher)).toEqual(["R", "W", "T"]);
	});
});
