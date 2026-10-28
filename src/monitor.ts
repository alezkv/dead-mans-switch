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
	async ping(name: string, timeoutSec: number): Promise<void> {
		const now = Date.now();
		await this.ctx.storage.put({ name, last: now });
		await this.ctx.storage.setAlarm(now + timeoutSec * 1000);

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
		if (!checks(this.env).has(name)) {
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
	/** The longest time between two pings, in seconds. Include a margin for a slow job and a late alarm. */
	timeout: number;
}

/** Parses the CHECKS secret. Throws if it is not valid, so that a bad secret does not delete or skip a check. */
export function checks(env: Env): Map<string, Check> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(env.CHECKS);
	} catch {
		// Do not include the parser message. It can quote part of the secret.
		throw new Error("CHECKS is not valid JSON");
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("CHECKS must be a JSON object");
	}
	const map = new Map<string, Check>();
	for (const [name, check] of Object.entries(parsed)) {
		const timeout = (check as Partial<Check> | null)?.timeout;
		if (typeof timeout !== "number" || !(timeout > 0)) {
			throw new Error(`CHECKS["${name}"]: timeout must be a positive number of seconds`);
		}
		map.set(name, { timeout });
	}
	return map;
}

function iso(ms: number | undefined): string | null {
	return ms === undefined ? null : new Date(ms).toISOString();
}
