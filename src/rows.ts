import { schemaFields, type SchemaContext } from "./schema-context.js";

type Row = Record<string, unknown>;

/**
 * Neo4j omits unset properties; Better Auth expects every optional, returned field
 * to be present, so fill the gaps with null.
 */
export function withMissingFieldsAsNull(ctx: SchemaContext, schemaKey: string, row: Row): Row {
	for (const [field, attr] of schemaFields(ctx, schemaKey)) {
		if (attr.required || attr.returned === false) continue;
		const prop = ctx.getFieldName({ model: schemaKey, field });
		if (!(prop in row)) row[prop] = null;
	}
	return row;
}

/**
 * `select` lists schema field names while rows are keyed by property names;
 * the output keeps property keys because that is what Better Auth's transformOutput reads.
 */
export function pickSelectedFields(
	ctx: SchemaContext,
	schemaKey: string,
	row: Row,
	select: string[] | undefined,
): Row {
	if (!select?.length) return row;
	const out: Row = {};
	for (const field of select) {
		const prop = ctx.getFieldName({ model: schemaKey, field });
		out[prop] = row[prop];
	}
	return out;
}
