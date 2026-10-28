import { runDurableObjectAlarm, reset, runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checks } from "../src/monitor";

const BASE = "https://dms.test";
const AUTH = { authorization: "Bearer test-token" };
// The timeout of "backup" in vitest.config.ts, in ms.
const BACKUP_WINDOW = 90000 * 1000;

/** The text of each Telegram message that the Worker sent. */
let sent: string[];
let telegramStatus: number;

beforeEach(() => {
	sent = [];
	telegramStatus = 200;
	vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
		const req = new Request(input, init);
		if (!req.url.startsWith("https://api.telegram.org/bottest-bot/sendMessage")) {
			throw new Error(`unexpected fetch: ${req.url}`);
		}
		const body = await req.json<{ chat_id: string; text: string }>();
		expect(body.chat_id).toBe("42");
		if (telegramStatus === 200) sent.push(body.text);
		return new Response("{}", { status: telegramStatus });
	});
});

afterEach(async () => {
	vi.restoreAllMocks();
	// Delete the Durable Object storage. The plugin does not isolate it between tests.
	await reset();
});

function ping(name: string, init: RequestInit = { headers: AUTH }) {
	return exports.default.fetch(`${BASE}/ping/${name}`, init);
}

const stub = () => env.MONITOR.getByName("backup");

describe("auth", () => {
	it("rejects a ping with no token", async () => {
		const res = await ping("backup", {});
		expect(res.status).toBe(401);
	});

	it("rejects a ping with a bad token", async () => {
		const res = await ping("backup", { headers: { authorization: "Bearer wrong" } });
		expect(res.status).toBe(401);
	});

	it("accepts the token in ?key=", async () => {
		const res = await exports.default.fetch(`${BASE}/ping/backup?key=test-token`);
		expect(res.status).toBe(200);
	});
});

describe("ping", () => {
	it("returns 404 for an unknown check", async () => {
		const res = await ping("nope");
		expect(res.status).toBe(404);
	});

	it("sets the alarm to now + timeout", async () => {
		const before = Date.now();
		const res = await ping("backup");
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("ok\n");

		const alarm = await runInDurableObject(stub(), (_, state) => state.storage.getAlarm());
		expect(alarm).toBeGreaterThanOrEqual(before + BACKUP_WINDOW);
		expect(alarm).toBeLessThanOrEqual(Date.now() + BACKUP_WINDOW);
	});

	it("returns 404 for a name from Object.prototype", async () => {
		const res = await ping("constructor");
		expect(res.status).toBe(404);
	});

	it("accepts POST", async () => {
		const res = await ping("backup", { method: "POST", headers: AUTH });
		expect(res.status).toBe(200);
	});
});

describe("alerts", () => {
	it("sends one down alert when the alarm fires", async () => {
		await ping("backup");
		expect(await runDurableObjectAlarm(stub())).toBe(true);
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatch(/^🔴 backup is down/);
		// The alarm ran once and no new alarm is set.
		expect(await runDurableObjectAlarm(stub())).toBe(false);
	});

	it("sends one recovered alert on the next ping after down", async () => {
		await ping("backup");
		await runDurableObjectAlarm(stub());
		sent = [];

		await ping("backup");
		expect(sent).toEqual(["✅ backup recovered"]);

		await ping("backup");
		expect(sent).toHaveLength(1);
	});

	it("throws from alarm() if Telegram fails, and does not mark the check down", async () => {
		await ping("backup");
		telegramStatus = 500;
		await expect(runInDurableObject(stub(), (monitor) => monitor.alarm())).rejects.toThrow(
			/telegram sendMessage: 500/,
		);
		const down = await runInDurableObject(stub(), (_, state) => state.storage.get("down"));
		expect(down).toBeUndefined();
	});
});

describe("status", () => {
	it("lists each check with its state", async () => {
		let res = await exports.default.fetch(`${BASE}/status`, { headers: AUTH });
		expect(await res.json()).toEqual([{ name: "backup", state: "new", last: null, deadline: null }]);

		await ping("backup");
		res = await exports.default.fetch(`${BASE}/status`, { headers: AUTH });
		const [s] = await res.json<Array<{ state: string; last: string; deadline: string }>>();
		expect(s.state).toBe("up");
		expect(Date.parse(s.deadline) - Date.parse(s.last)).toBe(BACKUP_WINDOW);
	});

	it("rejects /status with no token", async () => {
		const res = await exports.default.fetch(`${BASE}/status`);
		expect(res.status).toBe(401);
	});
});

describe("checks()", () => {
	const parse = (CHECKS: string) => checks({ ...env, CHECKS });

	it("reads each check", () => {
		expect(parse('{"a":{"timeout":60}}')).toEqual(new Map([["a", { timeout: 60 }]]));
	});

	it("throws on bad JSON and does not quote it", () => {
		expect(() => parse("{secret")).toThrow(/^CHECKS is not valid JSON$/);
	});

	it("throws if CHECKS is not an object", () => {
		expect(() => parse("[]")).toThrow(/must be a JSON object/);
	});

	it("throws on a missing or bad timeout", () => {
		expect(() => parse('{"a":{}}')).toThrow(/CHECKS\["a"\]: timeout/);
		expect(() => parse('{"a":{"timeout":0}}')).toThrow(/CHECKS\["a"\]: timeout/);
		expect(() => parse('{"a":{"timeout":"60"}}')).toThrow(/CHECKS\["a"\]: timeout/);
	});
});
