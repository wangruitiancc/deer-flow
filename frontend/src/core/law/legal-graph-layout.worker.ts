import { type LegalGraph } from "./legal-graph";
import { type GraphExplorerOptions } from "./legal-graph-explorer";
import {
  createGraphSimulation,
  type GraphLayoutNode,
} from "./legal-graph-layout";

export type GraphLayoutRequest = {
  graph: LegalGraph;
  forces: Pick<
    GraphExplorerOptions,
    "centerForce" | "repelForce" | "linkForce" | "linkDistance"
  >;
  previous: { id: string; x: number; y: number }[];
  reduced: boolean;
};
export type GraphLayoutResult = { nodes: GraphLayoutNode[]; done: boolean };

// Only inert graph geometry is sent here. This worker never reads files or sources.
self.onmessage = (event: MessageEvent<GraphLayoutRequest>) => {
  const { graph, forces, previous, reduced } = event.data;
  const simulation = createGraphSimulation(graph, forces, previous);
  let ticks = 0;
  const advance = () => {
    simulation.tick(6);
    ticks += 6;
    const done = ticks >= 240 || simulation.alpha() < 0.005;
    if (!reduced || done)
      self.postMessage({
        nodes: simulation.nodes().map((node) => ({ ...node })),
        done,
      } satisfies GraphLayoutResult);
    if (!done) setTimeout(advance, 32);
    else simulation.stop();
  };
  advance();
};
