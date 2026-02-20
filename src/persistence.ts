import { readTextFile, writeTextFile, mkdir, exists, BaseDirectory } from "@tauri-apps/plugin-fs";
import type { Card, Grid } from "./types";
import { DEFAULT_CARD_COLOR } from "./constants";

export interface WorkspaceData {
  grids: Grid[];
  activeGridId: string;
}

interface WorkspaceFileV1 {
  version: 1;
  cards: Array<Card & { color?: string }>;
  camera: { x: number; y: number; zoom: number };
}

interface WorkspaceFileV2 {
  version: 2;
  grids: Array<{
    id: string;
    name: string;
    cards: Array<Card & { color?: string }>;
    camera: { x: number; y: number; zoom: number };
  }>;
  activeGridId: string;
}

type WorkspaceFile = WorkspaceFileV1 | WorkspaceFileV2;

const DIR = "com.nick.plane";
const FILE = `${DIR}/workspace.json`;
const BASE = BaseDirectory.AppData;

function backfillCardColors(cards: Array<Card & { color?: string }>): Card[] {
  return cards.map((c) => ({
    ...c,
    color: c.color ?? DEFAULT_CARD_COLOR,
  }));
}

function defaultWorkspace(): WorkspaceData {
  const id = crypto.randomUUID();
  return {
    grids: [{ id, name: "Grid 1", cards: [], camera: { x: 0, y: 0, zoom: 1 } }],
    activeGridId: id,
  };
}

function migrateV1(data: WorkspaceFileV1): WorkspaceData {
  const id = crypto.randomUUID();
  return {
    grids: [{
      id,
      name: "Grid 1",
      cards: backfillCardColors(data.cards ?? []),
      camera: data.camera ?? { x: 0, y: 0, zoom: 1 },
    }],
    activeGridId: id,
  };
}

function parseV2(data: WorkspaceFileV2): WorkspaceData {
  return {
    grids: data.grids.map((g) => ({
      ...g,
      cards: backfillCardColors(g.cards),
    })),
    activeGridId: data.activeGridId,
  };
}

export async function loadWorkspace(): Promise<WorkspaceData> {
  try {
    if (!(await exists(FILE, { baseDir: BASE }))) {
      return defaultWorkspace();
    }
    const raw = await readTextFile(FILE, { baseDir: BASE });
    const data: WorkspaceFile = JSON.parse(raw);

    switch (data.version) {
      case 2: return parseV2(data);
      case 1: return migrateV1(data);
      default: return defaultWorkspace();
    }
  } catch (e) {
    console.error("Failed to load workspace:", e);
    return defaultWorkspace();
  }
}

export async function saveWorkspace(grids: Grid[], activeGridId: string): Promise<void> {
  try {
    await mkdir(DIR, { baseDir: BASE, recursive: true });
    const data: WorkspaceFileV2 = {
      version: 2,
      grids: grids.map(({ id, name, cards, camera }) => ({
        id,
        name,
        cards,
        camera: { ...camera },
      })),
      activeGridId,
    };
    await writeTextFile(FILE, JSON.stringify(data, null, 2), { baseDir: BASE });
  } catch (e) {
    console.error("Failed to save workspace:", e);
  }
}
