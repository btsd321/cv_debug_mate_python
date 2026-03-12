/**
 * MatrixViewer Debug - Extension Entry Point
 *
 * Registers all commands, views, and debug event listeners.
 * Coordinates the visualization pipeline when debugging stops.
 */

import * as vscode from "vscode";
import { CvVariablesProvider, CvVariableItem } from "./cvVariablesProvider";
import { PanelManager } from "./utils/panelManager";
import { SyncManager } from "./utils/syncManager";
import { getVariablesInScope, getVariableInfo } from "./utils/debugger";
import { detectVisualizableType } from "./utils/pythonTypes";
import { ImageProvider } from "./matImage/matProvider";
import { PlotProvider } from "./plot/plotProvider";
import { PointCloudProvider } from "./pointCloud/pointCloudProvider";

export function activate(context: vscode.ExtensionContext) {
  const panelManager = new PanelManager(context);
  const syncManager = new SyncManager();
  const variablesProvider = new CvVariablesProvider(context, panelManager);

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
      async (item: CvVariableItem | string) => {
        const varName =
          typeof item === "string" ? item : item?.variableName ?? "";
        if (!varName) {
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
      (item: CvVariableItem) => {
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
      async (item: CvVariableItem) => {
        const existing = syncManager.getPendingPair();
        if (!existing) {
          syncManager.startPairing(item.variableName);
          vscode.window.showInformationMessage(
            `MatrixViewer: selected "${item.variableName}" for sync pairing. Now select the second variable.`
          );
        } else {
          syncManager.completePairing(item.variableName, panelManager);
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
      async (item: CvVariableItem) => {
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

  // When debugger stops (breakpoint / step), refresh variables and auto-update panels.
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
  const session = vscode.debug.activeDebugSession;
  if (!session) {
    vscode.window.showWarningMessage("MatrixViewer: No active debug session.");
    return;
  }

  // Reuse existing panel if already open
  if (panelManager.hasPanel(varName)) {
    panelManager.focusPanel(varName);
    return;
  }

  let varInfo: Awaited<ReturnType<typeof getVariableInfo>>;
  try {
    varInfo = await getVariableInfo(session, varName);
  } catch (e) {
    vscode.window.showErrorMessage(
      `MatrixViewer: Failed to inspect "${varName}": ${e}`
    );
    return;
  }

  if (!varInfo) {
    vscode.window.showWarningMessage(
      `MatrixViewer: Cannot resolve variable "${varName}".`
    );
    return;
  }

  const vizType = detectVisualizableType(varInfo);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `MatrixViewer: loading "${varName}"…`,
      cancellable: false,
    },
    async () => {
      switch (vizType) {
        case "image": {
          const provider = new ImageProvider(session);
          const data = await provider.fetchImageData(varName, varInfo!);
          if (data) {
            panelManager.openImagePanel(varName, data, context, syncManager);
          }
          break;
        }
        case "plot": {
          const provider = new PlotProvider(session);
          const data = await provider.fetchPlotData(varName, varInfo!);
          if (data) {
            panelManager.openPlotPanel(varName, data, context, syncManager);
          }
          break;
        }
        case "pointcloud": {
          const provider = new PointCloudProvider(session);
          const data = await provider.fetchPointCloudData(varName, varInfo!);
          if (data) {
            panelManager.openPointCloudPanel(
              varName,
              data,
              context,
              syncManager
            );
          }
          break;
        }
        default:
          vscode.window.showWarningMessage(
            `MatrixViewer: "${varName}" is not a supported visualizable type.`
          );
      }
    }
  );
}

export function deactivate() {}
