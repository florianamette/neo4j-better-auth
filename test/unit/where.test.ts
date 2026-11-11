import { describe, expect, it } from "vitest";
import Cypher from "@neo4j/cypher-builder";
import type { CleanedWhere } from "better-auth/adapters";
import { buildWherePredicate } from "../../src/where.js";

const allowed = new Set(["id", "email", "age"]);

function build(where: CleanedWhere[]) {
	const node = new Cypher.NamedNode("n");
	const predicate = buildWherePredicate(node, where, allowed);
	if (!predicate) throw new Error("expected a predicate");
	return new Cypher.Match(new Cypher.Pattern(node, { labels: ["User"] }))
		.where(predicate)
		.return(node)
		.build();
}

const clause = (partial: Partial<CleanedWhere> & { field: string }): CleanedWhere => ({
	operator: "eq",
	value: null,
	connector: "AND",
	mode: "sensitive",
	...partial,
});

describe("buildWherePredicate", () => {
	it("returns no predicate for an empty where", () => {
		const node = new Cypher.NamedNode("n");
		expect(buildWherePredicate(node, undefined, allowed)).toBeUndefined();
		expect(buildWherePredicate(node, [], allowed)).toBeUndefined();
	});

	it("rejects a field outside the allowlist", () => {
		const node = new Cypher.NamedNode("n");
		expect(() =>
			buildWherePredicate(node, [clause({ field: "unknown", value: "x" })], allowed),
		).toThrow('neo4jAdapter: invalid where field "unknown"');
	});

	it("rejects an unknown operator instead of falling back to equality", () => {
		const node = new Cypher.NamedNode("n");
		const bogus = clause({ field: "email", value: "x" });
		(bogus as { operator: string }).operator = "regex";
		expect(() => buildWherePredicate(node, [bogus], allowed)).toThrow(
			'neo4jAdapter: unsupported where operator "regex"',
		);
	});

	it("parameterizes values rather than inlining them", () => {
		const { cypher, params } = build([clause({ field: "email", value: "a@b.c" })]);
		expect(cypher).toContain("n.email = $param0");
		expect(cypher).not.toContain("a@b.c");
		expect(params).toEqual({ param0: "a@b.c" });
	});

	it("maps null equality to IS NULL / IS NOT NULL", () => {
		expect(build([clause({ field: "email", value: null })]).cypher).toContain("n.email IS NULL");
		expect(build([clause({ field: "email", operator: "ne", value: null })]).cypher).toContain(
			"n.email IS NOT NULL",
		);
	});

	it("combines clauses with AND by default and OR when requested", () => {
		const { cypher } = build([
			clause({ field: "email", value: "a" }),
			clause({ field: "age", operator: "gt", value: 18 }),
			clause({ field: "id", value: "x", connector: "OR" }),
		]);
		expect(cypher).toMatch(/\(n\.email = \$param0 AND n\.age > \$param1\) OR n\.id = \$param2/);
	});

	it("lower-cases both sides for insensitive string comparisons only", () => {
		const insensitive = build([
			clause({ field: "email", operator: "contains", value: "A@B", mode: "insensitive" }),
		]);
		expect(insensitive.cypher).toContain("toLower(n.email) CONTAINS $param0");
		expect(insensitive.params).toEqual({ param0: "a@b" });

		const numeric = build([clause({ field: "age", value: 3, mode: "insensitive" })]);
		expect(numeric.cypher).toContain("n.age = $param0");
	});

	it("wraps a scalar in a list for IN operators", () => {
		const { params } = build([clause({ field: "id", operator: "in", value: "only" })]);
		expect(params).toEqual({ param0: ["only"] });
	});
});
