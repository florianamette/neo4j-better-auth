import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: "unit",
					include: ["test/unit/**/*.test.ts"],
				},
			},
			{
				test: {
					name: "integration",
					include: ["test/integration/**/*.test.ts"],
					// One Neo4j container is shared by every integration file; files run one
					// at a time so each can reset the database without racing the others.
					globalSetup: ["test/helpers/neo4j-global-setup.ts"],
					fileParallelism: false,
					testTimeout: 120000,
					hookTimeout: 180000,
				},
			},
		],
	},
});
