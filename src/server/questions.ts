/**
 * Questions Pi asks the people in a session: the questionnaire tool registers one here, everyone in the session sees
 * it as a card on the call, and the first answer resolves the tool. In memory on purpose: the call is not replay-safe,
 * so after a restart the tool comes back interrupted rather than asking again.
 */
import { awaitWithContext } from "@earendil-works/chord/context";
import type { ConversationId, TaskId } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";

/** One question Pi asked: its wording, and optional options the answerer picks from instead of typing. */
export type AskedQuestion = { question: string; options?: string[] };

export type PendingQuestion = {
	id: string;
	conversationId: ConversationId;
	taskId: TaskId;
	callId: string;
	questions: AskedQuestion[];
	createdAt: number;
};

export type QuestionAnswer = { by: string; answers: string[] };

export class Questions {
	readonly #pending = new Map<
		string,
		{ question: PendingQuestion; resolve: (answer: QuestionAnswer) => void }
	>();
	readonly #listeners = new Set<(conversationId: ConversationId) => void>();

	/** Register a pending question and wait for an answer; rejects when the asking call's invocation ends. */
	ask(
		input: {
			conversationId: ConversationId;
			taskId: TaskId;
			callId: string;
			questions: AskedQuestion[];
		},
		context: Context,
	): Promise<QuestionAnswer> {
		const id = `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
		const question: PendingQuestion = { id, ...input, createdAt: Date.now() };
		const answered = new Promise<QuestionAnswer>((resolve) => {
			this.#pending.set(id, { question, resolve });
		});
		this.#emit(question.conversationId);
		return awaitWithContext(answered, context).finally(() => {
			if (this.#pending.get(id)?.question === question) {
				this.#pending.delete(id);
				this.#emit(question.conversationId);
			}
		});
	}

	answer(id: string, answer: QuestionAnswer): boolean {
		const pending = this.#pending.get(id);

		if (pending === undefined) {
			return false;
		}

		this.#pending.delete(id);
		pending.resolve(answer);
		this.#emit(pending.question.conversationId);
		return true;
	}

	forConversation(conversationId: ConversationId): PendingQuestion[] {
		return [...this.#pending.values()]
			.map((pending) => pending.question)
			.filter((question) => question.conversationId === conversationId);
	}

	all(): PendingQuestion[] {
		return [...this.#pending.values()].map((pending) => pending.question);
	}

	subscribe(listener: (conversationId: ConversationId) => void): () => void {
		this.#listeners.add(listener);

		return () => this.#listeners.delete(listener);
	}

	#emit(conversationId: ConversationId): void {
		for (const listener of this.#listeners) {
			listener(conversationId);
		}
	}
}
