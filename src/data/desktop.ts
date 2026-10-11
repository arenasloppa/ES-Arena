/**
 * The desktop app's access to the ARENA folder (electron/preload.cjs).
 * Undefined when the game runs in a browser.
 */
export interface DesktopFolder {
  name: string;
  path: string;
  /** Forward-slash paths relative to the folder, a few levels deep. */
  files: string[];
}

export interface DesktopBridge {
  /** Shows the system's folder dialog; null if the player cancels. */
  chooseFolder(): Promise<DesktopFolder | null>;
  /** The folder remembered from last time, if it is still there. */
  reopenFolder(): Promise<DesktopFolder | null>;
  /** Remembers the open folder for next time. */
  rememberFolder(): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
}

export const desktop = (window as unknown as { arenaDesktop?: DesktopBridge }).arenaDesktop;
