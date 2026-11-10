import type { Driver, ManagedTransaction, Session } from "neo4j-driver";

export type QueryResult = Awaited<ReturnType<ManagedTransaction["run"]>>;
export type RunCypher = (
	cypher: string,
	params?: Record<string, unknown>,
) => Promise<QueryResult>;

/** Executes Cypher either through short-lived sessions or inside one managed transaction. */
export interface CypherRunner {
	read: RunCypher;
	write: RunCypher;
	/** Run several statements atomically; `run` executes inside the same write transaction. */
	inWriteTransaction<T>(fn: (run: RunCypher) => Promise<T>): Promise<T>;
}

export interface SessionSource {
	driver?: Driver;
	session?: Session;
	database?: string;
}

/**
 * Lend a session to `fn`. With a driver, each call opens and closes its own session so
 * concurrent callers never share an open transaction; a user-supplied session is reused as-is.
 */
export async function withSession<T>(
	source: SessionSource,
	fn: (session: Session) => Promise<T>,
): Promise<T> {
	if (source.session) return fn(source.session);
	if (!source.driver) {
		throw new Error("neo4jAdapter: provide `driver` or `session`");
	}
	const session = source.driver.session({ database: source.database });
	try {
		return await fn(session);
	} finally {
		await session.close();
	}
}

export function sessionRunner(source: SessionSource): CypherRunner {
	return {
		read: (cypher, params) =>
			withSession(source, (s) => s.executeRead((tx) => tx.run(cypher, params))),
		write: (cypher, params) =>
			withSession(source, (s) => s.executeWrite((tx) => tx.run(cypher, params))),
		inWriteTransaction: (fn) =>
			withSession(source, (s) => s.executeWrite((tx) => fn(transactionRunner(tx).write))),
	};
}

export function transactionRunner(tx: ManagedTransaction): CypherRunner {
	const run: RunCypher = (cypher, params) => tx.run(cypher, params);
	return { read: run, write: run, inWriteTransaction: (fn) => fn(run) };
}
