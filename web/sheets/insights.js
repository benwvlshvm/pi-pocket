// The /context and /skills sheet: what Pi's context is made of and what it cost. `/context` opens on the stats,
// prompt, and usage; `/skills` on the loaded skills and their paths. Styled like the TUI's own panel: colored
// section bars, token numbers in mono, everything in the theme's hues.
import { useEffect, useState } from "preact/hooks";
import { api, attempt, closeSheet, store } from "../store.js";
import { formatTokens, html, Loader, modelLabel, Sheet } from "../ui.js";

const shortPath = (path) => path.replace(/^\/home\/[^/]+/, "~");

/** One colored section, the TUI panel's "\u258c TITLE" drawn as a left bar. */
function Section({ tint, title, children }) {
    return html`<section class=${"insight-section tint-" + tint}>
        <h3 class="section-bar">${title}</h3>
        ${children}
    </section>`;
}

/** A semicircle gauge: the speed of the newest response. */
function Speedometer({ latest }) {
    const top = Math.max(150, Math.ceil((latest ?? 0) / 50) * 50);
    const r = 52;
    const len = Math.PI * r;
    const arc = (fraction, width, color, cap = "round") =>
        html`<path
            d="M 8 62 A 52 52 0 0 1 112 62"
            fill="none"
            stroke=${color}
            stroke-width=${width}
            stroke-linecap=${cap}
            stroke-dasharray=${`${(fraction ?? 0) * len} ${len}`}
        />`;

    return html`<svg class="gauge" viewBox="0 0 120 74" role="img" aria-label=${`Speed ${latest ?? 0} tokens per second`}>
        ${arc(1, 10, "var(--line)", "butt")}
        ${arc((latest ?? 0) / top, 10, "var(--spark)")}
        <text x="60" y="48" text-anchor="middle" class="gauge-value">${latest !== undefined ? latest.toFixed(1) : "—"}</text>
        <text x="60" y="62" text-anchor="middle" class="gauge-unit">tok/s</text>
        <text x="8" y="73" class="gauge-scale">0</text>
        <text x="112" y="73" text-anchor="end" class="gauge-scale">${top}</text>
    </svg>`;
}

/** The context as a stacked composition bar: the newest request's split against the window. */
function ContextBar({ stats }) {
    const agent = store.state.view.agent;
    const window = agent?.contextWindow;
    // The window's fill from the newest response's own total; the cached share from its cache rate.
    const prompted = stats.contextTokens ?? 0;
    const cached = stats.cacheRate !== undefined ? prompted * stats.cacheRate : 0;
    const fresh = prompted - cached;
    const pct = (n) => (window ? Math.min(100, (n / window) * 100) : 0);
    const seg = (n, color, title) =>
        html`<div class="ctx-seg" style=${`width:${pct(n)}%; background:${color}`} title=${title}></div>`;

    return html`<div class="ctx-block">
        <div class="ctx-headline">
            ${window
                ? html`<strong>${Math.round((prompted / window) * 100)}%</strong> of ${formatTokens(window)}`
                : "No context window known"}
        </div>
        <div class="ctx-bar">
            ${seg(cached, "var(--ok)", "Cached")}
            ${seg(fresh, "var(--accent)", "Fresh input")}
            ${seg(window ? Math.max(0, window - prompted) : 0, "var(--card-2)", "Free")}
        </div>
        <div class="ctx-legend mono">
            <span><i class="dot" style=${"background:var(--ok)"}></i>${formatTokens(cached)} cached</span>
            <span><i class="dot" style=${"background:var(--accent)"}></i>${formatTokens(fresh)} fresh</span>
            <span><i class="dot" style=${"background:var(--card-2)"}></i>free</span>
        </div>
    </div>`;
}

function ContextOverview({ insights }) {
    const stats = store.state.view.stats ?? {};
    const hasSpeed = stats.tokensPerSec !== undefined;

    return html`<div class="context-row">
        <div class="gauge-block">
            <${Speedometer} latest=${stats.tokensPerSec} />
            <div class="gauge-caption">
                ${hasSpeed
                    ? html`newest answer <b>${stats.tokensPerSec.toFixed(1)}</b> tok/s`
                    : "waiting for a response"}
            </div>
        </div>
        <${ContextBar} stats=${stats} />
    </div>
    <div class="mini-stats mono">
        <span title="Time to first token">⏱ ${stats.ttftMs !== undefined ? `${(stats.ttftMs / 1000).toFixed(1)}s to first token` : "no first token yet"}</span>
        <span title="Cache hit rate">✦ ${Math.round((stats.cacheRate ?? 0) * 100)}% cache hit</span>
        <span title="Session spend">¤ $${(store.state.view.conversation?.spend?.spent ?? stats.cost ?? 0).toFixed(2)}</span>
    </div>`;
}

function ModelSection() {
    const { view } = store.state;
    const agent = view.agent;
    const level = agent?.reasoning && agent.thinkingLevel !== "off" ? agent.thinkingLevel : undefined;

    return html`<${Section} tint="accent" title="Model">
        <div class="kv">
            <span class="kv-key">model</span>
            <span class="kv-value">
                <strong>${modelLabel(agent)}</strong>
                ${agent?.model && html`<span class="pill">${agent.model.provider}</span>`}
                ${level && html`<span class="pill">${level}</span>`}
            </span>
        </div>
        <div class="kv">
            <span class="kv-key">window</span>
            <span class="kv-value mono">${agent?.contextWindow ? formatTokens(agent.contextWindow) + " tokens" : "—"}</span>
        </div>
        <div class="kv">
            <span class="kv-key">folder</span>
            <span class="kv-value mono">${agent?.cwd ?? "—"}</span>
        </div>
    <//>`;
}

function promptTotals(insights) {
    const models = Object.values(insights.usage?.models ?? {});

    return models.reduce(
        (totals, used) => ({
            input: totals.input + (used?.input ?? 0),
            output: totals.output + (used?.output ?? 0),
            cacheRead: totals.cacheRead + (used?.cacheRead ?? 0),
            cacheWrite: totals.cacheWrite + (used?.cacheWrite ?? 0),
        }),
        { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    );
}

function UsageSection({ insights }) {
    const entries = Object.entries(insights.usage?.models ?? {});
    const totals = promptTotals(insights);
    const prompted = totals.input + totals.cacheRead + totals.cacheWrite;
    const hit = prompted > 0 ? Math.round((totals.cacheRead / prompted) * 100) : null;

    return html`<${Section} tint="spark" title="Usage">
        ${
            entries.length === 0
                ? html`<p class="muted small">No model usage recorded in this session yet.</p>`
                : html`<div class="usage-rows">
                        ${entries.map(([name, used]) => {
                            const u = used ?? {};
                            const cost = u.cost?.total;

                            return html`<div class="usage-row" key=${name}>
                                <div class="usage-model mono"><span class="usage-dot"></span>${name}</div>
                                <div class="usage-figures mono">
                                    <span title="Input tokens"><b class="fig-up">↑</b>${formatTokens(u.input ?? 0)}</span>
                                    <span title="Output tokens"><b class="fig-down">↓</b>${formatTokens(u.output ?? 0)}</span>
                                    <span title="Cache read"><b class="fig-cache">⟳</b>${formatTokens(u.cacheRead ?? 0)}</span>
                                    <span title="Cache write"><b class="fig-write">✎</b>${formatTokens(u.cacheWrite ?? 0)}</span>
                                    <span class="usage-cost" title="Cost">$${(cost ?? 0).toFixed(2)}</span>
                                </div>
                            </div>`;
                        })}
                    </div>
                    <div class="usage-totals">
                        <span>${formatTokens(totals.input + totals.output + prompted)} tokens total</span>
                        ${hit !== null && html`<span class="usage-hit">✦ ${hit}% cache hit</span>`}
                        <span>$${insights.usageTotal.toFixed(2)} · tools included</span>
                    </div>`
        }
    <//>`;
}

function PromptSection({ prompt }) {
    const [open, setOpen] = useState(false);
    const chars = prompt?.text.length ?? 0;

    return html`<${Section} tint="warn" title="System prompt">
        ${
            prompt === undefined
                ? html`<p class="muted small">
                      Not captured yet. Pi sends the prompt with each request, so it appears here after the next
                      answer — extensions and all, exactly as carried.
                  </p>`
                : html`<div class="kv">
                            <span class="kv-key">captured</span>
                            <span class="kv-value">
                                ${chars.toLocaleString()} chars · ${prompt.messages} messages ·
                                ${new Date(prompt.at).toLocaleTimeString()}
                            </span>
                        </div>
                        <button class="link small" onClick=${() => setOpen(!open)}>
                            ${open ? "Hide prompt" : "Show prompt"}
                        </button>
                        ${open && html`<pre class="output prompt-view">${prompt.text}</pre>`}`
        }
    <//>`;
}

function SkillsSection({ insights }) {
    const title = "Skills · " + insights.skills.length;

    return html`<${Section} tint="ok" title=${title}>
        <div class="kv">
            <span class="kv-key">agent dir</span>
            <span class="kv-value mono">${shortPath(insights.agentDir)}</span>
        </div>
        <div class="kv">
            <span class="kv-key">extra paths</span>
            <span class="kv-value mono">
                ${insights.skillPaths.length > 0 ? insights.skillPaths.map(shortPath).join(" · ") : "none"}
            </span>
        </div>
        ${
            insights.skills.length === 0
                ? html`<p class="muted small">No skills found for this session's folder.</p>`
                : html`<div class="skill-list">
                        ${insights.skills.map(
                            (skill) => html`<div class="skill-row" key=${skill.name}>
                                <div class="skill-head">
                                    <span class="skill-name"><span class="skill-glyph">◆</span>${skill.name}</span>
                                    <span class="skill-path mono" title=${skill.path}>${shortPath(skill.path)}</span>
                                </div>
                                ${skill.description && html`<div class="skill-desc">${skill.description}</div>`}
                            </div>`,
                        )}
                    </div>`
        }
    <//>`;
}

export function InsightsSheet({ focus = "context" }) {
    const [data, setData] = useState(null);

    useEffect(() => {
        attempt(async () => setData(await api(`c/${store.state.conversationId}/insights`)));
    }, []);

    const skillsFirst = focus === "skills";

    return html`<${Sheet} title="Context & skills" wide=${true} onClose=${closeSheet}>
        ${data === null && html`<${Loader} label="Gathering" />`}
        ${
            data && html`<div class="insights">
                <${ContextOverview} insights=${data} />
                ${skillsFirst
                    ? html`<${SkillsSection} insights=${data} />
                          <${ModelSection} />
                          <${UsageSection} insights=${data} />
                          <${PromptSection} prompt=${data.prompt} />`
                    : html`<${ModelSection} />
                          <${UsageSection} insights=${data} />
                          <${PromptSection} prompt=${data.prompt} />
                          <${SkillsSection} insights=${data} />`}
            </div>`
        }
    <//>`;
}
