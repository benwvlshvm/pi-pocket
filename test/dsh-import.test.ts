// The dsh-import drop-in: a fixture DeepSeek Harness workspace imports as real sessions, once, in its folder.
import {
    cleanUp,
    lastText,
    modelTexts,
    newSession,
    openApp,
    owner,
    root,
    say,
    scriptedModel,
} from "./helpers.ts";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, copyFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import { after, before, test } from "node:test";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { FauxResponseStep } from "@earendil-works/pi-ai";

/** The drop-in, as installed. */
const DROP_IN = "/home/minimalhippo/.pi-pocket/extensions/dsh-import.ts";

let app: Awaited<ReturnType<typeof openApp>>;
let data = "";
let fixtureWorkspace = "";
const T0 = 1791953718037;

const route: FauxResponseStep = (context) => {
    const { role, text } = lastText(context as never);
    const call = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
        fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });

    if (role === "toolResult") {
        return fauxAssistantMessage([fauxText(`tool said: ${text}`)]);
    }

    if (text.includes("import dsh")) {
        return call("dsh_import", { workspace: "fixture" });
    }

    return fauxAssistantMessage([fauxText(`echo: ${text}`)]);
};

/** One JSONL line as a record, DSH style. */
const rec = (type: string, extra: object, data?: object) =>
    JSON.stringify({ type, seq: 0, time: T0, ...(data === undefined ? {} : { data }), ...extra }) +
    "\n";

before(async () => {
    // A fixture workspace with one session: two zstd frames (DSH appends frames), v3- and v4-shaped tool results.
    const sessions = mkdtempSync(join(root, "dsh-sessions-"));

    fixtureWorkspace = join(sessions, "--test-fixture--");
    const sessionDir = join(fixtureWorkspace, "session-abc");

    mkdirSync(sessionDir, { recursive: true });

    const frame1 = [
        rec("session", {
            version: 4,
            id: "session-abc",
            createdAt: T0,
            cwd: sessionDir,
            isSeeded: false,
        }),
        rec(
            "user/message",
            {},
            {
                content: [{ type: "text", text: "Hello fixture" }],
                source: { kind: "user" },
                role: "user",
                id: "u1",
            },
        ),
        rec(
            "assistant/message",
            {},
            {
                turn: 1,
                step: 1,
                message: {
                    role: "assistant",
                    content: [
                        { type: "reasoning", text: "thinking" },
                        { type: "text", text: "Hi!" },
                        {
                            type: "tool-call",
                            id: "c1",
                            name: "bash",
                            arguments: '{"command":"ls"}',
                        },
                    ],
                },
            },
        ),
        rec("tool/call", {}, { turn: 1, step: 1, callId: "c1", name: "bash", arguments: "{}" }),
        rec(
            "tool/result",
            {},
            {
                turn: 1,
                step: 1,
                message: {
                    role: "tool",
                    source: { kind: "tool", callId: "c1" },
                    toolCallId: "c1",
                    content: [{ type: "text", text: "file list" }],
                },
            },
        ),
    ].join("");
    // v3 wraps the tool result inside the message content.
    const frame2 = [
        rec(
            "user/message",
            {},
            {
                content: [{ type: "text", text: "Second" }],
                source: { kind: "user" },
                role: "user",
                id: "u2",
            },
        ),
        rec(
            "assistant/message",
            {},
            {
                turn: 2,
                step: 1,
                message: {
                    role: "assistant",
                    content: [
                        { type: "text", text: "Done" },
                        { type: "tool-call", id: "c2", name: "read", arguments: "{}" },
                    ],
                },
            },
        ),
        rec(
            "tool/result",
            {},
            {
                turn: 2,
                step: 1,
                message: {
                    role: "user",
                    source: { kind: "tool", callId: "c2" },
                    content: [
                        {
                            type: "tool-result",
                            toolCallId: "c2",
                            content: [{ type: "text", text: "contents" }],
                            isError: false,
                        },
                    ],
                },
            },
        ),
        rec("session/title", {}, { title: "Fixture session" }),
    ].join("");

    writeFileSync(
        join(sessionDir, "session.v4.jsonl.zstd"),
        Buffer.concat([
            zstdCompressSync(Buffer.from(frame1)),
            zstdCompressSync(Buffer.from(frame2)),
        ]),
    );
    process.env.DSH_SESSIONS_DIR = sessions;

    // The drop-in, copied in as the owner would, and turned on.
    data = join(root, "dsh-data");
    mkdirSync(join(data, "extensions"), { recursive: true });
    copyFileSync(DROP_IN, join(data, "extensions", "dsh-import.ts"));
    app = await openApp(scriptedModel(route), data);
    await app.setExtensionEnabled(owner(app), "dsh-import.ts", true);
});

after(async () => {
    await app?.close();
    cleanUp();
    process.env.DSH_SESSIONS_DIR = undefined;
    rmSync(fixtureWorkspace.slice(0, fixtureWorkspace.lastIndexOf("--test-fixture--")), {
        recursive: true,
        force: true,
    });
});

test("a DSH workspace imports as real sessions with its folder, title, and messages", async () => {
    const id = await newSession(app);

    await say(app, id, "import dsh fixture please");
    const answer = (await modelTexts(app, id)).at(-1) ?? "";

    assert.match(answer, /1 imported/);
    assert.match(answer, /Fixture session/);

    // It is a session in the list, in the fixture folder, stamped with its original dates.
    const sessions = (
        app as unknown as {
            sessions(): { id: number; title?: string; cwd: string; createdAt: number }[];
        }
    ).sessions();
    const made = sessions.find((meta) => meta.title === "Fixture session");

    assert.ok(made, "the imported session is in the list");
    assert.equal(made.cwd, join(fixtureWorkspace, "session-abc"));
    assert.equal(made.createdAt, T0);

    // Its transcript: two user messages, two assistant answers, two tool results — original content kept.
    const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");

    const view = await (await app.harness.conversation(
        BigInt(made.id) as never,
        BACKGROUND_CONTEXT,
    ))!.context(BACKGROUND_CONTEXT);
    const entries = view.entries;
    const users = entries.filter((e) => e.kind === "pi.user");
    const assistants = entries.filter((e) => e.kind === "pi.assistant");
    const tools = entries.filter((e) => e.kind === "pi.tool-result");

    assert.equal(users.length, 2);
    assert.equal(
        (users[0]?.model as unknown as { content: { text: string }[] }[] | undefined)?.[0]
            ?.content[0]?.text,
        "Hello fixture",
    );
    assert.equal(assistants.length, 2);
    assert.equal(tools.length, 2);
    assert.equal(
        (tools[0]?.model as unknown as { toolCallId: string; toolName: string }[] | undefined)?.[0]
            ?.toolCallId,
        "c1",
    );
    assert.equal(
        (tools[0]?.model as unknown as { toolName: string }[] | undefined)?.[0]?.toolName,
        "bash",
    );
    // Original timestamps survive the import.
    assert.equal(
        (users[0]?.model as unknown as { timestamp: number }[] | undefined)?.[0]?.timestamp,
        T0,
    );
});

test("importing the same workspace again finds every session already here", async () => {
    const id = await newSession(app);

    await say(app, id, "import dsh fixture please again");
    assert.match((await modelTexts(app, id)).at(-1) ?? "", /0 imported.*already here/s);
});

/** Every entry of a conversation, oldest first. */
