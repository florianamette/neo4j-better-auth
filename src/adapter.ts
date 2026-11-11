import {
	createAdapterFactory,
	type AdapterFactory,
	type AdapterFactoryConfig,
	type AdapterFactoryOptions,
	type CleanedWhere,
	type CustomAdapter,
} from "better-auth/adapters";
import type { BetterAuthOptions } from "better-auth/types";
import Cypher from "@neo4j/cypher-builder";
import {
	sessionRunner,
	transactionRunner,
	withSession,
	type CypherRunner,
	type QueryResult,
	type RunCypher,
	type SessionSource,
} from "./cypher-runner.js";
import { escapeIdentifier } from "./label.js";
import { buildSchemaStatements } from "./migrations.js";
import {
	asNode,
	propertiesToPlain,
	toCount,
	toNeo4jProperties,
} from "./neo4j-record.js";
import {
	cascadeTargets,
	linkReferenceEdges,
	relinkReferenceEdges,
	type ChildNode,
} from "./relations.js";
import { pickSelectedFields, withMissingFieldsAsNull } from "./rows.js";
import {
	allowedProperties,
	idProperty,
	type SchemaContext,
} from "./schema-context.js";
import type { Neo4jBetterAuthConfig } from "./types.js";
import { buildWherePredicate } from "./where.js";

type AdapterContext = Parameters<AdapterFactoryOptions["adapter"]>[0];
type Row = Record<string, unknown>;
type SortBy = { field: string; direction: "asc" | "desc" };

const SCHEMA_FILE = "neo4j-schema.cypher";

function whereIn(field: string, values: unknown[]): CleanedWhere {
	return {
		field,
		operator: "in",
		value: values as string[],
		connector: "AND",
		mode: "sensitive",
	};
}

export function neo4jAdapter(
	input: Neo4jBetterAuthConfig,
): AdapterFactory<BetterAuthOptions> {
	if (!input.driver && !input.session) {
		throw new Error("neo4jAdapter: provide `driver` or `session`");
	}
	const source: SessionSource = {
		driver: input.driver,
		session: input.session,
		database: input.database,
	};

	/** Better Auth hands us its options when the adapter is instantiated; transactions need them again. */
	let resolvedOptions: BetterAuthOptions | undefined;

	const config: AdapterFactoryConfig = {
		adapterId: "neo4j",
		adapterName: "Neo4j",
		usePlural: input.usePlural ?? false,
		debugLogs: input.debugLogs ?? false,
		supportsJSON: false,
		supportsDates: false,
		supportsBooleans: true,
		supportsArrays: true,
		transaction: (callback) =>
			withSession(source, (session) =>
				session.executeWrite((tx) => {
					if (!resolvedOptions) {
						throw new Error("neo4jAdapter: adapter options not initialized");
					}
					const transactional = createAdapterFactory({
						config,
						adapter: createOperations(transactionRunner(tx)),
					});
					return callback(
						transactional(resolvedOptions) as Parameters<typeof callback>[0],
					);
				}),
			),
	};

	const factory = createAdapterFactory({
		config,
		adapter: createOperations(sessionRunner(source)),
	});

	return (options) => {
		resolvedOptions = options;
		return factory(options);
	};
}

function createOperations(runner: CypherRunner) {
	return (ctx: AdapterContext): CustomAdapter => {
		const schema: SchemaContext = ctx;
		const schemaKeyOf = (model: string) => ctx.getDefaultModelName(model);

		function matchModel(model: string, where: CleanedWhere[] | undefined) {
			const node = new Cypher.NamedNode("n");
			const clause = new Cypher.Match(new Cypher.Pattern(node, { labels: [model] }));
			const predicate = buildWherePredicate(
				node,
				where,
				allowedProperties(schema, schemaKeyOf(model)),
			);
			return { node, clause: predicate ? clause.where(predicate) : clause };
		}

		function runClause(run: RunCypher, clause: Cypher.Clause): Promise<QueryResult> {
			const { cypher, params } = clause.build();
			return run(cypher, params);
		}

		function rowFromRecord(result: QueryResult, model: string): Row | null {
			const node = asNode(result.records[0]?.get("n"));
			if (!node) return null;
			return withMissingFieldsAsNull(schema, schemaKeyOf(model), propertiesToPlain(node));
		}

		function rowsFromResult(result: QueryResult, model: string): Row[] {
			const schemaKey = schemaKeyOf(model);
			return result.records
				.map((record) => asNode(record.get("n")))
				.filter((node) => node !== null)
				.map((node) => withMissingFieldsAsNull(schema, schemaKey, propertiesToPlain(node)));
		}

		function childNodeOf(model: string, row: Row): ChildNode | null {
			const schemaKey = schemaKeyOf(model);
			const id = row[idProperty(schema, schemaKey)];
			if (typeof id !== "string" && typeof id !== "number") return null;
			return { schemaKey, label: model, id: String(id) };
		}

		function assertSortable(model: string, sortBy: SortBy | undefined): void {
			if (!sortBy) return;
			if (!allowedProperties(schema, schemaKeyOf(model)).has(sortBy.field)) {
				throw new Error(`neo4jAdapter: invalid sort field "${sortBy.field}"`);
			}
		}

		async function findOneRow(
			run: RunCypher,
			model: string,
			where: CleanedWhere[],
			select?: string[],
		): Promise<Row | null> {
			const { node, clause } = matchModel(model, where);
			const result = await runClause(run, clause.return(node).limit(1));
			const row = rowFromRecord(result, model);
			return row && pickSelectedFields(schema, schemaKeyOf(model), row, select);
		}

		async function countRows(
			run: RunCypher,
			model: string,
			where: CleanedWhere[] | undefined,
		): Promise<number> {
			const { node, clause } = matchModel(model, where);
			const result = await runClause(run, clause.return([Cypher.count(node), "c"]));
			return toCount(result.records[0]?.get("c"));
		}

		async function collectIds(
			run: RunCypher,
			model: string,
			where: CleanedWhere[] | undefined,
		): Promise<unknown[]> {
			const { node, clause } = matchModel(model, where);
			const idProp = idProperty(schema, schemaKeyOf(model));
			const result = await runClause(run, clause.return([node.property(idProp), "id"]));
			return result.records.map((record) => record.get("id"));
		}

		/**
		 * Neo4j has no foreign keys, so cascades declared in the Better Auth schema
		 * (`references.onDelete: "cascade"`) are applied here, depth first.
		 * `lineage` guards against cyclic references.
		 */
		async function deleteCascadingChildren(
			run: RunCypher,
			model: string,
			where: CleanedWhere[] | undefined,
			lineage: ReadonlySet<string>,
		): Promise<void> {
			const schemaKey = schemaKeyOf(model);
			const targets = cascadeTargets(schema, schemaKey).filter(
				(target) => !lineage.has(target.schemaKey),
			);
			if (targets.length === 0) return;
			const ids = await collectIds(run, model, where);
			if (ids.length === 0) return;
			const childLineage = new Set([...lineage, schemaKey]);
			for (const target of targets) {
				await deleteNodes(run, target.label, [whereIn(target.fkProp, ids)], childLineage);
			}
		}

		async function deleteNodes(
			run: RunCypher,
			model: string,
			where: CleanedWhere[] | undefined,
			lineage: ReadonlySet<string> = new Set(),
		): Promise<number> {
			await deleteCascadingChildren(run, model, where, lineage);
			const { cypher, params } = matchModel(model, where).clause.build();
			// Count from the returned record rather than `result.summary.counters`: the summary
			// is not available in every runtime/driver setup (see issue #2).
			const result = await run(`${cypher}\nDETACH DELETE n\nRETURN count(*) AS c`, params);
			return toCount(result.records[0]?.get("c"));
		}

		/**
		 * Atomically read and delete one matching row inside a single write transaction.
		 * The delete is guarded by the row id plus the original predicate, so a concurrent
		 * consumer that got there first makes this one resolve to `null`.
		 */
		async function consumeOneRow(
			run: RunCypher,
			model: string,
			where: CleanedWhere[],
		): Promise<Row | null> {
			const row = await findOneRow(run, model, where);
			if (!row) return null;
			const idField = idProperty(schema, schemaKeyOf(model));
			const id = row[idField];
			if (typeof id !== "string" && typeof id !== "number") return null;
			const byId: CleanedWhere = {
				field: idField,
				operator: "eq",
				value: id,
				connector: "AND",
				mode: "sensitive",
			};
			// Appending an AND clause to an OR chain would change its meaning; the id alone
			// still guards against a concurrent consumer deleting the row first.
			const hasOr = where.some((clause) => clause.connector === "OR");
			const guard = hasOr ? [byId] : [...where, byId];

			// Take the node's write lock first (a no-op write), then re-read: a concurrent
			// consumer holding the lock has committed by now, and the fresh read sees it.
			// Without this, both transactions match the node and both "delete" it.
			const { cypher, params } = matchModel(model, [byId]).clause.build();
			await run(`${cypher}\nSET n.\`__consumeLock\` = true\nREMOVE n.\`__consumeLock\``, params);
			if ((await countRows(run, model, guard)) !== 1) return null;

			const deleted = await deleteNodes(run, model, guard);
			return deleted === 1 ? row : null;
		}

		function describeFailure<T>(operation: string, work: Promise<T>): Promise<T> {
			return work.catch((cause: unknown) => {
				throw new Error(`neo4jAdapter: ${operation} failed`, { cause });
			});
		}

		return {
			create: ({ model, data }) =>
				describeFailure(
					"create",
					runner.inWriteTransaction(async (run) => {
						const result = await run(
							`CREATE (n:${escapeIdentifier(model)}) SET n = $props RETURN n`,
							{ props: toNeo4jProperties(data) },
						);
						const row = rowFromRecord(result, model);
						if (!row) throw new Error("neo4jAdapter: CREATE returned no node");
						const child = childNodeOf(model, row);
						if (child) await linkReferenceEdges(schema, run, child, row);
						return row as typeof data;
					}),
				),

			update: <T>({ model, where, update }: { model: string; where: CleanedWhere[]; update: T }) =>
				describeFailure(
					"update",
					runner.inWriteTransaction(async (run): Promise<T | null> => {
						const patch = toNeo4jProperties(update as Row);
						if (Object.keys(patch).length === 0) {
							return (await findOneRow(run, model, where)) as T | null;
						}
						const { cypher, params } = matchModel(model, where).clause.build();
						const result = await run(`${cypher}\nSET n += $patch\nRETURN n LIMIT 1`, {
							...params,
							patch,
						});
						const row = rowFromRecord(result, model);
						if (!row) return null;
						const child = childNodeOf(model, row);
						if (child) await relinkReferenceEdges(schema, run, child, patch);
						return row as T;
					}),
				),

			updateMany: ({ model, where, update }) =>
				describeFailure(
					"updateMany",
					(async () => {
						const patch = toNeo4jProperties(update);
						if (Object.keys(patch).length === 0) {
							return countRows(runner.read, model, where);
						}
						const { cypher, params } = matchModel(model, where).clause.build();
						const result = await runner.write(
							`${cypher}\nSET n += $patch\nRETURN count(n) AS c`,
							{ ...params, patch },
						);
						return toCount(result.records[0]?.get("c"));
					})(),
				),

			delete: async ({ model, where }) => {
				await describeFailure(
					"delete",
					runner.inWriteTransaction((run) => deleteNodes(run, model, where)),
				);
			},

			deleteMany: ({ model, where }) =>
				describeFailure(
					"deleteMany",
					runner.inWriteTransaction((run) => deleteNodes(run, model, where)),
				),

			consumeOne: <T>({ model, where }: { model: string; where: CleanedWhere[] }) =>
				describeFailure(
					"consumeOne",
					runner.inWriteTransaction(
						(run) => consumeOneRow(run, model, where) as Promise<T | null>,
					),
				),

			findOne: <T>({ model, where, select }: { model: string; where: CleanedWhere[]; select?: string[] }) =>
				describeFailure(
					"findOne",
					findOneRow(runner.read, model, where, select) as Promise<T | null>,
				),

			findMany: <T>({
				model,
				where,
				limit,
				sortBy,
				offset,
				select,
			}: {
				model: string;
				where?: CleanedWhere[];
				limit: number;
				sortBy?: SortBy;
				offset?: number;
				select?: string[];
			}) =>
				describeFailure(
					"findMany",
					(async () => {
						assertSortable(model, sortBy);
						const { node, clause } = matchModel(model, where);
						if (sortBy) {
							clause.orderBy([node.property(sortBy.field), sortBy.direction === "desc" ? "DESC" : "ASC"]);
						}
						if (offset !== undefined && offset > 0) clause.skip(offset);
						if (limit >= 0) clause.limit(limit);
						const result = await runClause(runner.read, clause.return(node));
						const schemaKey = schemaKeyOf(model);
						return rowsFromResult(result, model).map((row) =>
							pickSelectedFields(schema, schemaKey, row, select),
						) as T[];
					})(),
				),

			count: ({ model, where }) =>
				describeFailure("count", countRows(runner.read, model, where)),

			createSchema: async ({ tables }) => ({
				code: buildSchemaStatements(tables, ctx.getModelName, ctx.getFieldName).join("\n"),
				path: SCHEMA_FILE,
				append: false,
			}),
		};
	};
}
