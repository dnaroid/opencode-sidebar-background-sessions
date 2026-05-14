/// <reference types="bun" />
import solidTransformPlugin from "@opentui/solid/bun-plugin";

await Bun.build({
	entrypoints: ["src/index.tsx"],
	outdir: "dist",
	target: "bun",
	format: "esm",
	external: [
		"@opencode-ai/plugin",
		"@opencode-ai/sdk",
		"solid-js",
		"@opentui/solid",
		"@opentui/core",
	],
	plugins: [solidTransformPlugin],
});
