import { format } from "bytes";
import formatDuration from "format-duration";
import Gauge from "gauge";
import makeEta from "simple-eta";

import { Range } from "./range.js";
import { UploadJob } from "./upload-parts.js";

export const gauge: Gauge = new Gauge();
let bytes = 0;
let total = 0;
let start: number | undefined = undefined;
let eta: ReturnType<typeof makeEta>;

export const resetProgress = (uploadJobs: UploadJob[]): void => {
  total += uploadJobs.flat().reduce((accumulator, uploadJob) => {
    const { start, end } = uploadJob.range;
    const range = new Range(start, end);
    return accumulator + range.size();
  }, 0);
  if (start === undefined) {
    start = Date.now();
  }
  eta = makeEta({ min: 0, max: total, historyTimeConstant: 30 });
  updateProgress();
};

export const updateProgress = (
  uploadJob: UploadJob | undefined = undefined
): void => {
  if (uploadJob !== undefined) {
    bytes += uploadJob.range.size();
  }
  eta.report(bytes);
  const etaMilliseconds = eta.estimate() * 1000;
  let timeString = "";
  if (start !== undefined) {
    const elapsedMilliseconds = Date.now() - start;
    const elapsedString = formatDuration(elapsedMilliseconds);
    if (isFinite(etaMilliseconds)) {
      const etaString = formatDuration(etaMilliseconds);
      timeString = `${elapsedString}<${etaString}`;
    } else {
      timeString = elapsedString;
    }
  }
  const proportionComplete = bytes / total;
  const percentCompleteString = `${Math.round(proportionComplete * 100)}%`;
  const sizeString = `${format(bytes)} / ${format(total)}`;
  const rateString = `${format(eta.rate())}/s`;
  gauge.show(
    `${percentCompleteString} ${sizeString} (${timeString} ${rateString})`,
    proportionComplete
  );
};
