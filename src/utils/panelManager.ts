/**
 * panelManager.ts — Webview panel lifecycle management.
 *
 * - Ensures at most one panel per variable name (deduplication).
 * - Provides typed open methods for each viewer type.
 * - Forwards refresh requests to all open panels.
 * - Broadcasts sync events to paired panels.
 */

import * as vscode from "vscode";
import { SyncManager } from "./syncManager";
import { ImageData } from "../matImage/matProvider";
import { PlotData } from "../plot/plotProvider";
import { PointCloudData } from "../pointCloud/pointCloudProvider";
import { buildImageWebviewHtml } from "../matImage/matWebview";
import { buildPlotWebviewHtml } from "../plot/plotWebview";
import { buildPointCloudWebviewHtml } from "../pointCloud/pointCloudWebview";
import { fetchArrayData, getVariableInfo } from "./debugger";
import { detectVisualizableType } from "./pythonTypes";
import { ImageProvider } from "../matImage/matProvider";
import { PlotProvider } from "../plot/plotProvider";
import { PointCloudProvider } from "../pointCloud/pointCloudProvider";

type PanelKind = "image" | "plot" | "pointcloud";

interface PanelEntry {
  panel: vscode.WebviewPanel;
  kind: PanelKind;
  varName: string;
}

export class PanelManager {
  private panels = new Map<string, PanelEntry>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  // ── Query ────────────────────────────────────────────────────────────────

  hasPanel(varName: string): boolean {
    return this.panels.has(varName);
  }

  focusPanel(varName: string): void {
    this.panels.get(varName)?.panel.reveal();
  }

  getPanel(varName: string): vscode.WebviewPanel | undefined {
    return this.panels.get(varName)?.panel;
  }

  // ── Open Panels ──────────────────────────────────────────────────────────

  openImagePanel(
    varName: string,
    data: ImageData,
    context: vscode.ExtensionContext,
    syncManager: SyncManager
  ): void {
    this.openPanel("image", varName, context, (webview) => {
      webview.html = buildImageWebviewHtml(varName, data, webview, context);
    });
    this.setupSyncListener(varName, syncManager);
  }

  openPlotPanel(
    varName: string,
    data: PlotData,
    context: vscode.ExtensionContext,
    syncManager: SyncManager
  ): void {
    this.openPanel("plot", varName, context, (webview) => {
      webview.html = buildPlotWebviewHtml(varName, data, webview, context);
    });
    this.setupSyncListener(varName, syncManager);
  }

  openPointCloudPanel(
    varName: string,
    data: PointCloudData,
    context: vscode.ExtensionContext,
    syncManager: SyncManager
  ): void {
    this.openPanel("pointcloud", varName, context, (webview) => {
      webview.html = buildPointCloudWebviewHtml(
        varName,
        data,
        webview,
        context
      );
    });
    this.setupSyncListener(varName, syncManager);
  }

  // ── Refresh ──────────────────────────────────────────────────────────────

  /**
   * Re-fetch data for every open panel from the current debug session
   * and post an update message to each webview.
   */
  async refreshAll(session: vscode.DebugSession): Promise<void> {
    const entries = [...this.panels.values()];
    await Promise.all(entries.map((e) => this.refreshEntry(e, session)));
  }

  private async refreshEntry(
    entry: PanelEntry,
    session: vscode.DebugSession
  ): Promise<void> {
    try {
      const info = await getVariableInfo(session, entry.varName);
      if (!info) {
        return;
      }

      switch (entry.kind) {
        case "image": {
          const provider = new ImageProvider(session);
          const data = await provider.fetchImageData(entry.varName, info);
          if (data) {
            entry.panel.webview.postMessage({ type: "update", data });
          }
          break;
        }
        case "plot": {
          const provider = new PlotProvider(session);
          const data = await provider.fetchPlotData(entry.varName, info);
          if (data) {
            entry.panel.webview.postMessage({ type: "update", data });
          }
          break;
        }
        case "pointcloud": {
          const provider = new PointCloudProvider(session);
          const data = await provider.fetchPointCloudData(entry.varName, info);
          if (data) {
            entry.panel.webview.postMessage({ type: "update", data });
          }
          break;
        }
      }
    } catch {
      // Silently skip panels whose variable is no longer in scope
    }
  }

  // ── Sync ─────────────────────────────────────────────────────────────────

  private setupSyncListener(
    varName: string,
    syncManager: SyncManager
  ): void {
    const entry = this.panels.get(varName);
    if (!entry) {
      return;
    }
    entry.panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "syncViewport") {
        this.broadcastSync(varName, msg, syncManager);
      }
    });
  }

  private broadcastSync(
    sourceVarName: string,
    msg: unknown,
    syncManager: SyncManager
  ): void {
    const partner = syncManager.getPartner(sourceVarName);
    if (!partner) {
      return;
    }
    const partnerEntry = this.panels.get(partner);
    if (partnerEntry) {
      partnerEntry.panel.webview.postMessage(msg);
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  dispose(): void {
    for (const entry of this.panels.values()) {
      entry.panel.dispose();
    }
    this.panels.clear();
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private openPanel(
    kind: PanelKind,
    varName: string,
    context: vscode.ExtensionContext,
    populate: (webview: vscode.Webview) => void
  ): void {
    const existing = this.panels.get(varName);
    if (existing) {
      existing.panel.reveal();
      return;
    }

    const title = `${varName} [${kind}]`;
    const panel = vscode.window.createWebviewPanel(
      `matrixViewer.${kind}`,
      title,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "media"),
        ],
      }
    );

    populate(panel.webview);

    const entry: PanelEntry = { panel, kind, varName };
    this.panels.set(varName, entry);

    panel.onDidDispose(() => {
      this.panels.delete(varName);
    });
  }
}
