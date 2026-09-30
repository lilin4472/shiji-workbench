export interface LockedSearchTargets {
  targetCompanyName?: string
  targetProjectName?: string
}

export function hasLockedSearchTarget(targets: LockedSearchTargets): boolean {
  return Boolean(targets.targetCompanyName?.trim() || targets.targetProjectName?.trim())
}

/** Exact-phrase style matching after removing display punctuation and whitespace. */
export function matchesLockedSearchTarget(candidate: string, target: string | undefined): boolean {
  const normalizedTarget = normalizeTargetText(target ?? '')
  if (!normalizedTarget) return true
  return normalizeTargetText(candidate).includes(normalizedTarget)
}

function normalizeTargetText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    // Tender titles often insert lot/parcel qualifiers in brackets. They do
    // not change the base project identity selected by the user.
    .replace(/[（(【\[].{0,80}?[）)】\]]/gu, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}
