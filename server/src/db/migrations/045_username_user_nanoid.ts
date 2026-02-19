/**
 * No-op: usernames assigned by 040 (user_{nanoid}).
 * 046 leaves username blank for username=email cases instead of assigning user_nanoid.
 */
export const up = (_db: { exec: (sql: string) => void }) => {
  /* Username assignment handled by 040 */
};

export const down = () => {
  /* No-op */
};
