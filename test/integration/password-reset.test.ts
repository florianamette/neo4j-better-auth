import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import type { Driver, Session } from "neo4j-driver";
import { neo4jAdapter, type Neo4jBetterAuthConfig } from "../../src/index.js";
import { connect, migrate, resetDatabase, withoutResultSummaries } from "../helpers/neo4j.js";

/**
 * End-to-end password reset (issue #2). The reset callback reads the single-use
 * verification token (with expired-row cleanup through deleteMany) and the submit
 * step consumes it inside a transaction (consumeOne).
 */
let driver: Driver;
const sessions: Session[] = [];

beforeAll(async () => {
	driver = connect();
	await resetDatabase(driver);
	await migrate(driver);
});

afterAll(async () => {
	await Promise.all(sessions.map((s) => s.close()));
	await driver.close();
});

function createAuth(database: Neo4jBetterAuthConfig) {
	const resetTokens: string[] = [];
	const auth = betterAuth({
		baseURL: "http://localhost:3000",
		secret: "test-secret-that-is-long-enough-for-better-auth",
		database: neo4jAdapter(database),
		emailAndPassword: {
			enabled: true,
			sendResetPassword: async ({ token }) => {
				resetTokens.push(token);
			},
		},
	});
	return { auth, lastResetToken: () => resetTokens.at(-1) };
}

const setups: [string, () => Neo4jBetterAuthConfig][] = [
	["with a shared driver", () => ({ driver })],
	[
		"when query results carry no summary",
		() => {
			const session = driver.session();
			sessions.push(session);
			return { session: withoutResultSummaries(session) };
		},
	],
];

describe.each(setups)("password reset %s", (label, database) => {
	const email = `reset-${label.replace(/\W+/g, "-")}@example.com`;

	it("resets the password once and rejects reusing the token", async () => {
		const { auth, lastResetToken } = createAuth(database());
		await auth.api.signUpEmail({
			body: { email, password: "old-password-123", name: "Reset User" },
		});

		await auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset" } });
		const token = lastResetToken();
		expect(token).toBeTruthy();

		const callback = await auth.api.requestPasswordResetCallback({
			params: { token: token! },
			query: { callbackURL: "/reset" },
			asResponse: true,
		});
		expect(callback.headers.get("location")).toContain(`token=${token}`);

		await auth.api.resetPassword({ body: { token: token!, newPassword: "new-password-456" } });
		await expect(
			auth.api.resetPassword({ body: { token: token!, newPassword: "another-789" } }),
		).rejects.toThrow();

		await expect(
			auth.api.signInEmail({ body: { email, password: "old-password-123" } }),
		).rejects.toThrow();
		const signIn = await auth.api.signInEmail({
			body: { email, password: "new-password-456" },
		});
		expect(signIn.user.email).toBe(email);
	});
});
