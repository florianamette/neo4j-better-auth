import { Neo4jContainer } from "@testcontainers/neo4j";
import type { TestProject } from "vitest/node";

declare module "vitest" {
	export interface ProvidedContext {
		neo4j: { uri: string; username: string; password: string };
	}
}

/** Start one Neo4j container for the whole integration run. */
export default async function setup(project: TestProject) {
	const container = await new Neo4jContainer("neo4j:5.26-community")
		.withStartupTimeout(120000)
		.start();
	project.provide("neo4j", {
		uri: container.getBoltUri(),
		username: container.getUsername(),
		password: container.getPassword(),
	});
	return async () => {
		await container.stop();
	};
}
