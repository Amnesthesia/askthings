import { AnthropicProvider } from "./anthropic.ts";
import type { Provider, ProviderName } from "./base.ts";
import { GeminiProvider } from "./gemini.ts";
import { OpenAIProvider } from "./openai.ts";

export const PROVIDER_TABLE: Record<
	ProviderName,
	{ env: string; make: (key: string) => Provider }
> = {
	anthropic: {
		env: "ANTHROPIC_API_KEY",
		make: (k) => new AnthropicProvider(k),
	},
	gemini: { env: "GOOGLE_API_KEY", make: (k) => new GeminiProvider(k) },
	openai: { env: "OPENAI_API_KEY", make: (k) => new OpenAIProvider(k) },
};

const ALIASES: Record<string, ProviderName> = {
	google: "gemini",
	claude: "anthropic",
	chatgpt: "openai",
};
const ALL = Object.keys(PROVIDER_TABLE) as ProviderName[];

function parseList(value: string | undefined): ProviderName[] {
	return (value ?? "")
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean)
		.map((s) => {
			const name = ALIASES[s] ?? (s as ProviderName);
			if (!ALL.includes(name))
				throw new Error(`unknown provider "${s}" (known: ${ALL.join(", ")})`);
			return name;
		});
}

/**
 * Which providers this run may use: PROVIDERS allowlist, then DISABLE_PROVIDERS
 * denylist. Key presence is deliberately NOT the switch — a key can sit in .env
 * while its provider idles. Naming a provider without its key throws, because
 * silently skipping is how a run quietly loses a third of its coverage; an
 * unnamed keyless provider is skipped with a warning.
 */
export function selectedProviderNames(): ProviderName[] {
	const allow = parseList(process.env.PROVIDERS);
	const deny = new Set(parseList(process.env.DISABLE_PROVIDERS));
	const named = allow.length > 0;
	const wanted = (named ? allow : ALL).filter((p) => !deny.has(p));
	const out: ProviderName[] = [];
	for (const p of wanted) {
		if (process.env[PROVIDER_TABLE[p].env]) out.push(p);
		else if (named)
			throw new Error(
				`provider "${p}" requested but ${PROVIDER_TABLE[p].env} is not set`,
			);
		else console.warn(`  ⚠ ${p}: ${PROVIDER_TABLE[p].env} not set — skipped`);
	}
	return out;
}

const instances = new Map<ProviderName, Provider>();

/** A client for the provider, or null when it is disabled or has no key. */
export function providerFor(name: ProviderName): Provider | null {
	if (!selectedProviderNames().includes(name)) return null;
	let p = instances.get(name);
	if (!p) {
		const key = process.env[PROVIDER_TABLE[name].env];
		if (!key) return null;
		p = PROVIDER_TABLE[name].make(key);
		instances.set(name, p);
	}
	return p;
}
