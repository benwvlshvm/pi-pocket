/** The questionnaire's waiting: a question asked resolves with the first answer, and answers need a pending id. */
import assert from "node:assert/strict";
import test from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Questions } from "../src/server/questions.ts";

test("a question resolves with the answers of the person who gave them", async () => {
    const questions = new Questions();
    const asked = questions.ask(
        {
            conversationId: 1 as never,
            taskId: 7 as never,
            callId: "call_1",
            questions: [{ question: "Which name?", options: ["Luna", "Atlas"] }],
        },
        BACKGROUND_CONTEXT,
    );

    const [pending] = questions.all();
    assert.ok(pending !== undefined);
    assert.equal(pending.taskId, 7);
    assert.equal(questions.forConversation(1 as never).length, 1);

    assert.equal(questions.answer("nope", { answers: [], by: "x" }), false);
    assert.equal(questions.answer(pending.id, { answers: ["Atlas"], by: "Ben" }), true);

    const answer = await asked;
    assert.deepEqual(answer, { answers: ["Atlas"], by: "Ben" });
    assert.equal(questions.all().length, 0);
});
