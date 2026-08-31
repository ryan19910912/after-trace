import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  sports,
  venueSports,
  venues,
  watchRules,
  watchRuleVenues,
} from '../db/schema';
import { DrizzlePollingDemandReconciler } from '../polling/demand';
import type { CreateWatchRuleInput, UpdateWatchRuleInput } from './rules';
import { validateWatchWindow } from './rules';

export class WatchRuleError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
  }
}

export class DrizzleWatchRuleRepository {
  constructor(private readonly database: Database) {}

  async list(userId: number) {
    const rows = await this.database
      .select({
        id: watchRules.id,
        sportId: sports.id,
        sportCode: sports.code,
        sportName: sports.name,
        enabled: watchRules.enabled,
        dateFrom: watchRules.dateFrom,
        dateTo: watchRules.dateTo,
        daysOfWeek: watchRules.daysOfWeek,
        startTime: watchRules.startTime,
        endTime: watchRules.endTime,
        city: watchRules.city,
        district: watchRules.district,
        createdAt: watchRules.createdAt,
        updatedAt: watchRules.updatedAt,
      })
      .from(watchRules)
      .innerJoin(sports, eq(sports.id, watchRules.sportId))
      .where(eq(watchRules.userId, userId))
      .orderBy(asc(watchRules.id));

    const venueIdsByRule = await this.loadVenueIds(rows.map((row) => row.id));
    return rows.map((row) => ({ ...row, venueIds: venueIdsByRule.get(row.id) ?? [] }));
  }

  async getById(userId: number, watchRuleId: number) {
    const [row] = await this.database
      .select({
        id: watchRules.id,
        sportId: sports.id,
        sportCode: sports.code,
        sportName: sports.name,
        enabled: watchRules.enabled,
        dateFrom: watchRules.dateFrom,
        dateTo: watchRules.dateTo,
        daysOfWeek: watchRules.daysOfWeek,
        startTime: watchRules.startTime,
        endTime: watchRules.endTime,
        city: watchRules.city,
        district: watchRules.district,
        createdAt: watchRules.createdAt,
        updatedAt: watchRules.updatedAt,
      })
      .from(watchRules)
      .innerJoin(sports, eq(sports.id, watchRules.sportId))
      .where(and(eq(watchRules.id, watchRuleId), eq(watchRules.userId, userId)))
      .limit(1);
    if (!row) return null;
    const venueIdsByRule = await this.loadVenueIds([row.id]);
    return { ...row, venueIds: venueIdsByRule.get(row.id) ?? [] };
  }

  async create(input: {
    userId: number;
    clientKey: string;
    payloadHash: string;
    rule: CreateWatchRuleInput;
  }) {
    const sportId = await this.resolveSportId(input.rule.sport);
    await this.assertVenueIdsSupportSport(sportId, input.rule.venueIds);
    const venueIdsJson = JSON.stringify(input.rule.venueIds);
    const daysOfWeekJson = JSON.stringify(input.rule.daysOfWeek);

    await this.database.execute(sql`
      WITH inserted AS (
        INSERT INTO watch_rules (
          user_id,
          sport_id,
          client_key,
          client_payload_hash,
          enabled,
          date_from,
          date_to,
          days_of_week,
          start_time,
          end_time,
          city,
          district
        ) VALUES (
          ${input.userId},
          ${sportId},
          ${input.clientKey},
          ${input.payloadHash},
          ${input.rule.enabled},
          ${input.rule.dateFrom},
          ${input.rule.dateTo},
          ${daysOfWeekJson}::jsonb,
          ${input.rule.startTime},
          ${input.rule.endTime},
          ${input.rule.city},
          ${input.rule.district}
        )
        ON CONFLICT (user_id, client_key) DO NOTHING
        RETURNING id
      )
      INSERT INTO watch_rule_venues (watch_rule_id, venue_id)
      SELECT inserted.id, venue.value::bigint
      FROM inserted
      CROSS JOIN jsonb_array_elements_text(${venueIdsJson}::jsonb) AS venue(value)
      ON CONFLICT (watch_rule_id, venue_id) DO NOTHING
    `);

    const [stored] = await this.database
      .select({ id: watchRules.id, clientPayloadHash: watchRules.clientPayloadHash })
      .from(watchRules)
      .where(and(eq(watchRules.userId, input.userId), eq(watchRules.clientKey, input.clientKey)))
      .limit(1);
    if (!stored) throw new Error('Watch rule insert did not become visible');
    if (stored.clientPayloadHash !== input.payloadHash) {
      throw new WatchRuleError('IDEMPOTENCY_KEY_REUSE', 'Idempotency key was already used with a different watch payload');
    }

    await this.refreshPollingDemand();
    const created = await this.getById(input.userId, stored.id);
    if (!created) throw new Error('Created watch rule could not be loaded');
    return created;
  }

  async update(userId: number, watchRuleId: number, patch: UpdateWatchRuleInput) {
    const current = await this.getById(userId, watchRuleId);
    if (!current) return null;

    const merged = {
      enabled: patch.enabled ?? current.enabled,
      venueIds: patch.venueIds ?? current.venueIds,
      dateFrom: patch.dateFrom === undefined ? current.dateFrom : patch.dateFrom,
      dateTo: patch.dateTo === undefined ? current.dateTo : patch.dateTo,
      daysOfWeek: patch.daysOfWeek === undefined ? (current.daysOfWeek ?? []) : (patch.daysOfWeek ?? []),
      startTime: patch.startTime === undefined ? current.startTime : patch.startTime,
      endTime: patch.endTime === undefined ? current.endTime : patch.endTime,
      city: patch.city ?? current.city,
      district: patch.district === undefined ? current.district : patch.district,
    };
    const windowError = validateWatchWindow(merged);
    if (windowError) throw new WatchRuleError('INVALID_WATCH_WINDOW', windowError);
    await this.assertVenueIdsSupportSport(current.sportId, merged.venueIds);

    const venueIdsJson = JSON.stringify(merged.venueIds);
    const daysOfWeekJson = JSON.stringify(merged.daysOfWeek);
    const now = new Date();
    await this.database.execute(sql`
      WITH updated AS (
        UPDATE watch_rules
        SET enabled = ${merged.enabled},
            date_from = ${merged.dateFrom},
            date_to = ${merged.dateTo},
            days_of_week = ${daysOfWeekJson}::jsonb,
            start_time = ${merged.startTime},
            end_time = ${merged.endTime},
            city = ${merged.city},
            district = ${merged.district},
            updated_at = ${now}
        WHERE id = ${watchRuleId} AND user_id = ${userId}
        RETURNING id
      ),
      removed AS (
        DELETE FROM watch_rule_venues
        WHERE watch_rule_id IN (SELECT id FROM updated)
      )
      INSERT INTO watch_rule_venues (watch_rule_id, venue_id)
      SELECT updated.id, venue.value::bigint
      FROM updated
      CROSS JOIN jsonb_array_elements_text(${venueIdsJson}::jsonb) AS venue(value)
      ON CONFLICT (watch_rule_id, venue_id) DO NOTHING
    `);

    await this.refreshPollingDemand(now);
    return this.getById(userId, watchRuleId);
  }

  async delete(userId: number, watchRuleId: number): Promise<boolean> {
    const deleted = await this.database
      .delete(watchRules)
      .where(and(eq(watchRules.id, watchRuleId), eq(watchRules.userId, userId)))
      .returning({ id: watchRules.id });
    if (deleted.length === 0) return false;
    await this.refreshPollingDemand();
    return true;
  }

  async refreshPollingDemand(now = new Date()): Promise<void> {
    await new DrizzlePollingDemandReconciler(this.database).reconcile(now);
  }

  private async resolveSportId(code: string): Promise<number> {
    const [sport] = await this.database
      .select({ id: sports.id })
      .from(sports)
      .where(and(eq(sports.code, code), eq(sports.active, true)))
      .limit(1);
    if (!sport) throw new WatchRuleError('SPORT_NOT_FOUND');
    return sport.id;
  }

  private async assertVenueIdsSupportSport(sportId: number, venueIds: number[]): Promise<void> {
    if (venueIds.length === 0) return;
    const rows = await this.database
      .select({ id: venues.id })
      .from(venues)
      .innerJoin(venueSports, and(eq(venueSports.venueId, venues.id), eq(venueSports.sportId, sportId)))
      .where(
        and(
          inArray(venues.id, venueIds),
          eq(venues.active, true),
          eq(venueSports.active, true),
        ),
      );
    if (new Set(rows.map((row) => row.id)).size !== venueIds.length) {
      throw new WatchRuleError('VENUE_NOT_AVAILABLE_FOR_SPORT');
    }
  }

  private async loadVenueIds(ruleIds: number[]): Promise<Map<number, number[]>> {
    const result = new Map<number, number[]>();
    if (ruleIds.length === 0) return result;
    const rows = await this.database
      .select({ watchRuleId: watchRuleVenues.watchRuleId, venueId: watchRuleVenues.venueId })
      .from(watchRuleVenues)
      .where(inArray(watchRuleVenues.watchRuleId, ruleIds))
      .orderBy(asc(watchRuleVenues.venueId));
    for (const row of rows) {
      const values = result.get(row.watchRuleId) ?? [];
      values.push(row.venueId);
      result.set(row.watchRuleId, values);
    }
    return result;
  }
}
