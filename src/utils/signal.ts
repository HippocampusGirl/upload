import cluster from "cluster";
import Debug from "debug";

const debug = Debug("client");

export const signal = new Promise<void>((resolve) => {
  const checkSIGINT = () => {
    debug("received SIGINT");
    resolve();
  };
  process.once("SIGINT", checkSIGINT);

  const checkWorkers = () => {
    if (
      cluster.workers !== undefined &&
      Object.keys(cluster.workers).length === 0
    ) {
      debug("all workers have disconnected");
      resolve();
    }
  };
  if (cluster.isPrimary) {
    cluster.once("disconnect", checkWorkers);
  }
});
