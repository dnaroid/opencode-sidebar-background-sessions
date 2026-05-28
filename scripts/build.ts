/// <reference types="bun" />
import solidTransformPlugin from "@opentui/solid/bun-plugin";

const packageJson = (await Bun.file("package.json").json()) as {
	version: string;
};

await Bun.build({
	entrypoints: ["src/index.tsx"],
	outdir: "dist",
	target: "bun",
	format: "esm",
	define: {
		__PLUGIN_VERSION__: JSON.stringify(packageJson.version),
	},
	external: [
		"@opencode-ai/plugin",
		"@opencode-ai/sdk",
		"solid-js",
		"@opentui/solid",
		"@opentui/core",
	],
	plugins: [solidTransformPlugin],
});
