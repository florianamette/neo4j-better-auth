import type { BetterAuthDBSchema } from "better-auth/db";
import { escapeIdentifier } from "./label.js";
import { idProperty, schemaFields, type SchemaContext } from "./schema-context.js";

export type MigrationRunner = (
	cypher: string,
	params?: Record<string, unknown>,
) => Promise<void>;

type GetModelName = SchemaContext["getModelName"];
type GetFieldName = SchemaContext["getFieldName"];

/** Constraint and index names must be plain identifiers. */
function schemaObjectName(...parts: string[]): string {
	return escapeIdentifier(parts.join("_").replace(/[^a-zA-Z0-9_]/g, "_"));
}

function uniqueConstraint(name: string, label: string, prop: string): string {
	return `CREATE CONSTRAINT ${name} IF NOT EXISTS FOR (n:${label}) REQUIRE n.${prop} IS UNIQUE`;
}

function propertyIndex(name: string, label: string, prop: string): string {
	return `CREATE INDEX ${name} IF NOT EXISTS FOR (n:${label}) ON (n.${prop})`;
}

/** Build Cypher constraint / index statements for the current Better Auth schema. */
export function buildSchemaStatements(
	tables: BetterAuthDBSchema,
	getModelName: GetModelName,
	getFieldName: GetFieldName,
): string[] {
	const ctx: SchemaContext = {
		schema: tables,
		getModelName,
		getFieldName,
		getDefaultModelName: (model) => model,
	};
	const statements: string[] = [];

	for (const schemaKey of Object.keys(tables)) {
		const modelName = getModelName(schemaKey);
		const label = escapeIdentifier(modelName);
		const idProp = idProperty(ctx, schemaKey);
		statements.push(
			uniqueConstraint(
				schemaObjectName(modelName, "id_unique"),
				label,
				escapeIdentifier(idProp),
			),
		);

		for (const [field, attr] of schemaFields(ctx, schemaKey)) {
			if (field === "id") continue;
			const propName = getFieldName({ model: schemaKey, field });
			const prop = escapeIdentifier(propName);
			if (attr.unique) {
				statements.push(
					uniqueConstraint(schemaObjectName(modelName, propName, "unique"), label, prop),
				);
			} else if (attr.index) {
				statements.push(
					propertyIndex(schemaObjectName(modelName, propName, "idx"), label, prop),
				);
			}
		}
	}

	return statements;
}

export async function runCypherMigration(
	run: MigrationRunner,
	tables: BetterAuthDBSchema,
	getModelName: GetModelName,
	getFieldName: GetFieldName,
): Promise<void> {
	for (const statement of buildSchemaStatements(tables, getModelName, getFieldName)) {
		await run(statement);
	}
}
