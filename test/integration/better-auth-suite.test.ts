import { testAdapter, normalTestSuite } from "@better-auth/test-utils/adapter";
import { neo4jAdapter } from "../../src/index.js";
import { connect, migrate, resetDatabase } from "../helpers/neo4j.js";

/** Better Auth's official adapter conformance suite. */
const driver = connect();
await resetDatabase(driver);

const { execute } = await testAdapter({
	adapter: async () => neo4jAdapter({ driver }),
	runMigrations: (options) => migrate(driver, options),
	tests: [normalTestSuite()],
	onFinish: async () => {
		await driver.close();
	},
});

execute();
