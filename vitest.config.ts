import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
	},
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.toml" },
			miniflare: {
				bindings: {
					CHECKS: JSON.stringify({ backup: { timeout: 90000 } }),
					PING_TOKEN: "test-token",
					TELEGRAM_BOT_TOKEN: "test-bot",
					TELEGRAM_CHAT_ID: "42",
				},
			},
		}),
	],
});
