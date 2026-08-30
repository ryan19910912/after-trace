import {
  bigint,
  bigserial,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

export const bookingChannelEnum = pgEnum('booking_channel', ['WEB', 'APP', 'PHONE', 'ONSITE']);
export const availabilityStatusEnum = pgEnum('availability_status', ['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN']);
export const notificationChannelEnum = pgEnum('notification_channel', ['WEB_PUSH', 'EMAIL']);
export const notificationDeliveryStatusEnum = pgEnum('notification_delivery_status', [
  'PENDING',
  'SENT',
  'FAILED',
  'OPENED',
]);

export const users = pgTable(
  'users',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    authProvider: varchar('auth_provider', { length: 32 }).notNull(),
    authSubject: varchar('auth_subject', { length: 191 }).notNull(),
    email: varchar('email', { length: 320 }),
    displayName: varchar('display_name', { length: 120 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('users_auth_identity_uq').on(table.authProvider, table.authSubject),
    index('users_email_idx').on(table.email),
  ],
);

export const sources = pgTable(
  'sources',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    code: varchar('code', { length: 64 }).notNull().unique(),
    name: varchar('name', { length: 160 }).notNull(),
    baseUrl: text('base_url'),
    active: boolean('active').default(true).notNull(),
    minPollIntervalSeconds: integer('min_poll_interval_seconds').default(60).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('sources_active_idx').on(table.active)],
);

export const sports = pgTable(
  'sports',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    code: varchar('code', { length: 64 }).notNull().unique(),
    name: varchar('name', { length: 120 }).notNull(),
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('sports_active_name_idx').on(table.active, table.name)],
);

export const venues = pgTable(
  'venues',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sourceId: bigint('source_id', { mode: 'number' }).notNull().references(() => sources.id, { onDelete: 'cascade' }),
    externalVenueId: varchar('external_venue_id', { length: 191 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    city: varchar('city', { length: 80 }).default('臺北市').notNull(),
    district: varchar('district', { length: 80 }),
    address: text('address'),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    bookingChannel: bookingChannelEnum('booking_channel').default('WEB').notNull(),
    bookingUrl: text('booking_url'),
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('venues_source_external_uq').on(table.sourceId, table.externalVenueId),
    index('venues_city_district_active_idx').on(table.city, table.district, table.active),
  ],
);

export const venueSports = pgTable(
  'venue_sports',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    venueId: bigint('venue_id', { mode: 'number' }).notNull().references(() => venues.id, { onDelete: 'cascade' }),
    sportId: bigint('sport_id', { mode: 'number' }).notNull().references(() => sports.id, { onDelete: 'cascade' }),
    externalCategoryId: varchar('external_category_id', { length: 191 }),
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('venue_sports_venue_sport_uq').on(table.venueId, table.sportId),
    index('venue_sports_sport_active_idx').on(table.sportId, table.active),
  ],
);

export const courts = pgTable(
  'courts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    venueId: bigint('venue_id', { mode: 'number' }).notNull().references(() => venues.id, { onDelete: 'cascade' }),
    sportId: bigint('sport_id', { mode: 'number' }).notNull().references(() => sports.id, { onDelete: 'cascade' }),
    externalCourtId: varchar('external_court_id', { length: 191 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('courts_venue_sport_external_uq').on(table.venueId, table.sportId, table.externalCourtId),
    index('courts_venue_sport_active_idx').on(table.venueId, table.sportId, table.active),
  ],
);

export const availabilitySlots = pgTable(
  'availability_slots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sourceId: bigint('source_id', { mode: 'number' }).notNull().references(() => sources.id, { onDelete: 'cascade' }),
    venueId: bigint('venue_id', { mode: 'number' }).notNull().references(() => venues.id, { onDelete: 'cascade' }),
    sportId: bigint('sport_id', { mode: 'number' }).notNull().references(() => sports.id, { onDelete: 'cascade' }),
    courtId: bigint('court_id', { mode: 'number' }).references(() => courts.id, { onDelete: 'set null' }),
    externalSlotKey: varchar('external_slot_key', { length: 256 }).notNull(),
    useDate: date('use_date').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    status: availabilityStatusEnum('status').default('UNKNOWN').notNull(),
    price: numeric('price', { precision: 12, scale: 2 }),
    externalBookingRef: text('external_booking_ref'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('availability_slots_source_key_uq').on(table.sourceId, table.externalSlotKey),
    index('availability_slots_search_idx').on(table.sportId, table.useDate, table.status, table.startTime),
    index('availability_slots_venue_date_idx').on(table.venueId, table.useDate, table.status),
  ],
);

export const availabilityEvents = pgTable(
  'availability_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    availabilitySlotId: bigint('availability_slot_id', { mode: 'number' })
      .notNull()
      .references(() => availabilitySlots.id, { onDelete: 'cascade' }),
    previousStatus: availabilityStatusEnum('previous_status').notNull(),
    newStatus: availabilityStatusEnum('new_status').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    matchedAt: timestamp('matched_at', { withTimezone: true }),
  },
  (table) => [
    index('availability_events_slot_time_idx').on(table.availabilitySlotId, table.occurredAt),
    index('availability_events_match_queue_idx').on(table.newStatus, table.matchedAt, table.id),
  ],
);

export const watchRules = pgTable(
  'watch_rules',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id, { onDelete: 'cascade' }),
    sportId: bigint('sport_id', { mode: 'number' }).notNull().references(() => sports.id, { onDelete: 'cascade' }),
    clientKey: varchar('client_key', { length: 128 }).notNull(),
    clientPayloadHash: varchar('client_payload_hash', { length: 64 }).notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    dateFrom: date('date_from'),
    dateTo: date('date_to'),
    daysOfWeek: jsonb('days_of_week').$type<number[]>(),
    startTime: time('start_time'),
    endTime: time('end_time'),
    city: varchar('city', { length: 80 }).default('臺北市').notNull(),
    district: varchar('district', { length: 80 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('watch_rules_user_client_key_uq').on(table.userId, table.clientKey),
    index('watch_rules_enabled_sport_idx').on(table.enabled, table.sportId),
  ],
);

export const watchRuleVenues = pgTable(
  'watch_rule_venues',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    watchRuleId: bigint('watch_rule_id', { mode: 'number' }).notNull().references(() => watchRules.id, { onDelete: 'cascade' }),
    venueId: bigint('venue_id', { mode: 'number' }).notNull().references(() => venues.id, { onDelete: 'cascade' }),
  },
  (table) => [uniqueIndex('watch_rule_venues_rule_venue_uq').on(table.watchRuleId, table.venueId)],
);

export const notificationSubscriptions = pgTable(
  'notification_subscriptions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id, { onDelete: 'cascade' }),
    channel: notificationChannelEnum('channel').notNull(),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh'),
    authSecret: text('auth_secret'),
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('notification_subscriptions_user_endpoint_uq').on(table.userId, table.endpoint),
    index('notification_subscriptions_user_active_idx').on(table.userId, table.active),
  ],
);

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    watchRuleId: bigint('watch_rule_id', { mode: 'number' }).notNull().references(() => watchRules.id, { onDelete: 'cascade' }),
    availabilityEventId: bigint('availability_event_id', { mode: 'number' })
      .notNull()
      .references(() => availabilityEvents.id, { onDelete: 'cascade' }),
    subscriptionId: bigint('subscription_id', { mode: 'number' }).references(() => notificationSubscriptions.id, { onDelete: 'set null' }),
    channel: notificationChannelEnum('channel').notNull(),
    status: notificationDeliveryStatusEnum('status').default('PENDING').notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 191 }).notNull().unique(),
    errorCode: varchar('error_code', { length: 128 }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('notification_deliveries_rule_status_idx').on(table.watchRuleId, table.status)],
);

export const pollTargets = pgTable(
  'poll_targets',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sourceId: bigint('source_id', { mode: 'number' }).notNull().references(() => sources.id, { onDelete: 'cascade' }),
    venueId: bigint('venue_id', { mode: 'number' }).notNull().references(() => venues.id, { onDelete: 'cascade' }),
    sportId: bigint('sport_id', { mode: 'number' }).notNull().references(() => sports.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').default(true).notNull(),
    priority: integer('priority').default(0).notNull(),
    intervalSeconds: integer('interval_seconds').default(300).notNull(),
    nextPollAt: timestamp('next_poll_at', { withTimezone: true }).defaultNow().notNull(),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastErrorCode: varchar('last_error_code', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('poll_targets_source_venue_sport_uq').on(table.sourceId, table.venueId, table.sportId),
    index('poll_targets_due_idx').on(table.enabled, table.nextPollAt, table.priority),
  ],
);
