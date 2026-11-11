import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import type { Driver, Session } from "neo4j-driver";
import { neo4jAdapter, type Neo4jBetterAuthConfig } from "../../src/index.js";
import { connect, migrate, resetDatabase, withoutResultSummaries } from "../helpers/neo4j.js";

/** Adapter behaviour that the Better Auth conformance suite does not pin down for Neo4j. */
let driver: Driver;
let summarylessSession: Session;

beforeAll(async () => {
	driver = connect();
	summarylessSession = driver.session();
	await migrate(driver);
});

beforeEach(async () => {
	await resetDatabase(driver);
});

afterAll(async () => {
	await summarylessSession.close();
	await driver.close();
});

async function adapterFor(database: Neo4jBetterAuthConfig) {
	const auth = betterAuth({
		secret: "test-secret-that-is-long-enough-for-better-auth",
		database: neo4jAdapter(database),
	});
	return (await auth.$context).adapter;
}

type Adapter = Awaited<ReturnType<typeof adapterFor>>;

function createVerification(adapter: Adapter, identifier: string, value = "v") {
	return adapter.create<Record<string, unknown>>({
		model: "verification",
		data: { identifier, value, expiresAt: new Date(Date.now() + 60_000) },
	});
}

function createUser(adapter: Adapter, email: string) {
	return adapter.create<{ id: string }>({
		model: "user",
		data: { email, name: "Test", emailVerified: false },
	});
}

const byIdentifier = (identifier: string) => [{ field: "identifier", value: identifier }];

describe.each([
	["a shared driver", () => ({ driver })],
	["results without a summary", () => ({ session: withoutResultSummaries(summarylessSession) })],
] as const)("deleteMany with %s", (_label, database) => {
	it("returns the number of deleted rows", async () => {
		const adapter = await adapterFor(database());
		await createVerification(adapter, "del-1");
		await createVerification(adapter, "del-2");
		await createVerification(adapter, "keep");

		const deleted = await adapter.deleteMany({
			model: "verification",
			where: [{ field: "identifier", operator: "starts_with", value: "del-" }],
		});

		expect(deleted).toBe(2);
		expect(await adapter.count({ model: "verification" })).toBe(1);
	});

	it("returns 0 when nothing matches", async () => {
		const adapter = await adapterFor(database());
		expect(
			await adapter.deleteMany({ model: "verification", where: byIdentifier("missing") }),
		).toBe(0);
	});

	it("returns the count inside a transaction", async () => {
		const adapter = await adapterFor(database());
		await createVerification(adapter, "tx-1");
		const deleted = await adapter.transaction((trx) =>
			trx.deleteMany({ model: "verification", where: byIdentifier("tx-1") }),
		);
		expect(deleted).toBe(1);
	});
});

describe("consumeOne", () => {
	it("returns the row and deletes it", async () => {
		const adapter = await adapterFor({ driver });
		await createVerification(adapter, "token", "secret-value");

		const consumed = await adapter.consumeOne<{ value: string }>({
			model: "verification",
			where: byIdentifier("token"),
		});

		expect(consumed?.value).toBe("secret-value");
		expect(await adapter.count({ model: "verification" })).toBe(0);
	});

	it("returns null when nothing matches", async () => {
		const adapter = await adapterFor({ driver });
		expect(
			await adapter.consumeOne({ model: "verification", where: byIdentifier("missing") }),
		).toBeNull();
	});

	it("deletes only one row when several match", async () => {
		const adapter = await adapterFor({ driver });
		await createVerification(adapter, "dup");
		await createVerification(adapter, "dup");

		expect(
			await adapter.consumeOne({ model: "verification", where: byIdentifier("dup") }),
		).not.toBeNull();
		expect(await adapter.count({ model: "verification" })).toBe(1);
	});

	it("supports OR predicates", async () => {
		const adapter = await adapterFor({ driver });
		await createVerification(adapter, "or-b", "b");

		const consumed = await adapter.consumeOne<{ value: string }>({
			model: "verification",
			where: [
				{ field: "identifier", value: "or-a" },
				{ field: "identifier", value: "or-b", connector: "OR" },
			],
		});

		expect(consumed?.value).toBe("b");
		expect(await adapter.count({ model: "verification" })).toBe(0);
	});

	it("lets exactly one of many concurrent consumers win", async () => {
		const adapter = await adapterFor({ driver });
		await createVerification(adapter, "race");

		const results = await Promise.all(
			Array.from({ length: 10 }, () =>
				adapter.consumeOne({ model: "verification", where: byIdentifier("race") }),
			),
		);

		expect(results.filter((row) => row !== null)).toHaveLength(1);
		expect(await adapter.count({ model: "verification" })).toBe(0);
	});

	it("works when results carry no summary", async () => {
		const adapter = await adapterFor({ session: withoutResultSummaries(summarylessSession) });
		await createVerification(adapter, "token");
		expect(
			await adapter.consumeOne({ model: "verification", where: byIdentifier("token") }),
		).not.toBeNull();
	});
});

describe("relationships", () => {
	async function createSession(adapter: Adapter, userId: string, token: string) {
		return adapter.create({
			model: "session",
			data: { userId, token, expiresAt: new Date(Date.now() + 60_000) },
		});
	}

	it("links a child to its parent with a HAS_* edge", async () => {
		const adapter = await adapterFor({ driver });
		const user = await createUser(adapter, "edges@example.com");
		await createSession(adapter, user.id, "t1");

		const { records } = await driver.executeQuery(
			"MATCH (:user {id: $id})-[r:HAS_SESSION]->(:session) RETURN count(r) AS c",
			{ id: user.id },
		);
		expect(records[0]?.get("c").toNumber()).toBe(1);
	});

	it("cascades deletes to children declared with onDelete: cascade", async () => {
		const adapter = await adapterFor({ driver });
		const user = await createUser(adapter, "cascade@example.com");
		await createSession(adapter, user.id, "t1");
		await createSession(adapter, user.id, "t2");
		const other = await createUser(adapter, "other@example.com");
		await createSession(adapter, other.id, "t3");

		await adapter.delete({ model: "user", where: [{ field: "id", value: user.id }] });

		expect(await adapter.count({ model: "session" })).toBe(1);
		expect(await adapter.count({ model: "user" })).toBe(1);
	});
});
