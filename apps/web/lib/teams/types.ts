import type { Position } from '@giper/db';

export type TeamMemberRow = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  positions: Position[];
  primaryPosition: Position | null;
  activeTaskCount: number;
  activeAssignmentCount: number;
  inMyTeam: boolean;
  alsoInPmIds: string[];
};
