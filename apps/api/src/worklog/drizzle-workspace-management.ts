import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';

export type WorklogCustomerInput = {
  name: string;
  phone: string | null;
  address: string | null;
  note: string | null;
};

export type WorklogProjectInput = {
  customerId: number | null;
  name: string;
  address: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  note: string | null;
};

export type WorklogRecordEditInput = {
  normalizedSummary: string | null;
  category: 'NOTE' | 'WORK' | 'ISSUE' | 'PAYMENT' | 'EXPENSE' | 'MATERIAL' | 'PHOTO' | 'AUDIO' | 'OTHER';
  customerId: number | null;
  projectId: number | null;
};

export type WorklogTransactionInput = {
  recordId: number | null;
  customerId: number | null;
  projectId: number | null;
  type: 'RECEIVED' | 'EXPENSE' | 'RECEIVABLE';
  amountTwd: string;
  occurredAt: Date;
  note: string | null;
};

export class DrizzleWorklogWorkspaceManagementRepository {
  constructor(private readonly db: Database) {}

  async ownedWorkspaceId(userId: number): Promise<number | null> {
    const result = await this.db.execute(sql`
      SELECT id::text AS id FROM worklog_workspaces WHERE owner_user_id = ${userId} LIMIT 1
    `);
    const id = (result.rows[0] as { id?: string } | undefined)?.id;
    return id ? positiveId(id) : null;
  }

  async listCustomers(workspaceId: number, query: string | null, limit: number) {
    const result = await this.db.execute(sql`
      SELECT customer.id::text AS id, customer.name, customer.phone, customer.address, customer.note,
             (SELECT COUNT(*) FROM worklog_projects project WHERE project.customer_id = customer.id)::text AS project_count,
             (SELECT COUNT(*) FROM worklog_records record WHERE record.customer_id = customer.id)::text AS record_count,
             customer.created_at, customer.updated_at
      FROM worklog_customers customer
      WHERE customer.workspace_id = ${workspaceId}
        AND (${query}::text IS NULL OR customer.name ILIKE '%' || ${query} || '%' OR COALESCE(customer.phone, '') ILIKE '%' || ${query} || '%' OR COALESCE(customer.address, '') ILIKE '%' || ${query} || '%')
      ORDER BY customer.updated_at DESC, customer.id DESC
      LIMIT ${limit}
    `);
    return result.rows;
  }

  async createCustomer(workspaceId: number, actorUserId: number, input: WorklogCustomerInput) {
    const result = await this.db.execute(sql`
      WITH changed AS (
        INSERT INTO worklog_customers (workspace_id, name, phone, address, note, created_at, updated_at)
        VALUES (${workspaceId}, ${input.name}, ${input.phone}, ${input.address}, ${input.note}, NOW(), NOW())
        RETURNING *
      ), audit AS (
        INSERT INTO worklog_audit_logs (workspace_id, actor_user_id, action, target_type, target_id, before_value, after_value, created_at)
        SELECT ${workspaceId}, ${actorUserId}, 'CUSTOMER_CREATED', 'CUSTOMER', changed.id::text, NULL, to_jsonb(changed), NOW()
        FROM changed RETURNING id
      )
      SELECT changed.* FROM changed WHERE EXISTS (SELECT 1 FROM audit)
    `);
    return result.rows[0] ?? null;
  }

  async updateCustomer(workspaceId: number, actorUserId: number, customerId: number, input: WorklogCustomerInput) {
    const before = await this.db.execute(sql`SELECT * FROM worklog_customers WHERE id = ${customerId} AND workspace_id = ${workspaceId} LIMIT 1`);
    if (before.rows.length === 0) return null;
    const result = await this.db.execute(sql`
      WITH changed AS (
        UPDATE worklog_customers SET name = ${input.name}, phone = ${input.phone}, address = ${input.address}, note = ${input.note}, updated_at = NOW()
        WHERE id = ${customerId} AND workspace_id = ${workspaceId}
        RETURNING *
      ), audit AS (
        INSERT INTO worklog_audit_logs (workspace_id, actor_user_id, action, target_type, target_id, before_value, after_value, created_at)
        SELECT ${workspaceId}, ${actorUserId}, 'CUSTOMER_UPDATED', 'CUSTOMER', changed.id::text,
               ${JSON.stringify(before.rows[0])}::jsonb, to_jsonb(changed), NOW()
        FROM changed RETURNING id
      )
      SELECT changed.* FROM changed WHERE EXISTS (SELECT 1 FROM audit)
    `);
    return result.rows[0] ?? null;
  }

  async deleteCustomer(workspaceId: number, actorUserId: number, customerId: number): Promise<'DELETED' | 'IN_USE' | 'NOT_FOUND'> {
    const before = await this.db.execute(sql`SELECT * FROM worklog_customers WHERE id = ${customerId} AND workspace_id = ${workspaceId} LIMIT 1`);
    if (before.rows.length === 0) return 'NOT_FOUND';
    const usage = await this.db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM worklog_projects WHERE customer_id = ${customerId}
        UNION ALL SELECT 1 FROM worklog_records WHERE customer_id = ${customerId}
        UNION ALL SELECT 1 FROM worklog_transactions WHERE customer_id = ${customerId}
      ) AS in_use
    `);
    if (Boolean((usage.rows[0] as { in_use?: boolean } | undefined)?.in_use)) return 'IN_USE';
    const result = await this.db.execute(sql`
      WITH deleted AS (
        DELETE FROM worklog_customers WHERE id = ${customerId} AND workspace_id = ${workspaceId} RETURNING id
      ), audit AS (
        INSERT INTO worklog_audit_logs (workspace_id, actor_user_id, action, target_type, target_id, before_value, after_value, created_at)
        SELECT ${workspaceId}, ${actorUserId}, 'CUSTOMER_DELETED', 'CUSTOMER', deleted.id::text,
               ${JSON.stringify(before.rows[0])}::jsonb, NULL, NOW()
        FROM deleted RETURNING id
      )
      SELECT deleted.id FROM deleted WHERE EXISTS (SELECT 1 FROM audit)
    `);
    return result.rows.length ? 'DELETED' : 'NOT_FOUND';
  }

  async listProjects(workspaceId: number, query: string | null, status: string | null, limit: number) {
    const result = await this.db.execute(sql`
      SELECT project.id::text AS id, project.customer_id::text AS customer_id, customer.name AS customer_name,
             project.name, project.address, project.status, project.note,
             (SELECT COUNT(*) FROM worklog_records record WHERE record.project_id = project.id)::text AS record_count,
             (SELECT COALESCE(SUM(CASE WHEN tx.type = 'RECEIVED' THEN tx.amount_twd ELSE 0 END), 0) FROM worklog_transactions tx WHERE tx.project_id = project.id)::text AS received_twd,
             (SELECT COALESCE(SUM(CASE WHEN tx.type = 'EXPENSE' THEN tx.amount_twd ELSE 0 END), 0) FROM worklog_transactions tx WHERE tx.project_id = project.id)::text AS expense_twd,
             (SELECT COALESCE(SUM(CASE WHEN tx.type = 'RECEIVABLE' THEN tx.amount_twd ELSE 0 END), 0) FROM worklog_transactions tx WHERE tx.project_id = project.id)::text AS receivable_twd,
             project.created_at, project.updated_at
      FROM worklog_projects project
      LEFT JOIN worklog_customers customer ON customer.id = project.customer_id
      WHERE project.workspace_id = ${workspaceId}
        AND (${query}::text IS NULL OR project.name ILIKE '%' || ${query} || '%' OR COALESCE(project.address, '') ILIKE '%' || ${query} || '%' OR COALESCE(customer.name, '') ILIKE '%' || ${query} || '%')
        AND (${status}::text IS NULL OR project.status::text = ${status})
      ORDER BY project.updated_at DESC, project.id DESC LIMIT ${limit}
    `);
    return result.rows;
  }

  async createProject(workspaceId: number, actorUserId: number, input: WorklogProjectInput) {
    if (!(await this.validCustomer(workspaceId, input.customerId))) return { status: 'CUSTOMER_NOT_FOUND' as const };
    const result = await this.db.execute(sql`
      WITH changed AS (
        INSERT INTO worklog_projects (workspace_id, customer_id, name, address, status, note, created_at, updated_at)
        VALUES (${workspaceId}, ${input.customerId}, ${input.name}, ${input.address}, ${input.status}, ${input.note}, NOW(), NOW())
        RETURNING *
      ), audit AS (
        INSERT INTO worklog_audit_logs (workspace_id, actor_user_id, action, target_type, target_id, before_value, after_value, created_at)
        SELECT ${workspaceId}, ${actorUserId}, 'PROJECT_CREATED', 'PROJECT', changed.id::text, NULL, to_jsonb(changed), NOW()
        FROM changed RETURNING id
      )
      SELECT changed.* FROM changed WHERE EXISTS (SELECT 1 FROM audit)
    `);
    return { status: 'OK' as const, project: result.rows[0] ?? null };
  }

  async updateProject(workspaceId: number, actorUserId: number, projectId: number, input: WorklogProjectInput) {
    if (!(await this.validCustomer(workspaceId, input.customerId))) return { status: 'CUSTOMER_NOT_FOUND' as const };
    const before = await this.db.execute(sql`SELECT * FROM worklog_projects WHERE id = ${projectId} AND workspace_id = ${workspaceId} LIMIT 1`);
    if (before.rows.length === 0) return { status: 'NOT_FOUND' as const };
    const result = await this.db.execute(sql`
      WITH changed AS (
        UPDATE worklog_projects SET customer_id = ${input.customerId}, name = ${input.name}, address = ${input.address}, status = ${input.status}, note = ${input.note}, updated_at = NOW()
        WHERE id = ${projectId} AND workspace_id = ${workspaceId} RETURNING *
      ), audit AS (
        INSERT INTO worklog_audit_logs (workspace_id, actor_user_id, action, target_type, target_id, before_value, after_value, created_at)
        SELECT ${workspaceId}, ${actorUserId}, 'PROJECT_UPDATED', 'PROJECT', changed.id::text,
               ${JSON.stringify(before.rows[0])}::jsonb, to_jsonb(changed), NOW()
        FROM changed RETURNING id
      )
      SELECT changed.* FROM changed WHERE EXISTS (SELECT 1 FROM audit)
    `);
    return { status: 'OK' as const, project: result.rows[0] ?? null };
  }

  async deleteProject(workspaceId: number, actorUserId: number, projectId: number): Promise<'DELETED' | 'IN_USE' | 'NOT_FOUND'> {
    const before = await this.db.execute(sql`SELECT * FROM worklog_projects WHERE id = ${projectId} AND workspace_id = ${workspaceId} LIMIT 1`);
    if (before.rows.length === 0) return 'NOT_FOUND';
    const usage = await this.db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM worklog_records WHERE project_id = ${projectId}
        UNION ALL SELECT 1 FROM worklog_transactions WHERE project_id = ${projectId}
      ) AS in_use
    `);
    if (Boolean((usage.rows[0] as { in_use?: boolean } | undefined)?.in_use)) return 'IN_USE';
    const result = await this.db.execute(sql`
      WITH deleted AS (
        DELETE FROM worklog_projects WHERE id = ${projectId} AND workspace_id = ${workspaceId} RETURNING id
      ), audit AS (
        INSERT INTO worklog_audit_logs (workspace_id, actor_user_id, action, target_type, target_id, before_value, after_value, created_at)
        SELECT ${workspaceId}, ${actorUserId}, 'PROJECT_DELETED', 'PROJECT', deleted.id::text,
               ${JSON.stringify(before.rows[0])}::jsonb, NULL, NOW()
        FROM deleted RETURNING id
      )
      SELECT deleted.id FROM deleted WHERE EXISTS (SELECT 1 FROM audit)
    `);
    return result.rows.length ? 'DELETED' : 'NOT_FOUND';
  }

  async updateRecord(workspaceId: number, actorUserId: number, recordId: number, input: WorklogRecordEditInput) {
    const links = await this.resolveCustomerProjectLink(workspaceId, input.customerId, input.projectId);
    if (links.status !== 'OK') return { status: links.status } as const;
    const before = await this.db.execute(sql`SELECT * FROM worklog_records WHERE id = ${recordId} AND workspace_id = ${workspaceId} LIMIT 1`);
    if (before.rows.length === 0) return { status: 'NOT_FOUND' as const };
    const result = await this.db.execute(sql`
      WITH changed AS (
        UPDATE worklog_records
        SET normalized_summary = ${input.normalizedSummary}, category = ${input.category}, customer_id = ${links.customerId}, project_id = ${input.projectId}, edited_at = NOW(), updated_at = NOW()
        WHERE id = ${recordId} AND workspace_id = ${workspaceId}
        RETURNING *
      ), audit AS (
        INSERT INTO worklog_audit_logs (workspace_id, actor_user_id, action, target_type, target_id, before_value, after_value, created_at)
        SELECT ${workspaceId}, ${actorUserId}, 'RECORD_EDITED', 'RECORD', changed.id::text,
               ${JSON.stringify(before.rows[0])}::jsonb, to_jsonb(changed), NOW()
        FROM changed RETURNING id
      )
      SELECT changed.* FROM changed WHERE EXISTS (SELECT 1 FROM audit)
    `);
    return { status: 'OK' as const, record: result.rows[0] ?? null };
  }

  async listTransactions(workspaceId: number, projectId: number | null, limit: number) {
    const result = await this.db.execute(sql`
      SELECT tx.id::text AS id, tx.record_id::text AS record_id, tx.customer_id::text AS customer_id,
             customer.name AS customer_name, tx.project_id::text AS project_id, project.name AS project_name,
             tx.type, tx.amount_twd::text, tx.occurred_at, tx.note, tx.created_at, tx.updated_at
      FROM worklog_transactions tx
      LEFT JOIN worklog_customers customer ON customer.id = tx.customer_id
      LEFT JOIN worklog_projects project ON project.id = tx.project_id
      WHERE tx.workspace_id = ${workspaceId} AND (${projectId}::bigint IS NULL OR tx.project_id = ${projectId})
      ORDER BY tx.occurred_at DESC, tx.id DESC LIMIT ${limit}
    `);
    return result.rows;
  }

  async createTransaction(workspaceId: number, actorUserId: number, input: WorklogTransactionInput) {
    const links = await this.validateLinks(workspaceId, input);
    if (links.status !== 'OK') return { status: links.status } as const;
    const result = await this.db.execute(sql`
      WITH changed AS (
        INSERT INTO worklog_transactions (workspace_id, record_id, customer_id, project_id, type, amount_twd, occurred_at, note, created_at, updated_at)
        VALUES (${workspaceId}, ${input.recordId}, ${links.customerId}, ${input.projectId}, ${input.type}, ${input.amountTwd}, ${input.occurredAt}, ${input.note}, NOW(), NOW())
        RETURNING *
      ), audit AS (
        INSERT INTO worklog_audit_logs (workspace_id, actor_user_id, action, target_type, target_id, before_value, after_value, created_at)
        SELECT ${workspaceId}, ${actorUserId}, 'TRANSACTION_CREATED', 'TRANSACTION', changed.id::text, NULL, to_jsonb(changed), NOW()
        FROM changed RETURNING id
      )
      SELECT changed.* FROM changed WHERE EXISTS (SELECT 1 FROM audit)
    `);
    return { status: 'OK' as const, transaction: result.rows[0] ?? null };
  }

  async updateTransaction(workspaceId: number, actorUserId: number, transactionId: number, input: WorklogTransactionInput) {
    const links = await this.validateLinks(workspaceId, input);
    if (links.status !== 'OK') return { status: links.status } as const;
    const before = await this.db.execute(sql`SELECT * FROM worklog_transactions WHERE id = ${transactionId} AND workspace_id = ${workspaceId} LIMIT 1`);
    if (before.rows.length === 0) return { status: 'NOT_FOUND' as const };
    const result = await this.db.execute(sql`
      WITH changed AS (
        UPDATE worklog_transactions SET record_id = ${input.recordId}, customer_id = ${links.customerId}, project_id = ${input.projectId},
               type = ${input.type}, amount_twd = ${input.amountTwd}, occurred_at = ${input.occurredAt}, note = ${input.note}, updated_at = NOW()
        WHERE id = ${transactionId} AND workspace_id = ${workspaceId} RETURNING *
      ), audit AS (
        INSERT INTO worklog_audit_logs (workspace_id, actor_user_id, action, target_type, target_id, before_value, after_value, created_at)
        SELECT ${workspaceId}, ${actorUserId}, 'TRANSACTION_UPDATED', 'TRANSACTION', changed.id::text,
               ${JSON.stringify(before.rows[0])}::jsonb, to_jsonb(changed), NOW()
        FROM changed RETURNING id
      )
      SELECT changed.* FROM changed WHERE EXISTS (SELECT 1 FROM audit)
    `);
    return { status: 'OK' as const, transaction: result.rows[0] ?? null };
  }

  async deleteTransaction(workspaceId: number, actorUserId: number, transactionId: number): Promise<boolean> {
    const before = await this.db.execute(sql`SELECT * FROM worklog_transactions WHERE id = ${transactionId} AND workspace_id = ${workspaceId} LIMIT 1`);
    if (before.rows.length === 0) return false;
    const result = await this.db.execute(sql`
      WITH deleted AS (
        DELETE FROM worklog_transactions WHERE id = ${transactionId} AND workspace_id = ${workspaceId} RETURNING id
      ), audit AS (
        INSERT INTO worklog_audit_logs (workspace_id, actor_user_id, action, target_type, target_id, before_value, after_value, created_at)
        SELECT ${workspaceId}, ${actorUserId}, 'TRANSACTION_DELETED', 'TRANSACTION', deleted.id::text,
               ${JSON.stringify(before.rows[0])}::jsonb, NULL, NOW()
        FROM deleted RETURNING id
      )
      SELECT deleted.id FROM deleted WHERE EXISTS (SELECT 1 FROM audit)
    `);
    return result.rows.length > 0;
  }

  private async validCustomer(workspaceId: number, customerId: number | null): Promise<boolean> {
    if (customerId === null) return true;
    const result = await this.db.execute(sql`SELECT 1 FROM worklog_customers WHERE id = ${customerId} AND workspace_id = ${workspaceId} LIMIT 1`);
    return result.rows.length > 0;
  }

  private async projectCustomer(workspaceId: number, projectId: number | null): Promise<{ found: boolean; customerId: number | null }> {
    if (projectId === null) return { found: true, customerId: null };
    const result = await this.db.execute(sql`
      SELECT customer_id::text AS customer_id
      FROM worklog_projects
      WHERE id = ${projectId} AND workspace_id = ${workspaceId}
      LIMIT 1
    `);
    const row = result.rows[0] as { customer_id?: string | null } | undefined;
    if (!row) return { found: false, customerId: null };
    return { found: true, customerId: row.customer_id === null || row.customer_id === undefined ? null : positiveId(row.customer_id) };
  }

  private async validRecord(workspaceId: number, recordId: number | null): Promise<boolean> {
    if (recordId === null) return true;
    const result = await this.db.execute(sql`SELECT 1 FROM worklog_records WHERE id = ${recordId} AND workspace_id = ${workspaceId} LIMIT 1`);
    return result.rows.length > 0;
  }

  private async resolveCustomerProjectLink(
    workspaceId: number,
    customerId: number | null,
    projectId: number | null,
  ): Promise<{ status: 'OK'; customerId: number | null } | { status: 'CUSTOMER_NOT_FOUND' | 'PROJECT_NOT_FOUND' }> {
    const [customerValid, project] = await Promise.all([
      this.validCustomer(workspaceId, customerId),
      this.projectCustomer(workspaceId, projectId),
    ]);
    if (!customerValid) return { status: 'CUSTOMER_NOT_FOUND' };
    if (!project.found) return { status: 'PROJECT_NOT_FOUND' };
    return { status: 'OK', customerId: canonicalCustomerId(customerId, project.customerId) };
  }

  private async validateLinks(
    workspaceId: number,
    input: Pick<WorklogTransactionInput, 'recordId' | 'customerId' | 'projectId'>,
  ): Promise<
    | { status: 'OK'; customerId: number | null }
    | { status: 'RECORD_NOT_FOUND' | 'CUSTOMER_NOT_FOUND' | 'PROJECT_NOT_FOUND' }
  > {
    const [record, links] = await Promise.all([
      this.validRecord(workspaceId, input.recordId),
      this.resolveCustomerProjectLink(workspaceId, input.customerId, input.projectId),
    ]);
    if (!record) return { status: 'RECORD_NOT_FOUND' };
    return links;
  }
}

export function canonicalCustomerId(
  selectedCustomerId: number | null,
  projectCustomerId: number | null,
): number | null {
  return projectCustomerId ?? selectedCustomerId;
}

function positiveId(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('invalid database id');
  return parsed;
}
