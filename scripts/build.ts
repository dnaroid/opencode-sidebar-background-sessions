/// <reference types="bun" />
import solidTransformPlugin from "@opentui/solid/bun-plugin";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { join } from "node:path";

const packageJson = (await Bun.file("package.json").json()) as {
	version: string;
};

// Keep the previous entrypoint available while a running TUI watches the checkout.
await mkdir("dist", { recursive: true });
const temporary = await mkdtemp(join("dist", ".build-"));
try {
	const result = await Bun.build({
		entrypoints: ["src/index.tsx"],
		outdir: temporary,
		target: "bun",
		format: "esm",
		define: {
			__PLUGIN_VERSION__: JSON.stringify(packageJson.version),
		},
		external: [
			"@opencode-ai/plugin",
			"@opencode-ai/sdk",
			"@opencode/client",
			"@opencode/plugin/tui",
			"solid-js",
			"@opentui/solid",
			"@opentui/core",
		],
		plugins: [solidTransformPlugin],
	});
	if (!result.success) throw new AggregateError(result.logs, "Plugin build failed");
	await rename(join(temporary, "index.js"), join("dist", "index.js"));
} finally {
	await rm(temporary, { recursive: true, force: true });
}
