import type { BetterAuthOptions } from "better-auth/types";
import { getAuthTables } from "better-auth/db";
import { initGetFieldName, initGetModelName } from "better-auth/adapters";
import type { SchemaContext } from "../../src/schema-context.js";

/** A real Better Auth schema context, as the adapter receives it, without a database. */
export function schemaContext(options: BetterAuthOptions = {}): SchemaContext {
	const schema = getAuthTables(options);
	const getModelName = initGetModelName({ schema, usePlural: false });
	const getFieldName = initGetFieldName({ schema, usePlural: false });
	return {
		schema,
		getModelName: (model) => getModelName(model),
		getDefaultModelName: (model) => model,
		getFieldName: (args) => getFieldName(args),
	};
}
