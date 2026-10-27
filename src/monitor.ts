import { DurableObject } from "cloudflare:workers";
import { notify } from "./telegram";

export interface CheckStatus {
	name: string;
	state: "new" | "up" | "down";
	/** The time of the last ping, ISO 8601. */
	last: string | null;
	/** The time when the alarm fires, ISO 8601. */
	deadline: string | null;
}

/** One Durable Object for each check. The alarm is the deadline of the next ping. */
export class Monitor extends DurableObject<Env> {
	async ping(name: string, timeoutSec: number, graceSec: number): Promise<void> {
		const now = Date.now();
		await this.ctx.storage.put({ name, last: now });
		await this.ctx.storage.setAlarm(now + (timeoutSec + graceSec) * 1000);

		if (await this.ctx.storage.get<boolean>("down")) {
			try {
				await notify(this.env, `✅ ${name} recovered`);
				await this.ctx.storage.put("down", false);
			} catch (err) {
				// The ping is recorded. "down" stays true, so the next ping tries again.
				console.error("recovered alert failed", err);
			}
		}
	}

	async alarm(): Promise<void> {
		const name = await this.ctx.storage.get<string>("name");
		if (name === undefined) return;

		// The check was removed from the config. Forget it.
		if (!(name in checks(this.env))) {
			await this.ctx.storage.deleteAll();
			return;
		}

		if (await this.ctx.storage.get<boolean>("down")) return;

		const last = await this.ctx.storage.get<number>("last");
		await notify(this.env, `🔴 ${name} is down. Last ping: ${iso(last)}`);
		// Set "down" only after the alert is sent. If notify() throws, the runtime retries the alarm.
		await this.ctx.storage.put("down", true);
	}

	async status(name: string): Promise<CheckStatus> {
		const [last, down, alarm] = await Promise.all([
			this.ctx.storage.get<number>("last"),
			this.ctx.storage.get<boolean>("down"),
			this.ctx.storage.getAlarm(),
		]);
		return {
			name,
			state: last === undefined ? "new" : down ? "down" : "up",
			last: iso(last),
			deadline: iso(alarm ?? undefined),
		};
	}
}

export interface Check {
	/** The longest time between two pings, in seconds. */
	timeout: number;
	/** Extra time before the alert, in seconds. */
	grace: number;
}

export function checks(env: Env): Record<string, Check> {
	return env.CHECKS as Record<string, Check>;
}

function iso(ms: number | undefined): string | null {
	return ms === undefined ? null : new Date(ms).toISOString();
}
