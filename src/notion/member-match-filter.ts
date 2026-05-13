export type MemberMatchProperty = {
  name: string;
  type: string;
};

export function buildManagedMemberMatchFilter(
  property: MemberMatchProperty,
  value: string,
): Record<string, unknown> | null {
  if (property.type === "title") {
    return {
      property: property.name,
      title: { equals: value },
    };
  }
  if (property.type === "rich_text") {
    return {
      property: property.name,
      rich_text: { equals: value },
    };
  }
  return null;
}
