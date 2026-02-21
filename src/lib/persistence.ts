import type { Card, Grid } from "../types";
import { DEFAULT_CARD_COLOR } from "../constants";

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
    cards: Array<Card & { color?: string; title?: string }>;
    camera: { x: number; y: number; zoom: number };
  }>;
  activeGridId: string;
}

interface WorkspaceFileV3 {
  version: 3;
  grids: Array<{
    id: string;
    name: string;
    cards: Array<Card & { color?: string }>;
    camera: { x: number; y: number; zoom: number };
  }>;
  activeGridId: string;
}

type WorkspaceFile = WorkspaceFileV1 | WorkspaceFileV2 | WorkspaceFileV3;

const DIR = "com.nick.plane";
const FILE = `${DIR}/workspace.json`;

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

function migrateV2(data: WorkspaceFileV2): WorkspaceData {
  return {
    grids: data.grids.map((g) => ({
      ...g,
      cards: backfillCardColors(g.cards.map((c) => ({
        ...c,
        text: c.title ?? c.text ?? "",
      }))),
    })),
    activeGridId: data.activeGridId,
  };
}

function parseV3(data: WorkspaceFileV3): WorkspaceData {
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
    if (!(await window.electronAPI.exists(FILE))) {
      return defaultWorkspace();
    }
    const raw = await window.electronAPI.readTextFile(FILE);
    const data: WorkspaceFile = JSON.parse(raw);

    switch (data.version) {
      case 3: return parseV3(data);
      case 2: return migrateV2(data);
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
    await window.electronAPI.mkdir(DIR);
    const data: WorkspaceFileV3 = {
      version: 3,
      grids: grids.map(({ id, name, cards, camera }) => ({
        id,
        name,
        cards,
        camera: { ...camera },
      })),
      activeGridId,
    };
    await window.electronAPI.writeTextFile(FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Failed to save workspace:", e);
  }
}
