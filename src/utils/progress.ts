import { format } from "bytes";
import formatDuration from "format-duration";

import { _Part } from "../part.js";

const activityIndicators = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

export class Progress {
  private bytes = 0;
  private total = 0;
  private start: number | undefined = undefined;

  private activityIndicatorIndex = 0;

  constructor() {}

  terminate() {}

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

  setComplete(part: _Part): void {
    this.bytes += part.range.size();
    this.update();
  }

  pulse(): void {
    this.activityIndicatorIndex =
      (this.activityIndicatorIndex + 1) % activityIndicators.length;
    this.update();
  }

  update(): void {
    const { bytes, start, total } = this;
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

    if (process.stdout.isTTY) {
      process.stderr.cursorTo(0);
      process.stderr.clearLine(1);
    } else {
      process.stderr.write("\r");
    }

    const message = `${percentCompleteString} ${sizeString} ${timeString}`;
    process.stderr.write(
      `${activityIndicators[this.activityIndicatorIndex]} ${message}`
    );
  }
}
