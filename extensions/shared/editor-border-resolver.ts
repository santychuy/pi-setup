export type Colorize = (text: string) => string;

export type EditorBorderMode = "default" | "plan";

export type EditorBorderResolverOptions = {
  text: string;
  mode?: EditorBorderMode;
  baseBorder: Colorize;
  bashBorder: Colorize;
  planBorder?: Colorize;
};

/** Match Pi core's manual bash detection: leading whitespace is ignored. */
export const isBashInput = (text: string): boolean => text.trimStart().startsWith("!");

/** Resolve editor border color by visual priority. Bash input always wins. */
export const resolveEditorBorder = ({
  text,
  mode,
  baseBorder,
  bashBorder,
  planBorder,
}: EditorBorderResolverOptions): Colorize => {
  if (isBashInput(text)) return bashBorder;
  if (mode === "plan" && planBorder) return planBorder;
  return baseBorder;
};
