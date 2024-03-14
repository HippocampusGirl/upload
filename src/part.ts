import Joi from "joi";

import { Range, rangeSchema } from "./utils/range.js";

export interface _Part {
  range: Range;
  checksumMD5: string;
}
export interface _File {
  path: string;
  size: number;
}
export interface FilePart extends _Part, _File {}
export interface Job extends FilePart {
  url: string;
}

export const partSchema = Joi.object().keys({
  range: rangeSchema.required(),
  checksumMD5: Joi.string().required(),
});
export const parseRange = (value: { range?: any }) => {
  const { start, end } = value.range;
  value.range = new Range(start, end);
};
