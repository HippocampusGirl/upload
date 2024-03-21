import { format } from "bytes";
import formatDuration from "format-duration";
import Gauge from "gauge";

import { _Part } from "../part.js";

export class Progress {
  public readonly gauge: Gauge = new Gauge();
  private bytes = 0;
  private total = 0;
  private start: number | undefined = undefined;

  constructor() {}

  terminate() {
    this.gauge.disable();
  }

  addPart(part: _Part): void {
    this.total += part.range.size();
    this.update();
    // total += uploadJobs.flat().reduce((accumulator, uploadJob) => {
    //   const { start, end } = uploadJob.range;
    //   const range = new Range(start, end);
    //   return accumulator + range.size();
    // }, 0);
    if (this.start === undefined) {
      this.start = Date.now();
    }
    // eta = makeEta({ min: 0, max: total, historyTimeConstant: 30 });
  }

  completePart(part: _Part): void {
    this.bytes += part.range.size();
    this.update();
  }

  update(): void {
    const { bytes, gauge, start, total } = this;
    // if (uploadJob !== undefined) {
    //   bytes += uploadJob.range.size();
    // }
    // eta.report(bytes);
    // const etaMilliseconds = eta.estimate() * 1000;
    let timeString = "";
    if (start !== undefined) {
      const elapsedMilliseconds = Date.now() - start;
      const elapsedString = formatDuration(elapsedMilliseconds);
      // if (isFinite(etaMilliseconds)) {
      //   const etaString = formatDuration(etaMilliseconds);
      //   timeString = `${elapsedString}<${etaString}`;
      // } else {
      timeString = elapsedString;
      // }
    }
    const proportionComplete = bytes / total;
    const percentCompleteString = `${Math.round(proportionComplete * 100)}%`;
    const sizeString = `${format(bytes)} / ${format(total)}`;
    // const rateString = `${format(eta.rate())}/s`;
    gauge.show(
      `${percentCompleteString} ${sizeString} ${timeString}`,
      proportionComplete
    );
  }
}
