import type { Profile } from "@moor/types";

export interface DisplayProfile {
  profile: Profile;
  originalIndex: number;
}

export function getProfilesForDisplay(profiles: Profile[]): DisplayProfile[] {
  return profiles
    .map((profile, originalIndex) => ({ profile, originalIndex }))
    .sort((a, b) => {
      if (a.profile.isActive === b.profile.isActive) return a.originalIndex - b.originalIndex;
      return a.profile.isActive ? -1 : 1;
    });
}
