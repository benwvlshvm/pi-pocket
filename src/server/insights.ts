/**
 * What the /context and /skills panels show: the system prompt Pi actually sent last, per-model usage, and the loaded
 * skills with their paths. The system prompt is captured from each request by the app's core extension; after a
 * restart the panel says so rather than guessing. Skills come from Pi's own skill loader, so the panel always shows
 * what a new request would load.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ConversationId, UsageState } from "@earendil-works/pi-durable";
import { UsageDoc } from "@earendil-works/pi-durable";
import type { PocketApp } from "./app.ts";
import { type SkillCommand } from "./prompts.ts";
import { usageCost } from "./projection.ts";

export type CapturedPrompt = { text: string; messages: number; at: number };

export type Insights = {
	agentDir: string;
	skillPaths: string[];
	skills: SkillCommand[];
	prompt?: CapturedPrompt;
	usage?: UsageState;
	usageTotal: number;
};

/** The system prompts Pi last sent, per conversation, until the server restarts. */
export class PromptCapture {
	readonly #last = new Map<ConversationId, CapturedPrompt>();

	capture(conversationId: ConversationId, captured: CapturedPrompt): void {
		this.#last.set(conversationId, captured);
	}

	prompt(conversationId: ConversationId): CapturedPrompt | undefined {
		return this.#last.get(conversationId);
	}
}

/** Everything the panel shows for one conversation. */
export async function gather(app: PocketApp, id: ConversationId): Promise<Insights> {
	const skills = app.skillCommands(id);
	let usage: UsageState | undefined;

	try {
		usage = (await app.harness.snapshot(UsageDoc, id, BACKGROUND_CONTEXT)) ?? undefined;
	} catch {
		// A conversation that does not exist (any more): the rest still answers.
	}

	const prompt = app.prompts.prompt(id);

	let skillPaths: string[] = [];

	try {
		skillPaths = app.settings.getSkillPaths();
	} catch {
		// Unreadable settings: the default folders still count.
	}

	return {
		agentDir: getAgentDir(),
		skillPaths,
		skills,
		...(prompt === undefined ? {} : { prompt }),
		...(usage === undefined ? {} : { usage }),
		usageTotal: usageCost(usage),
	};
}
