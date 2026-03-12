/**
 * builtins/plotProvider.ts — PlotData extraction from Python built-in sequences.
 *
 * Handles: list, tuple, array.array, range
 * All contain numeric scalars and can be serialised with a plain JSON evaluate.
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../IDebugAdapter";
import { PlotData } from "../../../../viewers/viewerTypes";
import { ILibPlotProvider } from "../../../ILibProviders";
import { fetchListData } from "../../pythonDebugger";
import { computeStats } from "../utils";

export class BuiltinsPlotProvider implements ILibPlotProvider {
  canHandle(typeName: string): boolean {
    // Accept both short form ("list") and module-qualified form ("builtins.list")
    return /^(builtins\.)?(list|tuple|range)$|^array\.array$/i.test(typeName);
  }

  async fetchPlotData(
    session: vscode.DebugSession,
    varName: string,
    info: VariableInfo
  ): Promise<PlotData | null> {
    const values = await fetchListData(session, varName, info.frameId);
    if (!values || values.length === 0) {
      return null;
    }

    return {
      yValues: values,
      dtype: "float64",
      length: values.length,
      stats: computeStats(values),
      varName,
    };
  }
}
