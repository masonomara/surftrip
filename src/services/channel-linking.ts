import { type ChannelType, type ChannelLink } from "../types";

export type { ChannelType, ChannelLink };

/**
 * Look up a Docket user ID by their channel-specific identifier.
 * For example, find the user linked to a specific Teams user ID.
 */
export async function findUserByChannelId(
  db: D1Database,
  channelType: ChannelType,
  channelUserId: string
): Promise<string | null> {
  const query = `
    SELECT user_id
    FROM channel_user_links
    WHERE channel_type = ? AND channel_user_id = ?
  `;

  const result = await db
    .prepare(query)
    .bind(channelType, channelUserId)
    .first<{ user_id: string }>();

  return result?.user_id ?? null;
}

/**
 * Create a new link between a channel user and a Docket user.
 */
export async function linkChannelUser(
  db: D1Database,
  link: ChannelLink
): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  const now = Date.now();

  const query = `
    INSERT INTO channel_user_links (id, channel_type, channel_user_id, user_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `;

  await db
    .prepare(query)
    .bind(id, link.channelType, link.channelUserId, link.userId, now)
    .run();

  return { id };
}

/**
 * Remove a channel link. Returns true if a link was deleted, false if none existed.
 */
export async function unlinkChannelUser(
  db: D1Database,
  channelType: ChannelType,
  channelUserId: string
): Promise<boolean> {
  const query = `
    DELETE FROM channel_user_links
    WHERE channel_type = ? AND channel_user_id = ?
  `;

  const result = await db.prepare(query).bind(channelType, channelUserId).run();

  return result.meta.changes > 0;
}

/**
 * Look up a user ID by their email address.
 */
export async function findUserByEmail(
  db: D1Database,
  email: string
): Promise<string | null> {
  const normalizedEmail = email.trim().toLowerCase();

  const result = await db
    .prepare(`SELECT id FROM user WHERE email = ?`)
    .bind(normalizedEmail)
    .first<{ id: string }>();

  return result?.id ?? null;
}

/**
 * Get all channel links for a user.
 */
export async function getUserChannelLinks(
  db: D1Database,
  userId: string
): Promise<
  Array<{ channelType: ChannelType; channelUserId: string; createdAt: number }>
> {
  const query = `
    SELECT channel_type, channel_user_id, created_at
    FROM channel_user_links
    WHERE user_id = ?
  `;

  const result = await db.prepare(query).bind(userId).all<{
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
