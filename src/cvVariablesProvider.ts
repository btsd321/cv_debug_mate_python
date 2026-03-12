/**
 * CvVariablesProvider
 *
 * VS Code TreeDataProvider for the "MatrixViewer Debug" panel in the Debug sidebar.
 * Maintains a list of pinned + auto-detected visualizable variables,
 * grouped by type (Image / Plot / PointCloud) and optional user-defined groups.
 */

import * as vscode from "vscode";
import {
  getVariablesInScope,
  VariableInfo,
  evaluateExpression,
} from "./utils/debugger";
import { detectVisualizableType, basicTypeDetect } from "./utils/pythonTypes";
import { PanelManager } from "./utils/panelManager";

// ── Tree Node Types ────────────────────────────────────────────────────────

export type CvVariableKind = "image" | "plot" | "pointcloud" | "unknown";

export class CvVariableItem extends vscode.TreeItem {
  constructor(
    public readonly variableName: string,
    public readonly kind: CvVariableKind,
    public readonly typeLabel: string = "",
    public readonly shapeLabel: string = ""
  ) {
    super(variableName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "mvVariable";
    this.description = shapeLabel ? `${typeLabel}  ${shapeLabel}` : typeLabel;
    this.tooltip = `${variableName}: ${typeLabel} ${shapeLabel}`.trim();
    this.iconPath = CvVariableItem.iconFor(kind);
    this.command = {
      command: "matrixViewer.viewVariable",
      title: "Visualize",
      arguments: [this],
    };
  }

  private static iconFor(kind: CvVariableKind): vscode.ThemeIcon {
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

export class CvGroupItem extends vscode.TreeItem {
  public readonly children: CvVariableItem[] = [];

  constructor(public readonly groupName: string) {
    super(groupName, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "cvGroup";
    this.iconPath = new vscode.ThemeIcon("folder");
  }
}

type TreeNode = CvGroupItem | CvVariableItem;

// ── Provider ───────────────────────────────────────────────────────────────

export class CvVariablesProvider
  implements vscode.TreeDataProvider<TreeNode>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    TreeNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** All pinned variables (added manually or via auto-detect) */
  private pinnedVars = new Map<string, CvVariableItem>();

  /** User-defined groups: groupName → variableNames[] */
  private groups = new Map<string, string[]>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panelManager: PanelManager
  ) {}

  // ── TreeDataProvider interface ───────────────────────────────────────────

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return this.buildRoots();
    }
    if (element instanceof CvGroupItem) {
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
      const group = new CvGroupItem(groupName);
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
    const kind = basicTypeDetect(typeStr);
    const item = new CvVariableItem(name, kind, typeStr);
    this.pinnedVars.set(name, item);
    this._onDidChangeTreeData.fire();
  }

  /** Add a fully-resolved variable item */
  addVariableItem(item: CvVariableItem): void {
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
   * Uses the fast basic-detection pass first, then enriches with evaluate.
   */
  async autoDetectVariables(session: vscode.DebugSession): Promise<void> {
    const rawVars = await getVariablesInScope(session);
    const newItems: CvVariableItem[] = [];

    for (const v of rawVars) {
      // Skip already pinned
      if (this.pinnedVars.has(v.name)) {
        continue;
      }

      const basicKind = basicTypeDetect(v.type ?? "");
      if (basicKind === "unknown") {
        continue;
      }

      // Enrich with shape/dtype via evaluate
      let shapeLabel = "";
      let typeLabel = v.type ?? "";
      try {
        const info = await evaluateExpression(
          session,
          buildInspectExpr(v.name),
          v.frameId
        );
        if (info) {
          const parsed = JSON.parse(info);
          typeLabel = parsed.typeName ?? typeLabel;
          shapeLabel = parsed.shape
            ? `(${(parsed.shape as number[]).join("×")})`
            : parsed.length != null
            ? `[${parsed.length}]`
            : "";
        }
      } catch {
        // Ignore enrichment failures; still show the variable
      }

      const item = new CvVariableItem(v.name, basicKind, typeLabel, shapeLabel);
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
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a Python expression that returns a JSON-serialisable dict describing
 * the type, shape, and dtype of a variable — without importing anything that
 * might not be in the target environment.
 */
function buildInspectExpr(varName: string): string {
  // Uses only builtins + conditional attribute access to avoid import errors
  return (
    `__import__('json').dumps({` +
    `'typeName': type(${varName}).__module__ + '.' + type(${varName}).__name__,` +
    `'shape': list(${varName}.shape) if hasattr(${varName}, 'shape') else None,` +
    `'dtype': str(${varName}.dtype) if hasattr(${varName}, 'dtype') else None,` +
    `'length': len(${varName}) if hasattr(${varName}, '__len__') else None` +
    `})`
  );
}
