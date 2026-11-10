import type { CleanedWhere } from "better-auth/adapters";
import Cypher, { in as cypherIn } from "@neo4j/cypher-builder";
import type { Expr, Predicate } from "@neo4j/cypher-builder";

type Operator = CleanedWhere["operator"];

/**
 * Build a Cypher WHERE predicate from Better Auth's cleaned where clauses.
 * Field names are checked against the model's known properties so a caller cannot
 * filter on arbitrary property names; values always become query parameters.
 */
export function buildWherePredicate(
	node: Cypher.NamedNode,
	where: CleanedWhere[] | undefined,
	allowedFields: ReadonlySet<string>,
): Predicate | undefined {
	if (!where?.length) return undefined;
	for (const clause of where) {
		assertAllowedField(clause.field, allowedFields);
	}

	const [first, ...rest] = where;
	let predicate = clausePredicate(node, first!);
	for (const clause of rest) {
		const next = clausePredicate(node, clause);
		predicate =
			clause.connector === "OR"
				? Cypher.or(predicate, next)
				: Cypher.and(predicate, next);
	}
	return predicate;
}

function assertAllowedField(field: string, allowedFields: ReadonlySet<string>): void {
	if (!allowedFields.has(field)) {
		throw new Error(`neo4jAdapter: invalid where field "${field}"`);
	}
}

function clausePredicate(node: Cypher.NamedNode, clause: CleanedWhere): Predicate {
	const operator: Operator = clause.operator ?? "eq";
	const prop = node.property(clause.field);
	// `mode: "insensitive"` only applies to string equality and pattern matching.
	const insensitiveValue =
		clause.mode === "insensitive" && isStringValue(clause.value)
			? lowerCase(clause.value)
			: undefined;
	const insensitive = insensitiveValue !== undefined;
	const lhs: Expr = insensitive ? Cypher.toLower(prop) : prop;
	const value = insensitive ? insensitiveValue : clause.value;

	switch (operator) {
		case "eq":
			return value === null ? Cypher.isNull(prop) : Cypher.eq(lhs, param(value));
		case "ne":
			return value === null ? Cypher.isNotNull(prop) : Cypher.neq(lhs, param(value));
		case "lt":
			return Cypher.lt(prop, param(value));
		case "lte":
			return Cypher.lte(prop, param(value));
		case "gt":
			return Cypher.gt(prop, param(value));
		case "gte":
			return Cypher.gte(prop, param(value));
		case "in":
			return cypherIn(lhs, param(asList(value)));
		case "not_in":
			return Cypher.not(cypherIn(lhs, param(asList(value))));
		case "contains":
			return Cypher.contains(lhs, param(String(value)));
		case "starts_with":
			return Cypher.startsWith(lhs, param(String(value)));
		case "ends_with":
			return Cypher.endsWith(lhs, param(String(value)));
		default:
			throw new Error(`neo4jAdapter: unsupported where operator "${String(operator)}"`);
	}
}

function param(value: unknown): Cypher.Param {
	return new Cypher.Param(value);
}

function asList(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [value];
}

function isStringValue(value: unknown): value is string | string[] {
	return Array.isArray(value)
		? value.every((v) => typeof v === "string")
		: typeof value === "string";
}

function lowerCase(value: string | string[]): string | string[] {
	return Array.isArray(value) ? value.map((v) => v.toLowerCase()) : value.toLowerCase();
}
