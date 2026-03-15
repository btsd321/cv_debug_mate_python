/**
 * MatrixViewer - Extension Entry Point
 *
 * Registers all commands, views, and debug event listeners.
 * Coordinates the visualization pipeline when debugging stops.
 */

import * as vscode from "vscode";
import { MvVariablesProvider, MvVariableItem } from "./mvVariablesProvider";
import { PanelManager } from "./utils/panelManager";
import { SyncManager } from "./utils/syncManager";
import { getAdapter } from "./adapters/adapterRegistry";
import { logger, debug, info, warn, error } from "./log/logger";

export function activate(context: vscode.ExtensionContext) {
    const logOut = vscode.window.createOutputChannel("MatrixViewer");
    logger.init(logOut);
    context.subscriptions.push(logOut);

    const panelManager = new PanelManager(context);
    const syncManager = new SyncManager();
    const variablesProvider = new MvVariablesProvider(context, panelManager);

    // Register the TreeView in the Debug sidebar
    const treeView = vscode.window.createTreeView("matrixViewerPanel", {
        treeDataProvider: variablesProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(treeView);

    // ── Commands ────────────────────────────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "matrixViewer.viewVariable",
            async (item: MvVariableItem | string | { name?: string; variableName?: string }) => {
                let varName: string;
                if (typeof item === "string") {
                    varName = item;
                } else if (item instanceof MvVariableItem) {
                    varName = item.variableName;
                } else {
                    // Called from debug/variables/context: VS Code passes
                    // { sessionId, container, variable: { name, value, type, evaluateName, ... } }
                    const asCtx = item as { variable?: { name?: string; evaluateName?: string }; name?: string };
                    varName = asCtx.variable?.evaluateName ?? asCtx.variable?.name ?? asCtx.name ?? "";
                }
                debug(`viewVariable resolved varName: "${varName}"`);
                if (!varName) {
                    vscode.window.showWarningMessage("MatrixViewer: could not resolve variable name from context.");
                    return;
                }
                await visualizeVariable(
                    varName,
                    context,
                    panelManager,
                    syncManager
                );
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "matrixViewer.addToPanel",
            async (variable: { name: string; value: string; type: string }) => {
                if (!variable?.name) {
                    return;
                }
                variablesProvider.addVariable(variable.name, variable.type ?? "");
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "matrixViewer.removeFromPanel",
            (item: MvVariableItem) => {
                if (item?.variableName) {
                    variablesProvider.removeVariable(item.variableName);
                }
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("matrixViewer.refreshPanel", () => {
            variablesProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "matrixViewer.syncPair",
            async (item: MvVariableItem) => {
                const existing = syncManager.getPendingPair();
                if (!existing) {
                    syncManager.startPairing(item.variableName);
                    info(`Selected "${item.variableName}" for sync pairing.`);
                    vscode.window.showInformationMessage(
                        `MatrixViewer: selected "${item.variableName}" for sync pairing. Now select the second variable.`
                    );
                } else {
                    syncManager.completePairing(item.variableName, panelManager);
                    info(`Synced pair: "${existing}" <-> "${item.variableName}".`);
                    vscode.window.showInformationMessage(
                        `MatrixViewer: "${existing}" and "${item.variableName}" are now synced.`
                    );
                }
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "matrixViewer.addToGroup",
            async (item: MvVariableItem) => {
                const groupName = await vscode.window.showInputBox({
                    prompt: "Enter group name",
                    placeHolder: "e.g. input/output",
                });
                if (groupName) {
                    variablesProvider.addToGroup(item.variableName, groupName);
                }
            }
        )
    );

    // ── Debug Session Events ─────────────────────────────────────────────────

    // onDidChangeActiveStackItem fires reliably when the debugger stops at a
    // breakpoint or after a step (VS Code 1.71+).  This covers Python/debugpy
    // which does NOT forward the standard DAP "stopped" event via
    // onDidReceiveDebugSessionCustomEvent.
    context.subscriptions.push(
        vscode.debug.onDidChangeActiveStackItem(async (_stackItem) => {
            const session = vscode.debug.activeDebugSession;
            if (!session) {
                return;
            }
            const config = vscode.workspace.getConfiguration("matrixViewer");
            if (config.get<boolean>("autoDetect", true)) {
                await variablesProvider.autoDetectVariables(session);
            }
            if (config.get<boolean>("autoRefresh", true)) {
                await panelManager.refreshAll(session);
            }
        })
    );

    // Fallback: also listen to custom "stopped" events for debuggers that do
    // forward them (e.g. some C++ adapters).
    context.subscriptions.push(
        vscode.debug.onDidReceiveDebugSessionCustomEvent(async (e) => {
            if (e.event === "stopped") {
                const config = vscode.workspace.getConfiguration("matrixViewer");
                if (config.get<boolean>("autoDetect", true)) {
                    await variablesProvider.autoDetectVariables(e.session);
                }
                if (config.get<boolean>("autoRefresh", true)) {
                    await panelManager.refreshAll(e.session);
                }
            }
        })
    );

    // Clean up panels and provider state when debug session ends.
    context.subscriptions.push(
        vscode.debug.onDidTerminateDebugSession(() => {
            panelManager.dispose();
            variablesProvider.clear();
        })
    );

    context.subscriptions.push(treeView);
}

// ── Visualization Dispatcher ───────────────────────────────────────────────

async function visualizeVariable(
    varName: string,
    context: vscode.ExtensionContext,
    panelManager: PanelManager,
    syncManager: SyncManager
): Promise<void> {
    debug(`visualizeVariable called: varName="${varName}"`);
    logger.channel?.show(true);
    const session = vscode.debug.activeDebugSession;
    if (!session) {
        vscode.window.showWarningMessage("MatrixViewer: No active debug session.");
        warn("No active debug session.");
        return;
    }
    debug(`session.type="${session.type}" session.id="${session.id}"`);

    // Reuse existing panel if already open
    if (panelManager.hasPanel(varName)) {
        debug(`Panel already exists for "${varName}", focusing existing panel.`);
        panelManager.focusPanel(varName);
        return;
    }

    const adapter = getAdapter(session);
    if (!adapter) {
        vscode.window.showWarningMessage(
            `MatrixViewer: Unsupported debug session type "${session.type}".`
        );
        warn(`No adapter for session type "${session.type}".`);
        return;
    }
    debug(`adapter found: ${adapter.constructor.name}`);

    let varInfo: Awaited<ReturnType<typeof adapter.getVariableInfo>>;
    try {
        varInfo = await adapter.getVariableInfo(session, varName);
    } catch (e) {
        vscode.window.showErrorMessage(
            `MatrixViewer: Failed to inspect "${varName}": ${e}`
        );
        error(`getVariableInfo threw for "${varName}": ${e}`);
        return;
    }
    debug(`varInfo=${JSON.stringify(varInfo)}`);

    if (!varInfo) {
        vscode.window.showWarningMessage(
            `MatrixViewer: Cannot resolve variable "${varName}".`
        );
        warn(`Cannot resolve variable "${varName}".`);
        return;
    }

    const vizType = adapter.detectVisualizableType(varInfo);
    debug(`detectVisualizableType -> "${vizType}"`);

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `MatrixViewer: loading "${varName}"…`,
            cancellable: false,
        },
        async () => {
            switch (vizType) {
                case "image": {
                    const data = await adapter.fetchImageData(session, varName, varInfo!);
                    debug(`fetchImageData result: ${data ? "OK" : "null"}`);
                    if (data) {
                        panelManager.openImagePanel(varName, data, context, syncManager);
                    } else {
                        vscode.window.showWarningMessage(
                            `MatrixViewer: "${varName}" — 不支持的数据结构 (unsupported data structure).`
                        );
                        warn(`Unsupported image data structure for "${varName}".`);
                    }
                    break;
                }
                case "plot": {
                    const data = await adapter.fetchPlotData(session, varName, varInfo!);
                    debug(`fetchPlotData result: ${data ? "OK" : "null"}`);
                    if (data) {
                        panelManager.openPlotPanel(varName, data, context, syncManager);
                    } else {
                        vscode.window.showWarningMessage(
                            `MatrixViewer: "${varName}" — 不支持的数据结构 (unsupported data structure).`
                        );
                        warn(`Unsupported plot data structure for "${varName}".`);
                    }
                    break;
                }
                case "pointcloud": {
                    const data = await adapter.fetchPointCloudData(session, varName, varInfo!);
                    debug(`fetchPointCloudData result: ${data ? "OK" : "null"}`);
                    if (data) {
                        panelManager.openPointCloudPanel(
                            varName,
                            data,
                            context,
                            syncManager
                        );
                    } else {
                        vscode.window.showWarningMessage(
                            `MatrixViewer: "${varName}" — 不支持的数据结构 (unsupported data structure).`
                        );
                        warn(`Unsupported point cloud data structure for "${varName}".`);
                    }
                    break;
                }
                default:
                    vscode.window.showWarningMessage(
                        `MatrixViewer: "${varName}" is not a supported visualizable type.`
                    );
                    warn(`Unsupported visualizable type for "${varName}": "${vizType}".`);
            }
        }
    );
}

export function deactivate() { }
