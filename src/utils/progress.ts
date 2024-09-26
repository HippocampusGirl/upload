import { format } from "bytes";
import formatDuration from "format-duration";

import { _Part } from "../part.js";
import { size } from "./range.js";

const activityIndicators = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

export class Progress {
  private bytes = 0;
  private total = 0;
  private start: number | undefined = undefined;

  private activityIndicatorIndex = 0;

  constructor() {}

  terminate() {}

  addPart({ range }: _Part): void {
    this.total += size(range);
    this.update();

    if (this.start === undefined) {
      this.start = Date.now();
    }
  }

  setComplete({ range }: _Part): void {
    this.bytes += size(range);
    this.pulse();
  }

  pulse(): void {
    this.activityIndicatorIndex =
      (this.activityIndicatorIndex + 1) % activityIndicators.length;
    this.update();
  }

  update(): void {
    const { bytes, start, total } = this;
    let timeString = "";
    if (start !== undefined) {
      const elapsedMilliseconds = Date.now() - start;
      const elapsedString = formatDuration(elapsedMilliseconds);
      timeString = elapsedString;
    }
    const proportionComplete = bytes / total;
    const percentCompleteString = `${Math.round(proportionComplete * 100)}%`;
    const sizeString = `${format(bytes)} / ${format(total)}`;

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
