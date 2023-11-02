import { format } from "bytes";
import formatDuration from "format-duration";
import Gauge from "gauge";
import { UploadPart } from "./parts.js";
import makeEta from "simple-eta";

let gauge: Gauge;
let bytes = 0;
let total = 0;
let start: number;
let eta: ReturnType<typeof makeEta>;

export function initializeProgress(uploadParts: UploadPart[][]): void {
  total = uploadParts
    .flat()
    .reduce((accumulator, part) => accumulator + part.size(), 0);
  start = Date.now();
  eta = makeEta({ min: 0, max: total, historyTimeConstant: 30 });
  gauge = new Gauge();
  updateProgress();
}

export function updateProgress(part: UploadPart | undefined = undefined): void {
  if (part !== undefined) {
    bytes += part.size();
  }

  eta.report(bytes);
  const etaMilliseconds = eta.estimate() * 1000;
  const elapsedMilliseconds = Date.now() - start;
  const elapsedString = formatDuration(elapsedMilliseconds);
  let timeString;
  if (isFinite(etaMilliseconds)) {
    const etaString = formatDuration(etaMilliseconds);
    timeString = `${elapsedString}<${etaString}`;
  } else {
    timeString = elapsedString;
  }

  const proportionComplete = bytes / total;
  const percentCompleteString = `${Math.round(proportionComplete * 100)}%`;
  const sizeString = `${format(bytes)} / ${format(total)}`;

  const rateString = `${format(eta.rate())}/s`;

  gauge.pulse();
  gauge.show(
    `${percentCompleteString} ${sizeString} (${timeString} ${rateString})`,
    proportionComplete
  );
}
