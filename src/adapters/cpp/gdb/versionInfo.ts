/**
 * gdb/versionInfo.ts — C++ library version coordinator for GDB sessions.
 *
 * Aggregates version strings from all supported libraries and logs them.
 * Each library's fetch logic lives in its own libs/<libName>/versionInfo.ts.
 */

import * as vscode from "vscode";
import { getCurrentFrameId } from "./debugger";
import { logger } from "../../../log/logger";
import { fetchOpenCvVersion } from "./libs/opencv/versionInfo";
import { fetchEigenVersion } from "./libs/eigen/versionInfo";
import { fetchPclVersion } from "./libs/pcl/versionInfo";
import { fetchQtVersion } from "./libs/qt/versionInfo";

/**
 * Fetch and log available C++ library versions for a GDB session.
 * Failures for individual libraries are silently ignored.
 */
export async function logCppLibVersions(session: vscode.DebugSession): Promise<void> {
    const frameId = await getCurrentFrameId(session);
    const [cvVer, eigenVer, pclVer, qtVer] = await Promise.all([
        fetchOpenCvVersion(session, frameId),
        fetchEigenVersion(session, frameId),
        fetchPclVersion(session, frameId),
        fetchQtVersion(session, frameId),
    ]);
    if (cvVer)    { logger.info(`[C++] OpenCV: ${cvVer}`); }
    if (eigenVer) { logger.info(`[C++] Eigen:  ${eigenVer}`); }
    if (pclVer)   { logger.info(`[C++] PCL:    ${pclVer}`); }
    if (qtVer)    { logger.info(`[C++] Qt:     ${qtVer}`); }
}
