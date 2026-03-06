import * as path from 'path';
import * as fs from 'fs/promises';
import { app } from 'electron';

export interface GraphNodeRecord {
    id: string;
    kind: 'scene' | 'component';
    name: string;
    bbox?: { left: number; top: number; right: number; bottom: number };
}

export interface GraphEdgeRecord {
    from: string;
    to: string;
    type: 'contains';
}

export interface DesignGraphRecord {
    id: string;
    version: number;
    filePath: string;
    createdAt: string;
    nodes: GraphNodeRecord[];
    edges: GraphEdgeRecord[];
}

export class EdgeStore {
    private baseDir: string;

    constructor(baseDir?: string) {
        this.baseDir = baseDir || path.join(app.getPath('userData'), 'design-graphs');
    }

    private graphPath(graphId: string): string {
        return path.join(this.baseDir, `${graphId}.json`);
    }

    async writeGraph(graph: DesignGraphRecord): Promise<void> {
        await fs.mkdir(this.baseDir, { recursive: true });
        const tmpPath = this.graphPath(`${graph.id}.${Date.now()}.tmp`);
        const finalPath = this.graphPath(graph.id);
        const json = JSON.stringify(graph);
        await fs.writeFile(tmpPath, json, 'utf-8');
        await fs.rename(tmpPath, finalPath);
    }

    async readGraph(graphId: string): Promise<DesignGraphRecord | null> {
        try {
            const content = await fs.readFile(this.graphPath(graphId), 'utf-8');
            return JSON.parse(content);
        } catch {
            return null;
        }
    }
}

