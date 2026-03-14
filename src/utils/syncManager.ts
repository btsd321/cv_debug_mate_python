/**
 * syncManager.ts — View synchronisation ("pair") state.
 *
 * Users can pair two variables so that viewport changes in one viewer
 * (zoom / pan / rotation) are mirrored in the other.
 *
 * State machine:
 *   idle  ──startPairing(a)──►  waiting(a)
 *   waiting(a)  ──completePairing(b)──►  paired(a↔b)  +  idle
 *   paired  ──unpair(a)──►  idle
 */

import { PanelManager } from "./panelManager";

export class SyncManager {
    /** varName waiting for its partner */
    private pendingVar: string | null = null;

    /** Bidirectional map: varName → partnerVarName */
    private pairs = new Map<string, string>();

    startPairing(varName: string): void {
        this.pendingVar = varName;
    }

    getPendingPair(): string | null {
        return this.pendingVar;
    }

    completePairing(varName: string, _panelManager: PanelManager): void {
        if (!this.pendingVar || this.pendingVar === varName) {
            this.pendingVar = null;
            return;
        }
        const a = this.pendingVar;
        const b = varName;
        this.pairs.set(a, b);
        this.pairs.set(b, a);
        this.pendingVar = null;
    }

    getPartner(varName: string): string | null {
        return this.pairs.get(varName) ?? null;
    }

    unpair(varName: string): void {
        const partner = this.pairs.get(varName);
        if (partner) {
            this.pairs.delete(partner);
        }
        this.pairs.delete(varName);
    }

    isPaired(varName: string): boolean {
        return this.pairs.has(varName);
    }

    clear(): void {
        this.pairs.clear();
        this.pendingVar = null;
    }
}
