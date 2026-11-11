import { inject } from "vitest";
import neo4j, { type Driver, type ManagedTransaction, type Session } from "neo4j-driver";
import type { BetterAuthOptions } from "better-auth/types";
import { getAuthTables } from "better-auth/db";
import { initGetFieldName, initGetModelName } from "better-auth/adapters";
import { runCypherMigration } from "../../src/index.js";

/** Driver for the container started by `neo4j-global-setup.ts`. */
export function connect(): Driver {
	const { uri, username, password } = inject("neo4j");
	return neo4j.driver(uri, neo4j.auth.basic(username, password));
}

/** Remove every node so a test file starts from an empty graph. */
export async function resetDatabase(driver: Driver): Promise<void> {
	await driver.executeQuery("MATCH (n) DETACH DELETE n");
}

/** Create the constraints and indexes for a Better Auth configuration. */
export async function migrate(driver: Driver, options: BetterAuthOptions = {}): Promise<void> {
	const tables = getAuthTables(options);
	const usePlural = false;
	const getModelName = initGetModelName({ schema: tables, usePlural });
	const getFieldName = initGetFieldName({ schema: tables, usePlural });
	await runCypherMigration(
		async (cypher) => {
			await driver.executeQuery(cypher);
		},
		tables,
		(schemaKey) => getModelName(schemaKey),
		(args) => getFieldName(args),
	);
}

/**
 * Wrap a session so every `tx.run` resolves to `{ records }` only, with no `summary`.
 * Some runtimes and driver shims (e.g. on edge workers) behave this way (issue #2).
 */
export function withoutResultSummaries(session: Session): Session {
	const stripSummary = (tx: ManagedTransaction): ManagedTransaction =>
		new Proxy(tx, {
			get(target, prop, receiver) {
				if (prop !== "run") return Reflect.get(target, prop, receiver);
				return async (cypher: string, params?: Record<string, unknown>) => {
					const { records } = await target.run(cypher, params);
					return { records };
				};
			},
		});
	return new Proxy(session, {
		get(target, prop, receiver) {
			if (prop === "executeRead" || prop === "executeWrite") {
				return <T>(work: (tx: ManagedTransaction) => Promise<T>) =>
					target[prop]((tx) => work(stripSummary(tx)));
			}
			return Reflect.get(target, prop, receiver);
		},
	});
}
