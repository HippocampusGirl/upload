import Debug from "debug";
import ms from "ms";

Debug.formatArgs = function formatArgs(this: any, args: string[]) {
    const { namespace: name, useColors } = this;

    if (useColors) {
        const c = this.color;
        const colorCode = "\u001B[3" + (c < 8 ? c : "8;5;" + c);
        const prefix = `  ${colorCode};1m${name} \u001B[0m`;

        args[0] = prefix + args[0].split("\n").join("\n" + prefix);
        args.push(colorCode + "m+" + ms(this.diff) + "\u001B[0m");
    } else {
        args[0] = new Date().toISOString() + name + " " + args[0];
    }
};
export default Debug;
