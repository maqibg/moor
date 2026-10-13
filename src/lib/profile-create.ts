/** 模板选择器的"空白新建"哨兵值，Radix Select 不接受空字符串作为 item value。 */
export const NO_TEMPLATE = "none";

export type CreateProfileIntent =
  | { kind: "create"; name: string }
  | { kind: "clone"; sourceId: string; name: string };

/**
 * 把创建表单的输入解析成可执行意图。
 * 名称空白时返回 null（后端会以 400 VALIDATION_ERROR 拒绝，前端不提交）。
 * 未选择模板时走新建；选择模板时走克隆，克隆出的 profile 由后端保证非激活。
 */
export function resolveCreateProfileIntent(
  rawName: string,
  templateId: string,
): CreateProfileIntent | null {
  const name = rawName.trim();
  if (name.length === 0) return null;
  const sourceId = templateId.trim();
  if (sourceId.length === 0 || sourceId === NO_TEMPLATE) {
    return { kind: "create", name };
  }
  return { kind: "clone", sourceId, name };
}
