/**
 * MvVariablesProvider
 *
 * VS Code TreeDataProvider for the "MatrixViewer Debug" panel in the Debug sidebar.
 * Maintains a list of pinned + auto-detected visualizable variables,
 * grouped by type (Image / Plot / PointCloud) and optional user-defined groups.
 */

import * as vscode from "vscode";

import { getAdapter } from "./adapters/adapterRegistry";
import { PanelManager } from "./utils/panelManager";
import { log_debug } from "./log/logger";

// ── Tree Node Types ────────────────────────────────────────────────────────

export type MvVariableKind = "image" | "plot" | "pointcloud" | "unknown";

export class MvVariableItem extends vscode.TreeItem {
    constructor(
        public readonly variableName: string,
        public readonly kind: MvVariableKind,
        public readonly typeLabel: string = "",
        public readonly shapeLabel: string = ""
    ) {
        super(variableName, vscode.TreeItemCollapsibleState.None);
        this.contextValue = "mvVariable";
        this.description = shapeLabel ? `${typeLabel}  ${shapeLabel}` : typeLabel;
        this.tooltip = `${variableName}: ${typeLabel} ${shapeLabel}`.trim();
        this.iconPath = MvVariableItem.iconFor(kind);
        this.command = {
            command: "matrixViewer.viewVariable",
            title: "Visualize",
            arguments: [this],
        };
    }

    private static iconFor(kind: MvVariableKind): vscode.ThemeIcon {
        switch (kind) {
            case "image":
                return new vscode.ThemeIcon("file-media");
            case "plot":
                return new vscode.ThemeIcon("graph");
            case "pointcloud":
                return new vscode.ThemeIcon("globe");
            default:
                return new vscode.ThemeIcon("variable");
        }
    }
}

export class MvGroupItem extends vscode.TreeItem {
    public readonly children: MvVariableItem[] = [];

    constructor(public readonly groupName: string) {
        super(groupName, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = "mvGroup";
        this.iconPath = new vscode.ThemeIcon("folder");
    }
}

type TreeNode = MvGroupItem | MvVariableItem;

// ── Provider ───────────────────────────────────────────────────────────────

export class MvVariablesProvider
    implements vscode.TreeDataProvider<TreeNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<
        TreeNode | undefined | void
    >();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    /** All pinned variables (added manually or via auto-detect) */
    private pinnedVars = new Map<string, MvVariableItem>();

    /** User-defined groups: groupName → variableNames[] */
    private groups = new Map<string, string[]>();

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly panelManager: PanelManager
    ) { }

    // ── TreeDataProvider interface ───────────────────────────────────────────

    getTreeItem(element: TreeNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TreeNode): TreeNode[] {
        if (!element) {
            return this.buildRoots();
        }
        if (element instanceof MvGroupItem) {
            return element.children;
        }
        return [];
    }

    private buildRoots(): TreeNode[] {
        const nodes: TreeNode[] = [];
        const groupedVarNames = new Set<string>(
            [...this.groups.values()].flat()
        );

        // User-defined groups
        for (const [groupName, varNames] of this.groups) {
            const group = new MvGroupItem(groupName);
            for (const name of varNames) {
                const item = this.pinnedVars.get(name);
                if (item) {
                    group.children.push(item);
                }
            }
            if (group.children.length > 0) {
                nodes.push(group);
            }
        }

        // Ungrouped variables
        for (const [name, item] of this.pinnedVars) {
            if (!groupedVarNames.has(name)) {
                nodes.push(item);
            }
        }

        return nodes;
    }

    // ── Public API ───────────────────────────────────────────────────────────

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /** Add a variable by name and type string (fast path, no evaluate) */
    addVariable(name: string, typeStr: string): void {
        if (this.pinnedVars.has(name)) {
            return;
        }
        const adapter = this.getActiveAdapter();
        const kind = adapter?.basicTypeDetect(typeStr) ?? "unknown";
        const item = new MvVariableItem(name, kind, typeStr);
        this.pinnedVars.set(name, item);
        this._onDidChangeTreeData.fire();
    }

    /** Add a fully-resolved variable item */
    addVariableItem(item: MvVariableItem): void {
        if (!this.pinnedVars.has(item.variableName)) {
            this.pinnedVars.set(item.variableName, item);
            this._onDidChangeTreeData.fire();
        }
    }

    removeVariable(name: string): void {
        if (this.pinnedVars.delete(name)) {
            // Remove from all groups
            for (const [groupName, varNames] of this.groups) {
                const idx = varNames.indexOf(name);
                if (idx !== -1) {
                    varNames.splice(idx, 1);
                    if (varNames.length === 0) {
                        this.groups.delete(groupName);
                    }
                }
            }
            this._onDidChangeTreeData.fire();
        }
    }

    addToGroup(varName: string, groupName: string): void {
        if (!this.groups.has(groupName)) {
            this.groups.set(groupName, []);
        }
        const members = this.groups.get(groupName)!;
        if (!members.includes(varName)) {
            members.push(varName);
        }
        this._onDidChangeTreeData.fire();
    }

    clear(): void {
        this.pinnedVars.clear();
        this.groups.clear();
        this._onDidChangeTreeData.fire();
    }

    /**
     * Auto-detect all visualizable variables in the current scope.
     * Uses the fast basic-detection pass (adapter Layer 1) first, then
     * enriches matching variables with shape/dtype via adapter.getVariableInfo.
     */
    async autoDetectVariables(session: vscode.DebugSession): Promise<void> {
        const adapter = getAdapter(session);
        if (!adapter) {
            return;
        }

        const rawVars = await adapter.getVariablesInScope(session);

        // DEBUG: log raw type strings from the debug adapter so type-detection
        // mismatches (e.g. CodeLLDB returning empty/different type for cv::Mat)
        // are visible in the MatrixViewer output channel.
        // Label "r2" confirms this version of the code is running.
        for (const v of rawVars) {
            log_debug(`[autoDetect-r2] var="${v.name}" type="${v.type ?? "(empty)"}"`);
        }

        const newItems: MvVariableItem[] = [];

        for (const v of rawVars) {
            // Skip already pinned
            if (this.pinnedVars.has(v.name)) {
                continue;
            }

            const basicKind = adapter.basicTypeDetect(v.type ?? "");
            if (basicKind === "unknown") {
                continue;
            }

            // Enrich with shape/dtype via adapter
            let shapeLabel = "";
            let typeLabel = v.type ?? "";
            try {
                const info = await adapter.getVariableInfo(session, v.name, v.frameId);
                if (info) {
                    typeLabel = info.typeName ?? typeLabel;
                    shapeLabel = info.shape
                        ? `(${(info.shape as number[]).join("\u00d7")})`
                        : info.length != null
                            ? `[${info.length}]`
                            : "";
                }
            } catch {
                // Ignore enrichment failures; still show the variable
            }

            const item = new MvVariableItem(v.name, basicKind, typeLabel, shapeLabel);
            newItems.push(item);
        }

        let changed = false;
        for (const item of newItems) {
            if (!this.pinnedVars.has(item.variableName)) {
                this.pinnedVars.set(item.variableName, item);
                changed = true;
            }
        }
        if (changed) {
            this._onDidChangeTreeData.fire();
        }
    }

    // ── Private helpers ────────────────────────────────────────────────────

    /** Return the adapter for the currently active debug session, or null. */
    private getActiveAdapter() {
        const session = vscode.debug.activeDebugSession;
        if (!session) {
            return null;
        }
        return getAdapter(session);
    }
}
