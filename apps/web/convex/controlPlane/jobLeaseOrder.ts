type LeaseCandidateRef = { id: string; createdAt: number };

export function sortByCreatedAtAsc<T extends { createdAt: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.createdAt - b.createdAt);
}

export function orderLeaseCandidateIds(params: {
  targeted: LeaseCandidateRef[];
  untargeted: LeaseCandidateRef[];
}): string[] {
  const targeted = sortByCreatedAtAsc(params.targeted);
  const untargeted = sortByCreatedAtAsc(params.untargeted);
  let targetedIdx = 0;
  let untargetedIdx = 0;
  const ordered: string[] = [];
  while (targetedIdx < targeted.length || untargetedIdx < untargeted.length) {
    const nextTargeted = targeted[targetedIdx];
    const nextUntargeted = untargeted[untargetedIdx];
    if (nextTargeted && (!nextUntargeted || nextTargeted.createdAt <= nextUntargeted.createdAt)) {
      ordered.push(nextTargeted.id);
      targetedIdx += 1;
      continue;
    }
    if (!nextUntargeted) break;
    ordered.push(nextUntargeted.id);
    untargetedIdx += 1;
  }
  return ordered;
}
