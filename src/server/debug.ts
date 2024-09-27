import Debug from "debug";
import cluster from "node:cluster";

const id = ((): string => {
  if (cluster.isPrimary) {
    return "primary";
  } else if (cluster.isWorker) {
    return `worker-${cluster.worker!.id}`;
  } else {
    return "unknown";
  }
})();
const namespace = `server:${id}`;
export const debug = Debug(namespace);
