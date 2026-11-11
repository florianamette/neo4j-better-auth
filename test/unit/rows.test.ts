import { describe, expect, it } from "vitest";
import { pickSelectedFields, withMissingFieldsAsNull } from "../../src/rows.js";
import { schemaContext } from "../helpers/schema.js";

const ctx = schemaContext();

describe("withMissingFieldsAsNull", () => {
	it("fills optional fields Neo4j left unset with null", () => {
		const row = withMissingFieldsAsNull(ctx, "user", { id: "1", email: "a@b.c" });
		expect(row).toMatchObject({ id: "1", email: "a@b.c", image: null });
	});

	it("does not invent required fields", () => {
		const row = withMissingFieldsAsNull(ctx, "user", { id: "1" });
		expect(row).not.toHaveProperty("email");
	});

	it("keeps existing values", () => {
		const row = withMissingFieldsAsNull(ctx, "user", { id: "1", image: "pic.png" });
		expect(row.image).toBe("pic.png");
	});
});

describe("pickSelectedFields", () => {
	const row = { id: "1", email: "a@b.c", name: "A" };

	it("returns the whole row without a selection", () => {
		expect(pickSelectedFields(ctx, "user", row, undefined)).toBe(row);
		expect(pickSelectedFields(ctx, "user", row, [])).toBe(row);
	});

	it("keeps only the selected fields", () => {
		expect(pickSelectedFields(ctx, "user", row, ["email"])).toEqual({ email: "a@b.c" });
	});

	it("maps schema field names to custom property names", () => {
		const custom = schemaContext({ user: { fields: { email: "email_address" } } });
		expect(
			pickSelectedFields(custom, "user", { email_address: "a@b.c", name: "A" }, ["email"]),
		).toEqual({ email_address: "a@b.c" });
	});
});
