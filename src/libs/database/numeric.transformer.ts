import { ValueTransformer } from 'typeorm';

/**
 * Postgres returns `decimal`/`numeric` columns as strings to avoid losing
 * precision. Apply this transformer to decimal columns so entities expose
 * them as JavaScript numbers and arithmetic works as expected.
 */
export const numericTransformer: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | number | null | undefined) =>
    value === null || value === undefined ? value : Number(value),
};
