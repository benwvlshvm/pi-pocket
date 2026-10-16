/**
 * The goal-mode document: one autonomous objective per session, driven by the `goal` drop-in's driver task and
 * shown by the web app as a bar above the message box. The drop-in owns the loop; this owns the stored shape.
 */
import { defineDoc } from "@earendil-works/pi-durable";

export type DshGoalPhase = "active" | "paused" | "blocked" | "complete";

export type DshGoal = {
    objective: string;
    phase: DshGoalPhase;
    max: number;
    round: number;
    /** Consecutive rounds the model re-asserted a blocker; "blocked" is believed after 3. */
    blockedStreak: number;
    blocker?: string;
    revision: number;
    /** The driver task watching this session, so a re-arm finds it instead of doubling it. */
    driverId?: number;
};

export const DshGoalDoc = defineDoc<{ goal?: DshGoal }>({
    kind: "dsh.goal",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "initial",
    initial: () => ({}),
});
