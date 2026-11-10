import type { BetterAuthDBSchema, DBFieldAttribute } from "better-auth/db";

/** The subset of Better Auth's adapter context needed to map models and fields to Neo4j names. */
export interface SchemaContext {
	schema: BetterAuthDBSchema;
	/** Maps a schema key or custom model name to the Neo4j label. */
	getModelName: (model: string) => string;
	/** Maps a custom model name back to its schema key. */
	getDefaultModelName: (model: string) => string;
	/** Maps a schema field to the property name stored on the node. */
	getFieldName: (args: { model: string; field: string }) => string;
}

export interface ForeignKey {
	/** Property on the child node that stores the parent id. */
	fkProp: string;
	/** Schema key of the referenced model. */
	parentKey: string;
	/** Neo4j label of the referenced model. */
	parentLabel: string;
	/** Property on the parent node that the foreign key points at. */
	parentIdProp: string;
	cascadeOnDelete: boolean;
}

export function schemaFields(
	ctx: SchemaContext,
	schemaKey: string,
): [string, DBFieldAttribute][] {
	const table = ctx.schema[schemaKey];
	return table?.fields ? Object.entries(table.fields) : [];
}

export function idProperty(ctx: SchemaContext, schemaKey: string): string {
	return ctx.getFieldName({ model: schemaKey, field: "id" });
}

/** Property names a model may be filtered or sorted by (the implicit id field included). */
export function allowedProperties(
	ctx: SchemaContext,
	schemaKey: string,
): Set<string> {
	const names = schemaFields(ctx, schemaKey).map(([field]) =>
		ctx.getFieldName({ model: schemaKey, field }),
	);
	return new Set([idProperty(ctx, schemaKey), ...names]);
}

export function foreignKeys(ctx: SchemaContext, schemaKey: string): ForeignKey[] {
	const keys: ForeignKey[] = [];
	for (const [field, attr] of schemaFields(ctx, schemaKey)) {
		if (!attr.references) continue;
		const parentKey = ctx.getDefaultModelName(attr.references.model);
		keys.push({
			fkProp: ctx.getFieldName({ model: schemaKey, field }),
			parentKey,
			parentLabel: ctx.getModelName(parentKey),
			parentIdProp: ctx.getFieldName({
				model: parentKey,
				field: attr.references.field,
			}),
			cascadeOnDelete: attr.references.onDelete === "cascade",
		});
	}
	return keys;
}
