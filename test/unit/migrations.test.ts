import { describe, expect, it, vi } from "vitest";
import { buildSchemaStatements, runCypherMigration } from "../../src/migrations.js";
import { schemaContext } from "../helpers/schema.js";

const ctx = schemaContext();
const statements = () => buildSchemaStatements(ctx.schema, ctx.getModelName, ctx.getFieldName);

describe("buildSchemaStatements", () => {
	it("adds an id uniqueness constraint for every model", () => {
		for (const model of ["user", "session", "account", "verification"]) {
			expect(statements()).toContain(
				`CREATE CONSTRAINT \`${model}_id_unique\` IF NOT EXISTS FOR (n:\`${model}\`) REQUIRE n.\`id\` IS UNIQUE`,
			);
		}
	});

	it("adds uniqueness constraints for unique fields", () => {
		expect(statements()).toContain(
			"CREATE CONSTRAINT `user_email_unique` IF NOT EXISTS FOR (n:`user`) REQUIRE n.`email` IS UNIQUE",
		);
	});

	it("adds indexes for indexed fields", () => {
		expect(statements()).toContain(
			"CREATE INDEX `session_userId_idx` IF NOT EXISTS FOR (n:`session`) ON (n.`userId`)",
		);
		expect(statements()).toContain(
			"CREATE INDEX `verification_identifier_idx` IF NOT EXISTS FOR (n:`verification`) ON (n.`identifier`)",
		);
	});

	it("is idempotent so migrations can be re-run", () => {
		for (const statement of statements()) {
			expect(statement).toContain("IF NOT EXISTS");
		}
	});

	it("uses custom model and field names", () => {
		const custom = schemaContext({
			user: { modelName: "Person", fields: { email: "email_address" } },
		});
		expect(buildSchemaStatements(custom.schema, custom.getModelName, custom.getFieldName)).toContain(
			"CREATE CONSTRAINT `Person_email_address_unique` IF NOT EXISTS FOR (n:`Person`) REQUIRE n.`email_address` IS UNIQUE",
		);
	});
});

describe("runCypherMigration", () => {
	it("runs every statement in order", async () => {
		const run = vi.fn(async () => {});
		await runCypherMigration(run, ctx.schema, ctx.getModelName, ctx.getFieldName);
		expect(run.mock.calls.map(([cypher]) => cypher)).toEqual(statements());
	});
});
