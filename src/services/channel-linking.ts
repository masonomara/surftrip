export type ChannelType = "teams" | "slack";

export interface ChannelLink {
  channelType: ChannelType;
  channelUserId: string;
  userId: string;
}

/**
 * Finds a user ID by their channel-specific identifier.
 * Used to map Teams/Slack users to our internal user IDs.
 */
export async function findUserByChannelId(
  db: D1Database,
  channelType: ChannelType,
  channelUserId: string
): Promise<string | null> {
  const result = await db
    .prepare(
      `SELECT user_id
       FROM channel_user_links
       WHERE channel_type = ? AND channel_user_id = ?`
    )
    .bind(channelType, channelUserId)
    .first<{ user_id: string }>();

  return result?.user_id ?? null;
}

/**
 * Creates a link between a channel user and an internal user.
 * Allows messages from Teams/Slack to be associated with the correct user.
 */
export async function linkChannelUser(
  db: D1Database,
  link: ChannelLink
): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  const now = Date.now();

  await db
    .prepare(
      `INSERT INTO channel_user_links (id, channel_type, channel_user_id, user_id, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(id, link.channelType, link.channelUserId, link.userId, now)
    .run();

  return { id };
}

/**
 * Removes a channel user link.
 * Returns true if a link was deleted, false if not found.
 */
export async function unlinkChannelUser(
  db: D1Database,
  channelType: ChannelType,
  channelUserId: string
): Promise<boolean> {
  const result = await db
    .prepare(
      `DELETE FROM channel_user_links
       WHERE channel_type = ? AND channel_user_id = ?`
    )
    .bind(channelType, channelUserId)
    .run();

  return result.meta.changes > 0;
}

/**
 * Finds a user ID by their email address.
 */
export async function findUserByEmail(
  db: D1Database,
  email: string
): Promise<string | null> {
  const result = await db
    .prepare(`SELECT id FROM user WHERE email = ?`)
    .bind(email)
    .first<{ id: string }>();

  return result?.id ?? null;
}

/**
 * Gets all channel links for a user.
 * Useful for showing which channels a user has connected.
 */
export async function getUserChannelLinks(
  db: D1Database,
  userId: string
): Promise<
  Array<{ channelType: ChannelType; channelUserId: string; createdAt: number }>
> {
  const result = await db
    .prepare(
      `SELECT channel_type, channel_user_id, created_at
       FROM channel_user_links
       WHERE user_id = ?`
    )
    .bind(userId)
    .all<{
      channel_type: ChannelType;
      channel_user_id: string;
      created_at: number;
    }>();

  return result.results.map((row) => ({
    channelType: row.channel_type,
    channelUserId: row.channel_user_id,
    createdAt: row.created_at,
  }));
}
