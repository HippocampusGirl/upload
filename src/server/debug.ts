import Debug from "debug";
import cluster from "node:cluster";

const id = cluster.isPrimary ? "primary" : cluster.worker?.id ?? "unknown";
const namespace = `server:${id}`;
export const debug = Debug(namespace);
