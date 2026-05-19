export function labelForReferenceIndex(index: number) {
  return `图片${index + 1}`;
}

export function insertReferenceToken(prompt: string, token: string) {
  const trimmed = prompt.trimEnd();
  const reference = `@${token}`;
  if (!trimmed) return `${reference} `;
  if (trimmed.endsWith(reference)) return `${trimmed} `;
  return `${trimmed} ${reference} `;
}
