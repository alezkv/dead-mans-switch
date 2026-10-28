import { checks, type CheckStatus, Monitor } from "./monitor";

export { Monitor };

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);

		if (!(await authorized(request, url, env))) {
			return new Response("unauthorized\n", { status: 401 });
		}

		const ping = url.pathname.match(/^\/ping\/([^/]+)\/?$/);
		if (ping && (request.method === "GET" || request.method === "POST")) {
			const name = decodeURIComponent(ping[1]);
			const check = checks(env).get(name);
			if (!check) return new Response("unknown check\n", { status: 404 });
			await env.MONITOR.getByName(name).ping(name, check.timeout);
			return new Response("ok\n");
		}

		if (url.pathname === "/status" && request.method === "GET") {
			return Response.json(await allStatus(env));
		}

		return new Response("not found\n", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

function allStatus(env: Env): Promise<CheckStatus[]> {
	return Promise.all([...checks(env).keys()].map((name) => env.MONITOR.getByName(name).status(name)));
}

/** Accepts `Authorization: Bearer <token>` or `?key=<token>`. */
async function authorized(request: Request, url: URL, env: Env): Promise<boolean> {
	const header = request.headers.get("authorization");
	const token = header?.startsWith("Bearer ") ? header.slice(7) : url.searchParams.get("key");
	if (!token || !env.PING_TOKEN) return false;
	// Hash both values so that timingSafeEqual gets inputs of equal length.
	const enc = new TextEncoder();
	const [a, b] = await Promise.all([
		crypto.subtle.digest("SHA-256", enc.encode(token)),
		crypto.subtle.digest("SHA-256", enc.encode(env.PING_TOKEN)),
	]);
	return crypto.subtle.timingSafeEqual(a, b);
}
