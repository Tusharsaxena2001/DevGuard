export interface ChangedFileStatus {
  readonly path: string;
  /** `A`dded, `M`odified, `D`eleted, `T`ype changed. */
  readonly status: "A" | "M" | "D" | "T";
}
