export const VIEWS = ["isometric", "front", "back", "left", "right", "top", "bottom"] as const;
export type View = (typeof VIEWS)[number];

export function isView(value: unknown): value is View {
  return typeof value === "string" && (VIEWS as readonly string[]).includes(value);
}
