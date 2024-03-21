import cluster from "cluster";
import Debug from "debug";

const debug = Debug("client");

export const signal = new Promise<void>((resolve) => {
  const checkSIGINT = () => {
    debug("received SIGINT");
    resolve();
  };
  const checkWorkers = () => {
    if (
      cluster.workers !== undefined &&
      Object.keys(cluster.workers).length === 0
    ) {
      debug("all workers have disconnected");
      resolve();
    }
  };
  process.on("SIGINT", checkSIGINT);
  if (cluster.isPrimary) {
    cluster.on("disconnect", checkWorkers);
  }
});
